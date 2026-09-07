import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import SalesReturn from '../../src/models/SalesReturn.js';
import { findIndex } from './_helpers.js';

const saleId = new mongoose.Types.ObjectId();
const customerId = new mongoose.Types.ObjectId();
const productId = new mongoose.Types.ObjectId();

const validReturn = () => ({
  saleId,
  customerId,
  items: [
    { productId, name: 'فلتر زيت', code: 'P-1001', returnedQuantity: 2, originalUnitPrice: 100, returnAmount: 200 },
  ],
  totalReturnAmount: 200,
  idempotencyKey: 'idem-key-1',
});

describe('SalesReturn schema', () => {
  it('accepts a valid return', () => {
    const err = new SalesReturn(validReturn()).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires a saleId', () => {
    const err = new SalesReturn({ ...validReturn(), saleId: undefined }).validateSync();
    expect(err.errors.saleId).toBeDefined();
  });

  it('requires a customerId (a return only ever applies to a registered customer\'s sale)', () => {
    const err = new SalesReturn({ ...validReturn(), customerId: undefined }).validateSync();
    expect(err.errors.customerId).toBeDefined();
  });

  it('requires at least one item', () => {
    const err = new SalesReturn({ ...validReturn(), items: [] }).validateSync();
    expect(err.errors.items).toBeDefined();
  });

  it('requires an idempotencyKey', () => {
    const err = new SalesReturn({ ...validReturn(), idempotencyKey: undefined }).validateSync();
    expect(err.errors.idempotencyKey).toBeDefined();
  });

  it('rejects a line with returnedQuantity < 1', () => {
    const err = new SalesReturn({
      ...validReturn(),
      items: [{ productId, name: 'فلتر زيت', returnedQuantity: 0, originalUnitPrice: 100, returnAmount: 0 }],
    }).validateSync();
    expect(err.errors['items.0.returnedQuantity']).toBeDefined();
  });

  it('rejects a negative totalReturnAmount', () => {
    const err = new SalesReturn({ ...validReturn(), totalReturnAmount: -1 }).validateSync();
    expect(err.errors.totalReturnAmount).toBeDefined();
  });

  it('does not give line items their own _id (plain snapshot, not an entity)', () => {
    const doc = new SalesReturn(validReturn());
    expect(doc.items[0]._id).toBeUndefined();
  });

  it('defaults date to now when omitted', () => {
    const doc = new SalesReturn(validReturn());
    expect(doc.date).toBeInstanceOf(Date);
  });

  it('declares a unique index on idempotencyKey (duplicate-submission guard)', () => {
    const idx = findIndex(SalesReturn, { idempotencyKey: 1 });
    expect(idx).toBeDefined();
    expect(idx[1].unique).toBe(true);
  });

  it('declares supporting indexes for per-sale and per-customer lookups', () => {
    expect(findIndex(SalesReturn, { saleId: 1 })).toBeDefined();
    expect(findIndex(SalesReturn, { customerId: 1, date: -1 })).toBeDefined();
  });
});
