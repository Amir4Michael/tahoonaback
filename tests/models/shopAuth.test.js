import { describe, it, expect } from 'vitest';
import ShopAuth from '../../src/models/ShopAuth.js';

describe('ShopAuth schema', () => {
  it('accepts a valid document and defaults the singleton key', () => {
    const auth = new ShopAuth({ passwordHash: 'some-bcrypt-hash' });
    expect(auth.validateSync()).toBeUndefined();
    expect(auth.singletonKey).toBe(ShopAuth.SINGLETON_KEY);
  });

  it('requires passwordHash', () => {
    const err = new ShopAuth({}).validateSync();
    expect(err.errors.passwordHash).toBeDefined();
  });

  it('excludes passwordHash from query results by default (select: false)', () => {
    expect(ShopAuth.schema.path('passwordHash').options.select).toBe(false);
  });

  it('declares a unique, immutable singletonKey (enforces a single document)', () => {
    const path = ShopAuth.schema.path('singletonKey');
    expect(path.options.unique).toBe(true);
    expect(path.options.immutable).toBe(true);
  });
});
