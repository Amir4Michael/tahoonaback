import { describe, it, expect } from 'vitest';
import Supplier from '../../src/models/Supplier.js';
import { findIndex } from './_helpers.js';

describe('Supplier schema', () => {
  it('accepts a valid supplier with just a name', () => {
    const err = new Supplier({ name: 'شركة المتحدة لقطع الغيار' }).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires a name', () => {
    const err = new Supplier({ phone: '0223456789' }).validateSync();
    expect(err.errors.name).toBeDefined();
  });

  it('defaults phone/address to empty strings', () => {
    const s = new Supplier({ name: 'مورد' });
    expect(s.phone).toBe('');
    expect(s.address).toBe('');
  });

  it('declares a text index for quick search and a phone index', () => {
    expect(findIndex(Supplier, { name: 'text', phone: 'text' })).toBeDefined();
    expect(findIndex(Supplier, { phone: 1 })).toBeDefined();
  });
});
