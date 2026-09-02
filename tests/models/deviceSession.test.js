import { describe, it, expect } from 'vitest';
import DeviceSession from '../../src/models/DeviceSession.js';
import { findIndex } from './_helpers.js';

describe('DeviceSession schema', () => {
  it('accepts a valid device with just a deviceId', () => {
    const err = new DeviceSession({ deviceId: 'client-generated-uuid' }).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires deviceId', () => {
    const err = new DeviceSession({}).validateSync();
    expect(err.errors.deviceId).toBeDefined();
  });

  it('defaults label/userAgent/lastIp to empty strings and refreshTokenHash to null', () => {
    const d = new DeviceSession({ deviceId: 'abc' });
    expect(d.label).toBe('');
    expect(d.userAgent).toBe('');
    expect(d.lastIp).toBe('');
    expect(d.refreshTokenHash).toBeNull();
  });

  it('excludes refreshTokenHash from query results by default (select: false)', () => {
    expect(DeviceSession.schema.path('refreshTokenHash').options.select).toBe(false);
  });

  it('declares a unique index on deviceId (one document per physical device)', () => {
    const idx = findIndex(DeviceSession, { deviceId: 1 });
    expect(idx).toBeDefined();
    expect(idx[1].unique).toBe(true);
  });

  it('declares an index on lastActiveAt for the device list', () => {
    expect(findIndex(DeviceSession, { lastActiveAt: -1 })).toBeDefined();
  });
});
