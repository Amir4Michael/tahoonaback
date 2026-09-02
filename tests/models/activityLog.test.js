import { describe, it, expect } from 'vitest';
import ActivityLog from '../../src/models/ActivityLog.js';
import { findIndex } from './_helpers.js';
import { ACTIVITY_TYPES } from '../../src/models/constants.js';

describe('ActivityLog schema', () => {
  it('accepts a valid entry', () => {
    const err = new ActivityLog({ type: 'product', description: 'تمت إضافة منتج جديد: زيت محرك' }).validateSync();
    expect(err).toBeUndefined();
  });

  it('accepts every known activity type', () => {
    for (const type of ACTIVITY_TYPES) {
      const err = new ActivityLog({ type, description: 'وصف' }).validateSync();
      expect(err).toBeUndefined();
    }
  });

  it('rejects an unknown type', () => {
    const err = new ActivityLog({ type: 'unknown_thing', description: 'وصف' }).validateSync();
    expect(err.errors.type).toBeDefined();
  });

  it('requires a description', () => {
    const err = new ActivityLog({ type: 'product' }).validateSync();
    expect(err.errors.description).toBeDefined();
  });

  it('defaults amount to 0 and refId to null', () => {
    const a = new ActivityLog({ type: 'settings', description: 'تم تحديث إعدادات النظام' });
    expect(a.amount).toBe(0);
    expect(a.refId).toBeNull();
  });

  it('declares a date index for the feed', () => {
    expect(findIndex(ActivityLog, { date: -1 })).toBeDefined();
  });
});
