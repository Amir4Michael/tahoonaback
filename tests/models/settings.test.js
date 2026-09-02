import { describe, it, expect } from 'vitest';
import Settings from '../../src/models/Settings.js';

describe('Settings schema', () => {
  it('accepts valid settings and defaults the singleton key', () => {
    const s = new Settings({ shopName: 'محل النور لقطع غيار السيارات' });
    const err = s.validateSync();
    expect(err).toBeUndefined();
    expect(s.singletonKey).toBe(Settings.SINGLETON_KEY);
  });

  it('requires shopName', () => {
    const err = new Settings({}).validateSync();
    expect(err.errors.shopName).toBeDefined();
  });

  it('defaults lowStockThreshold to 5 and rejects negative values', () => {
    const s = new Settings({ shopName: 'محل' });
    expect(s.lowStockThreshold).toBe(5);

    const err = new Settings({ shopName: 'محل', lowStockThreshold: -1 }).validateSync();
    expect(err.errors.lowStockThreshold).toBeDefined();
  });

  it('never defines a password/access-code field — the schema has no such path', () => {
    expect(Settings.schema.path('accessCode')).toBeUndefined();
    expect(Settings.schema.path('password')).toBeUndefined();
    expect(Settings.schema.path('loginPassword')).toBeUndefined();
  });

  it('declares a unique index on singletonKey (enforces a single document)', () => {
    const idx = Settings.schema.path('singletonKey');
    expect(idx.options.unique).toBe(true);
    expect(idx.options.immutable).toBe(true);
  });
});
