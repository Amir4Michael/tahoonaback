import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock the data layer (models) so we test the SERVICE's business logic
// (device-limit enforcement, token rotation, who gets signed out on a
// password change, ...) in isolation from an actual MongoDB connection. ----

const shopAuthMocks = vi.hoisted(() => ({ findOne: vi.fn() }));
const deviceMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  countDocuments: vi.fn(),
  find: vi.fn(),
  findById: vi.fn(),
  deleteOne: vi.fn(),
  updateMany: vi.fn(),
  construct: vi.fn(),
}));

/** Mimics a Mongoose Query: thenable (awaitable) AND chainable (.select()/.sort() return itself). */
function mockQuery(result) {
  const query = {
    select: vi.fn(() => query),
    sort: vi.fn(() => query),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (onReject) => Promise.resolve(result).catch(onReject),
  };
  return query;
}

vi.mock('../../src/models/ShopAuth.js', () => ({
  default: {
    findOne: (...args) => shopAuthMocks.findOne(...args),
    SINGLETON_KEY: 'system1_shop_auth',
  },
}));

vi.mock('../../src/models/DeviceSession.js', () => {
  function DeviceSessionMock(data) {
    return deviceMocks.construct(data);
  }
  DeviceSessionMock.findOne = (...args) => deviceMocks.findOne(...args);
  DeviceSessionMock.countDocuments = (...args) => deviceMocks.countDocuments(...args);
  DeviceSessionMock.find = (...args) => deviceMocks.find(...args);
  DeviceSessionMock.findById = (...args) => deviceMocks.findById(...args);
  DeviceSessionMock.deleteOne = (...args) => deviceMocks.deleteOne(...args);
  DeviceSessionMock.updateMany = (...args) => deviceMocks.updateMany(...args);
  return { default: DeviceSessionMock };
});

vi.mock('../../src/utils/password.js', () => ({
  hashPassword: vi.fn(async (p) => `hashed(${p})`),
  verifyPassword: vi.fn(),
}));

vi.mock('../../src/utils/tokens.js', () => ({
  generateRefreshToken: vi.fn(() => 'raw-refresh-token'),
  hashRefreshToken: vi.fn((t) => `hashed(${t})`),
  compareRefreshToken: vi.fn(),
}));

vi.mock('../../src/config/jwt.js', () => ({
  signAccessToken: vi.fn(() => 'signed.access.token'),
}));

const auditMocks = vi.hoisted(() => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/auditLog.service.js', () => ({
  recordAuditLog: (...args) => auditMocks.recordAuditLog(...args),
}));

import * as authService from '../../src/services/auth.service.js';
import { verifyPassword, hashPassword } from '../../src/utils/password.js';
import { compareRefreshToken } from '../../src/utils/tokens.js';

function makeAuthDoc(overrides = {}) {
  return {
    passwordHash: 'hashed(current-password)',
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeDeviceDoc(overrides = {}) {
  return {
    _id: { toString: () => overrides.id || 'device-doc-id' },
    deviceId: overrides.deviceId || 'device-1',
    label: overrides.label || '',
    userAgent: overrides.userAgent || '',
    lastIp: overrides.lastIp || '',
    lastActiveAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
    refreshTokenHash: overrides.refreshTokenHash ?? 'hashed(old-token)',
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login', () => {
  it('rejects when the shop password has not been set up yet', async () => {
    shopAuthMocks.findOne.mockReturnValue(mockQuery(null));

    await expect(authService.login({ password: 'x', deviceId: 'd1' })).rejects.toMatchObject({ statusCode: 500 });
  });

  it('rejects an incorrect password without touching devices at all', async () => {
    shopAuthMocks.findOne.mockReturnValue(mockQuery(makeAuthDoc()));
    verifyPassword.mockResolvedValue(false);

    await expect(authService.login({ password: 'wrong', deviceId: 'd1' })).rejects.toMatchObject({ statusCode: 401 });
    expect(deviceMocks.findOne).not.toHaveBeenCalled();
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.failed', values: { reason: 'wrong_password' }, actorDeviceId: 'd1' }),
    );
  });

  it('registers a new device and issues a session when under the device limit', async () => {
    shopAuthMocks.findOne.mockReturnValue(mockQuery(makeAuthDoc()));
    verifyPassword.mockResolvedValue(true);
    deviceMocks.findOne.mockResolvedValue(null); // unknown device
    deviceMocks.countDocuments.mockResolvedValue(1); // 1 already registered, limit is 2
    const newDeviceDoc = makeDeviceDoc({ deviceId: 'd-new' });
    deviceMocks.construct.mockReturnValue(newDeviceDoc);

    const result = await authService.login({
      password: 'correct',
      deviceId: 'd-new',
      deviceLabel: 'My Laptop',
      userAgent: 'UA-string',
      ip: '1.2.3.4',
    });

    expect(deviceMocks.construct).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'd-new', label: 'My Laptop', userAgent: 'UA-string', lastIp: '1.2.3.4' }),
    );
    expect(newDeviceDoc.save).toHaveBeenCalled();
    expect(result.accessToken).toBe('signed.access.token');
    expect(result.refreshToken).toBe('raw-refresh-token');
    expect(result.device.deviceId).toBe('d-new');
    expect(result.device.isCurrent).toBe(true);
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.success', actorDeviceId: 'd-new' }),
    );
  });

  it('rejects a new (3rd) device once the device limit is already reached', async () => {
    shopAuthMocks.findOne.mockReturnValue(mockQuery(makeAuthDoc()));
    verifyPassword.mockResolvedValue(true);
    deviceMocks.findOne.mockResolvedValue(null); // unknown device
    deviceMocks.countDocuments.mockResolvedValue(2); // already at the limit
    deviceMocks.find.mockReturnValue(mockQuery([makeDeviceDoc({ deviceId: 'd-old-1' }), makeDeviceDoc({ deviceId: 'd-old-2' })]));

    await expect(authService.login({ password: 'correct', deviceId: 'd-new' })).rejects.toMatchObject({
      statusCode: 403,
      details: expect.objectContaining({ code: 'DEVICE_LIMIT_REACHED' }),
    });
    expect(deviceMocks.construct).not.toHaveBeenCalled();
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.failed', values: { reason: 'device_limit_reached' } }),
    );
  });

  it('refreshes an already-registered device without counting toward the limit', async () => {
    shopAuthMocks.findOne.mockReturnValue(mockQuery(makeAuthDoc()));
    verifyPassword.mockResolvedValue(true);
    const existingDevice = makeDeviceDoc({ deviceId: 'd-known' });
    deviceMocks.findOne.mockResolvedValue(existingDevice);

    const result = await authService.login({ password: 'correct', deviceId: 'd-known' });

    expect(deviceMocks.countDocuments).not.toHaveBeenCalled(); // limit check skipped for a known device
    expect(deviceMocks.construct).not.toHaveBeenCalled();
    expect(existingDevice.save).toHaveBeenCalled();
    expect(result.device.deviceId).toBe('d-known');
  });
});

describe('refresh', () => {
  it('rejects an unregistered device', async () => {
    deviceMocks.findOne.mockReturnValue(mockQuery(null));

    await expect(authService.refresh({ refreshToken: 't', deviceId: 'ghost' })).rejects.toMatchObject({
      statusCode: 401,
      details: { code: 'DEVICE_NOT_REGISTERED' },
    });
  });

  it('rejects a mismatched refresh token', async () => {
    deviceMocks.findOne.mockReturnValue(mockQuery(makeDeviceDoc()));
    compareRefreshToken.mockReturnValue(false);

    await expect(authService.refresh({ refreshToken: 'bad', deviceId: 'device-1' })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rotates the refresh token and issues a new access token on success', async () => {
    const device = makeDeviceDoc();
    deviceMocks.findOne.mockReturnValue(mockQuery(device));
    compareRefreshToken.mockReturnValue(true);

    const result = await authService.refresh({ refreshToken: 'old-token', deviceId: 'device-1' });

    expect(device.save).toHaveBeenCalled();
    expect(device.refreshTokenHash).toBe('hashed(raw-refresh-token)'); // rotated to the new token's hash
    expect(result.accessToken).toBe('signed.access.token');
    expect(result.refreshToken).toBe('raw-refresh-token');
  });
});

describe('logout', () => {
  it('clears the refresh token but keeps the device registered', async () => {
    const device = makeDeviceDoc();
    deviceMocks.findOne.mockResolvedValue(device);

    await authService.logout({ deviceId: 'device-1' });

    expect(device.refreshTokenHash).toBeNull();
    expect(device.save).toHaveBeenCalled();
    expect(deviceMocks.deleteOne).not.toHaveBeenCalled(); // never deletes the slot
  });

  it('is a harmless no-op if the device is already gone', async () => {
    deviceMocks.findOne.mockResolvedValue(null);
    await expect(authService.logout({ deviceId: 'ghost' })).resolves.toEqual({ success: true });
  });
});

describe('listDevices', () => {
  it('marks the calling device as isCurrent and never leaks refreshTokenHash', async () => {
    const devices = [makeDeviceDoc({ deviceId: 'd1' }), makeDeviceDoc({ deviceId: 'd2' })];
    deviceMocks.find.mockReturnValue(mockQuery(devices));

    const result = await authService.listDevices({ currentDeviceId: 'd2' });

    expect(result).toHaveLength(2);
    expect(result.find((d) => d.deviceId === 'd2').isCurrent).toBe(true);
    expect(result.find((d) => d.deviceId === 'd1').isCurrent).toBe(false);
    expect(result[0].refreshTokenHash).toBeUndefined();
  });
});

describe('revokeDevice', () => {
  it('deletes the device by id and records an audit entry', async () => {
    const device = makeDeviceDoc({ deviceId: 'd-old' });
    deviceMocks.findById.mockResolvedValue(device);
    await authService.revokeDevice({ id: 'some-id' });
    expect(deviceMocks.deleteOne).toHaveBeenCalledWith({ _id: 'some-id' });
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.device.revoked', entityType: 'DeviceSession', values: { revokedDeviceId: 'd-old' } }),
    );
  });

  it('rejects when the device does not exist', async () => {
    deviceMocks.findById.mockResolvedValue(null);
    await expect(authService.revokeDevice({ id: 'missing' })).rejects.toMatchObject({ statusCode: 404 });
    expect(deviceMocks.deleteOne).not.toHaveBeenCalled();
  });
});

describe('changePassword', () => {
  it('rejects an incorrect current password and never touches other devices', async () => {
    shopAuthMocks.findOne.mockReturnValue(mockQuery(makeAuthDoc()));
    verifyPassword.mockResolvedValue(false);

    await expect(
      authService.changePassword({ currentPassword: 'wrong', newPassword: 'newpass', currentDeviceId: 'd1' }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(deviceMocks.updateMany).not.toHaveBeenCalled();
  });

  it('updates the password hash and signs out every OTHER device, keeping the current one', async () => {
    const auth = makeAuthDoc();
    shopAuthMocks.findOne.mockReturnValue(mockQuery(auth));
    verifyPassword.mockResolvedValue(true);

    await authService.changePassword({ currentPassword: 'current-password', newPassword: 'new-password', currentDeviceId: 'd1' });

    expect(hashPassword).toHaveBeenCalledWith('new-password');
    expect(auth.passwordHash).toBe('hashed(new-password)');
    expect(auth.save).toHaveBeenCalled();
    expect(deviceMocks.updateMany).toHaveBeenCalledWith(
      { deviceId: { $ne: 'd1' } },
      { $set: { refreshTokenHash: null } },
    );
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password.changed', entityType: 'ShopAuth' }),
    );
  });
});
