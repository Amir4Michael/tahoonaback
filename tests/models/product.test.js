import { describe, it, expect } from 'vitest';
import Product from '../../src/models/Product.js';
import { findIndex } from './_helpers.js';

const validProduct = () => ({
  name: 'فلتر زيت',
  code: 'P-1001',
  purchasePrice: 80,
  salePrice: 120,
  quantity: 24,
  minQuantity: 6,
  notes: 'فلتر زيت تويوتا',
  image: '',
});

describe('Product schema', () => {
  it('accepts a valid product', () => {
    const err = new Product(validProduct()).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires name and code', () => {
    const err1 = new Product({ ...validProduct(), name: '' }).validateSync();
    expect(err1?.errors.name).toBeDefined();

    const err2 = new Product({ ...validProduct(), code: '' }).validateSync();
    expect(err2?.errors.code).toBeDefined();
  });

  it('rejects negative prices/quantities', () => {
    const err = new Product({ ...validProduct(), purchasePrice: -5, salePrice: -1, quantity: -1, minQuantity: -1 }).validateSync();
    expect(err.errors.purchasePrice).toBeDefined();
    expect(err.errors.salePrice).toBeDefined();
    expect(err.errors.quantity).toBeDefined();
    expect(err.errors.minQuantity).toBeDefined();
  });

  it('defaults quantity/minQuantity/prices/notes/image when omitted', () => {
    const p = new Product({ name: 'منتج', code: 'P-9999' });
    expect(p.purchasePrice).toBe(0);
    expect(p.salePrice).toBe(0);
    expect(p.quantity).toBe(0);
    expect(p.minQuantity).toBe(0);
    expect(p.notes).toBe('');
    expect(p.image).toBe('');
  });

  it('rounds money fields to 2 decimal places', () => {
    const p = new Product({ ...validProduct(), purchasePrice: 12.505, salePrice: 19.999 });
    expect(p.purchasePrice).toBe(12.51);
    expect(p.salePrice).toBe(20);
  });

  it('trims name/code and enforces max lengths', () => {
    const p = new Product({ ...validProduct(), name: '  فلتر زيت  ' });
    expect(p.name).toBe('فلتر زيت');

    const err = new Product({ ...validProduct(), name: 'x'.repeat(201) }).validateSync();
    expect(err.errors.name).toBeDefined();
  });

  it('declares a unique index on code', () => {
    const idx = findIndex(Product, { code: 1 });
    expect(idx).toBeDefined();
    expect(idx[1].unique).toBe(true);
  });

  it('declares supporting indexes for search and stock threshold queries', () => {
    expect(findIndex(Product, { name: 1 })).toBeDefined();
    expect(findIndex(Product, { quantity: 1 })).toBeDefined();
  });
});
