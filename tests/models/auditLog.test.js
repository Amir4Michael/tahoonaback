import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import AuditLog from '../../src/models/AuditLog.js';
import { findIndex } from './_helpers.js';

describe('AuditLog schema', () => {
  it('accepts a valid entry', () => {
    const entry = new AuditLog({
      action: 'sale.create',
      entityType: 'Sale',
      entityId: new mongoose.Types.ObjectId(),
      actorDeviceId: 'device-1',
      values: { total: 200 },
    });
    expect(entry.validateSync()).toBeUndefined();
  });

  it('requires action and entityType', () => {
    const err = new AuditLog({}).validateSync();
    expect(err.errors.action).toBeDefined();
    expect(err.errors.entityType).toBeDefined();
  });

  it('defaults entityId/actorDeviceId to null and values to an empty object', () => {
    const entry = new AuditLog({ action: 'auth.logout', entityType: 'DeviceSession' });
    expect(entry.entityId).toBeNull();
    expect(entry.actorDeviceId).toBeNull();
    expect(entry.values).toEqual({});
  });

  it('defaults "at" to now', () => {
    const entry = new AuditLog({ action: 'a', entityType: 'b' });
    expect(entry.at).toBeInstanceOf(Date);
  });

  it('strips known-sensitive keys from values before saving, as a defensive backstop', async () => {
    const entry = new AuditLog({
      action: 'auth.password.changed',
      entityType: 'ShopAuth',
      values: { password: 'leaked', newPassword: 'also-leaked', token: 'leaked-too', reason: 'kept' },
    });
    await entry.validate(); // pre('validate') middleware only runs on the async path, not validateSync()
    expect(entry.values.password).toBeUndefined();
    expect(entry.values.newPassword).toBeUndefined();
    expect(entry.values.token).toBeUndefined();
    expect(entry.values.reason).toBe('kept');
  });

  it('declares indexes for chronological listing and entity/action lookups', () => {
    expect(findIndex(AuditLog, { at: -1 })).toBeDefined();
    expect(findIndex(AuditLog, { entityType: 1, entityId: 1 })).toBeDefined();
    expect(findIndex(AuditLog, { action: 1, at: -1 })).toBeDefined();
  });
});
