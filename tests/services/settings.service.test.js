import { describe, it, expect, vi, beforeEach } from 'vitest';

const activityMocks = vi.hoisted(() => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/activityLog.service.js', () => ({
  recordActivity: (...args) => activityMocks.recordActivity(...args),
}));

const auditMocks = vi.hoisted(() => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/auditLog.service.js', () => ({
  recordAuditLog: (...args) => auditMocks.recordAuditLog(...args),
}));

const settingsMocks = vi.hoisted(() => ({ findOneAndUpdate: vi.fn() }));
vi.mock('../../src/models/Settings.js', () => ({
  default: {
    findOneAndUpdate: (...args) => settingsMocks.findOneAndUpdate(...args),
    SINGLETON_KEY: 'system1_settings',
  },
}));

import { getSettings, updateSettings } from '../../src/services/settings.service.js';

function makeSettingsDoc(overrides = {}) {
  return {
    _id: 'settings-1',
    shopName: 'محل النور',
    ownerName: '',
    phone: '',
    address: '',
    invoiceFooter: '',
    lowStockThreshold: 5,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSettings', () => {
  it('upserts the singleton with defaults on first access', async () => {
    const doc = makeSettingsDoc();
    settingsMocks.findOneAndUpdate.mockResolvedValue(doc);

    const result = await getSettings();

    expect(result).toBe(doc);
    const [filter, update, options] = settingsMocks.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ singletonKey: 'system1_settings' });
    expect(update.$setOnInsert).toMatchObject({ singletonKey: 'system1_settings', lowStockThreshold: 5 });
    expect(options).toMatchObject({ upsert: true, new: true });
  });

  it('returns the existing document unchanged on subsequent calls (no defaults overwrite real data)', async () => {
    const doc = makeSettingsDoc({ shopName: 'اسم حقيقي مُعدَّل' });
    settingsMocks.findOneAndUpdate.mockResolvedValue(doc);
    const result = await getSettings();
    expect(result.shopName).toBe('اسم حقيقي مُعدَّل');
  });
});

describe('updateSettings', () => {
  it('applies a true partial update (only provided fields change)', async () => {
    const doc = makeSettingsDoc({ shopName: 'اسم قديم', phone: '0100000000' });
    settingsMocks.findOneAndUpdate.mockResolvedValue(doc);

    await updateSettings({ shopName: 'اسم جديد' });

    expect(doc.shopName).toBe('اسم جديد');
    expect(doc.phone).toBe('0100000000'); // untouched
    expect(doc.save).toHaveBeenCalled();
  });

  it('records an activity entry and a precise audit diff', async () => {
    const doc = makeSettingsDoc({ lowStockThreshold: 5 });
    settingsMocks.findOneAndUpdate.mockResolvedValue(doc);

    await updateSettings({ lowStockThreshold: 10 });

    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings' }),
    );
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.update',
        entityType: 'Settings',
        values: { changed: ['lowStockThreshold'], before: { lowStockThreshold: 5 }, after: { lowStockThreshold: 10 } },
      }),
    );
  });
});
