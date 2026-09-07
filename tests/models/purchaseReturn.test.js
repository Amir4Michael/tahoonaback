import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import PurchaseReturn from '../../src/models/PurchaseReturn.js';
import { findIndex } from './_helpers.js';

const purchaseId = new mongoose.Types.ObjectId();
const supplierId = new mongoose.Types.ObjectId();
const productId = new mongoose.Types.ObjectId();

const validReturn = () => ({
  purchaseId,
  supplierId,
  items: [
    { productId, name: 'فلتر زيت', code: 'P-1001', returnedQuantity: 3, originalUnitPrice: 100, returnAmount: 300 },
  ],
  totalReturnAmount: 300,
  idempotencyKey: 'idem-key-1',
});

describe('PurchaseReturn schema', () => {
  it('accepts a valid return', () => {
    const err = new PurchaseReturn(validReturn()).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires a purchaseId', () => {
    const err = new PurchaseReturn({ ...validReturn(), purchaseId: undefined }).validateSync();
    expect(err.errors.purchaseId).toBeDefined();
  });

  it('requires a supplierId', () => {
    const err = new PurchaseReturn({ ...validReturn(), supplierId: undefined }).validateSync();
    expect(err.errors.supplierId).toBeDefined();
  });

  it('requires at least one item', () => {
    const err = new PurchaseReturn({ ...validReturn(), items: [] }).validateSync();
    expect(err.errors.items).toBeDefined();
  });

  it('requires an idempotencyKey', () => {
    const err = new PurchaseReturn({ ...validReturn(), idempotencyKey: undefined }).validateSync();
    expect(err.errors.idempotencyKey).toBeDefined();
  });

  it('rejects a line with returnedQuantity < 1', () => {
    const err = new PurchaseReturn({
      ...validReturn(),
      items: [{ productId, name: 'فلتر زيت', returnedQuantity: 0, originalUnitPrice: 100, returnAmount: 0 }],
    }).validateSync();
    expect(err.errors['items.0.returnedQuantity']).toBeDefined();
  });

  it('rejects a negative totalReturnAmount', () => {
    const err = new PurchaseReturn({ ...validReturn(), totalReturnAmount: -1 }).validateSync();
    expect(err.errors.totalReturnAmount).toBeDefined();
  });

  it('does not give line items their own _id (plain snapshot, not an entity)', () => {
    const doc = new PurchaseReturn(validReturn());
    expect(doc.items[0]._id).toBeUndefined();
  });

  it('defaults date to now when omitted', () => {
    const doc = new PurchaseReturn(validReturn());
    expect(doc.date).toBeInstanceOf(Date);
  });

  it('declares a unique index on idempotencyKey (duplicate-submission guard)', () => {
    const idx = findIndex(PurchaseReturn, { idempotencyKey: 1 });
    expect(idx).toBeDefined();
    expect(idx[1].unique).toBe(true);
  });

  it('declares supporting indexes for per-purchase and per-supplier lookups', () => {
    expect(findIndex(PurchaseReturn, { purchaseId: 1 })).toBeDefined();
    expect(findIndex(PurchaseReturn, { supplierId: 1, date: -1 })).toBeDefined();
  });
});
