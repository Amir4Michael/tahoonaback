import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/auth.service.js', () => ({
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  listDevices: vi.fn(),
  revokeDevice: vi.fn(),
  changePassword: vi.fn(),
}));

const authService = await import('../../src/services/auth.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/login', () => {
  it('returns 400 for a missing password/deviceId without calling the service', async () => {
    const app = createApp();
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('delegates to the service and returns its result on success', async () => {
    authService.login.mockResolvedValue({
      accessToken: 'a', refreshToken: 'r', expiresInMinutes: 15,
      device: { deviceId: 'd1', isCurrent: true },
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: '123456', deviceId: 'd1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBe('a');
    expect(authService.login).toHaveBeenCalledWith(
      expect.objectContaining({ password: '123456', deviceId: 'd1' }),
    );
  });

  it('propagates a service error (e.g. device limit reached) with its status code and details', async () => {
    const err = new Error('تم الوصول للحد الأقصى للأجهزة المسجلة');
    err.statusCode = 403;
    err.isOperational = true;
    err.details = { code: 'DEVICE_LIMIT_REACHED', devices: [] };
    authService.login.mockRejectedValue(err);

    const app = createApp();
    const res = await request(app).post('/api/auth/login').send({ password: 'x', deviceId: 'd1' });

    expect(res.status).toBe(403);
    expect(res.body.error.details.code).toBe('DEVICE_LIMIT_REACHED');
  });
});

describe('POST /api/auth/refresh', () => {
  it('returns 400 for a missing refreshToken', async () => {
    const app = createApp();
    const res = await request(app).post('/api/auth/refresh').send({ deviceId: 'd1' });
    expect(res.status).toBe(400);
  });

  it('delegates to the service on a well-formed request', async () => {
    authService.refresh.mockResolvedValue({ accessToken: 'a2', refreshToken: 'r2', expiresInMinutes: 15 });
    const app = createApp();
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'r1', deviceId: 'd1' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBe('a2');
  });
});

describe('authenticated device-management routes', () => {
  const validToken = () => signAccessToken({ deviceId: 'd1' });

  it('GET /api/auth/devices requires authentication', async () => {
    const app = createApp();
    const res = await request(app).get('/api/auth/devices');
    expect(res.status).toBe(401);
    expect(authService.listDevices).not.toHaveBeenCalled();
  });

  it('GET /api/auth/devices returns the service result when authenticated', async () => {
    authService.listDevices.mockResolvedValue([{ deviceId: 'd1', isCurrent: true }]);
    const app = createApp();
    const res = await request(app).get('/api/auth/devices').set('Authorization', `Bearer ${validToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(authService.listDevices).toHaveBeenCalledWith({ currentDeviceId: 'd1' });
  });

  it('DELETE /api/auth/devices/:id requires authentication and forwards the id', async () => {
    const app = createApp();
    const unauth = await request(app).delete('/api/auth/devices/abc123');
    expect(unauth.status).toBe(401);

    authService.revokeDevice.mockResolvedValue({ success: true });
    const res = await request(app).delete('/api/auth/devices/abc123').set('Authorization', `Bearer ${validToken()}`);
    expect(res.status).toBe(200);
    expect(authService.revokeDevice).toHaveBeenCalledWith({ id: 'abc123' });
  });

  it('POST /api/auth/logout requires authentication and uses the token deviceId, not a body one', async () => {
    authService.logout.mockResolvedValue({ success: true });
    const app = createApp();
    const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${validToken()}`);
    expect(res.status).toBe(200);
    expect(authService.logout).toHaveBeenCalledWith({ deviceId: 'd1' });
  });

  it('PATCH /api/auth/password requires authentication and validates the body', async () => {
    const app = createApp();
    const unauth = await request(app).patch('/api/auth/password').send({ currentPassword: 'a', newPassword: 'b' });
    expect(unauth.status).toBe(401);

    const badBody = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${validToken()}`)
      .send({ currentPassword: 'a', newPassword: 'ab' }); // too short
    expect(badBody.status).toBe(400);
    expect(authService.changePassword).not.toHaveBeenCalled();

    authService.changePassword.mockResolvedValue({ success: true });
    const ok = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${validToken()}`)
      .send({ currentPassword: 'a', newPassword: 'newpass123' });
    expect(ok.status).toBe(200);
    expect(authService.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ currentPassword: 'a', newPassword: 'newpass123', currentDeviceId: 'd1' }),
    );
  });
});
