import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import Purchase from '../../src/models/Purchase.js';
import { findIndex } from './_helpers.js';

const productId = new mongoose.Types.ObjectId();
const supplierId = new mongoose.Types.ObjectId();

const validPurchase = () => ({
  purchaseNumber: 'PUR-1001',
  supplierId,
  items: [
    { productId, name: 'فلتر زيت', code: 'P-1001', price: 15, quantity: 6 },
  ],
  total: 90,
  paid: 90,
  remaining: 0,
  paymentMethod: 'cash',
  notes: '',
});

describe('Purchase schema', () => {
  it('accepts a valid purchase', () => {
    const err = new Purchase(validPurchase()).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires a supplierId', () => {
    const err = new Purchase({ ...validPurchase(), supplierId: undefined }).validateSync();
    expect(err.errors.supplierId).toBeDefined();
  });

  it('requires at least one item', () => {
    const err = new Purchase({ ...validPurchase(), items: [] }).validateSync();
    expect(err.errors.items).toBeDefined();
  });

  it('rejects a negative or zero-priced line item price below the field minimum', () => {
    const err = new Purchase({
      ...validPurchase(),
      items: [{ productId, name: 'فلتر زيت', price: -1, quantity: 1 }],
    }).validateSync();
    expect(err.errors['items.0.price']).toBeDefined();
  });

  it('allows backdating via the date field (matches the current purchase form)', () => {
    const backdated = new Date('2026-01-01T12:00:00.000Z');
    const purchase = new Purchase({ ...validPurchase(), date: backdated });
    expect(purchase.date.toISOString()).toBe(backdated.toISOString());
  });

  it('defaults notes to an empty string', () => {
    const p = new Purchase({ ...validPurchase(), notes: undefined });
    expect(p.notes).toBe('');
  });

  it('declares a unique index on purchaseNumber', () => {
    const idx = findIndex(Purchase, { purchaseNumber: 1 });
    expect(idx).toBeDefined();
    expect(idx[1].unique).toBe(true);
  });

  it('declares supporting indexes for supplier history and date-range reports', () => {
    expect(findIndex(Purchase, { supplierId: 1, date: -1 })).toBeDefined();
    expect(findIndex(Purchase, { date: -1 })).toBeDefined();
  });
});
