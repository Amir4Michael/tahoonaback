import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import CashboxTransaction from '../../src/models/CashboxTransaction.js';
import { findIndex } from './_helpers.js';

describe('CashboxTransaction schema', () => {
  it('accepts a valid manual transaction', () => {
    const err = new CashboxTransaction({ type: 'in', amount: 500, reason: 'رصيد افتتاحي' }).validateSync();
    expect(err).toBeUndefined();
  });

  it('accepts a valid auto-generated transaction linked to a sale', () => {
    const err = new CashboxTransaction({
      type: 'in',
      amount: 240,
      reason: 'تحصيل فاتورة بيع رقم INV-1001',
      refType: 'sale',
      refId: new mongoose.Types.ObjectId(),
    }).validateSync();
    expect(err).toBeUndefined();
  });

  it('rejects an invalid type or refType', () => {
    const errType = new CashboxTransaction({ type: 'sideways', amount: 10, reason: 'x' }).validateSync();
    expect(errType.errors.type).toBeDefined();

    const errRef = new CashboxTransaction({ type: 'in', amount: 10, reason: 'x', refType: 'lottery' }).validateSync();
    expect(errRef.errors.refType).toBeDefined();
  });

  it('rejects a zero or negative amount', () => {
    const err = new CashboxTransaction({ type: 'out', amount: 0, reason: 'سحب' }).validateSync();
    expect(err.errors.amount).toBeDefined();
  });

  it('defaults refType to manual and refId to null', () => {
    const tx = new CashboxTransaction({ type: 'in', amount: 100, reason: 'إيداع' });
    expect(tx.refType).toBe('manual');
    expect(tx.refId).toBeNull();
  });

  it('declares a date index and a refType+refId index', () => {
    expect(findIndex(CashboxTransaction, { date: -1 })).toBeDefined();
    expect(findIndex(CashboxTransaction, { refType: 1, refId: 1 })).toBeDefined();
  });
});
