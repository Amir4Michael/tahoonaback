import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import SupplierPayment from '../../src/models/SupplierPayment.js';
import { findIndex } from './_helpers.js';

const supplierId = new mongoose.Types.ObjectId();

const validPayment = () => ({
  supplierId,
  amount: 1000,
  balanceAfter: 1000,
});

describe('SupplierPayment schema', () => {
  it('accepts a valid payment', () => {
    const err = new SupplierPayment(validPayment()).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires a supplierId', () => {
    const err = new SupplierPayment({ ...validPayment(), supplierId: undefined }).validateSync();
    expect(err.errors.supplierId).toBeDefined();
  });

  it('rejects an amount of 0 (must be strictly positive)', () => {
    const err = new SupplierPayment({ ...validPayment(), amount: 0 }).validateSync();
    expect(err.errors.amount).toBeDefined();
  });

  it('rejects a negative amount', () => {
    const err = new SupplierPayment({ ...validPayment(), amount: -10 }).validateSync();
    expect(err.errors.amount).toBeDefined();
  });

  it('rejects a negative balanceAfter', () => {
    const err = new SupplierPayment({ ...validPayment(), balanceAfter: -5 }).validateSync();
    expect(err.errors.balanceAfter).toBeDefined();
  });

  it('allows balanceAfter to be exactly 0 (fully settled)', () => {
    const err = new SupplierPayment({ ...validPayment(), balanceAfter: 0 }).validateSync();
    expect(err).toBeUndefined();
  });

  it('defaults note to an empty string', () => {
    const p = new SupplierPayment({ ...validPayment(), note: undefined });
    expect(p.note).toBe('');
  });

  it('defaults date to now when omitted', () => {
    const p = new SupplierPayment(validPayment());
    expect(p.date).toBeInstanceOf(Date);
  });

  it('rounds amount/balanceAfter to 2 decimal places like every other money field', () => {
    const p = new SupplierPayment({ ...validPayment(), amount: 100.999, balanceAfter: 10.005 });
    expect(p.amount).toBe(101);
    expect(p.balanceAfter).toBe(10.01);
  });

  it("declares a supporting index for a supplier's payment history, newest first", () => {
    expect(findIndex(SupplierPayment, { supplierId: 1, date: -1 })).toBeDefined();
  });
});
