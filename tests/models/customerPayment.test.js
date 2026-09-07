import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import CustomerPayment from '../../src/models/CustomerPayment.js';
import { findIndex } from './_helpers.js';

const customerId = new mongoose.Types.ObjectId();

const validPayment = () => ({
  customerId,
  amount: 250,
  balanceAfter: 150,
});

describe('CustomerPayment schema', () => {
  it('accepts a valid payment', () => {
    const err = new CustomerPayment(validPayment()).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires a customerId', () => {
    const err = new CustomerPayment({ ...validPayment(), customerId: undefined }).validateSync();
    expect(err.errors.customerId).toBeDefined();
  });

  it('rejects an amount of 0 (must be strictly positive)', () => {
    const err = new CustomerPayment({ ...validPayment(), amount: 0 }).validateSync();
    expect(err.errors.amount).toBeDefined();
  });

  it('rejects a negative amount', () => {
    const err = new CustomerPayment({ ...validPayment(), amount: -10 }).validateSync();
    expect(err.errors.amount).toBeDefined();
  });

  it('rejects a negative balanceAfter', () => {
    const err = new CustomerPayment({ ...validPayment(), balanceAfter: -5 }).validateSync();
    expect(err.errors.balanceAfter).toBeDefined();
  });

  it('allows balanceAfter to be exactly 0 (fully settled)', () => {
    const err = new CustomerPayment({ ...validPayment(), balanceAfter: 0 }).validateSync();
    expect(err).toBeUndefined();
  });

  it('defaults note to an empty string', () => {
    const p = new CustomerPayment({ ...validPayment(), note: undefined });
    expect(p.note).toBe('');
  });

  it('defaults date to now when omitted', () => {
    const p = new CustomerPayment(validPayment());
    expect(p.date).toBeInstanceOf(Date);
  });

  it('rounds amount/balanceAfter to 2 decimal places like every other money field', () => {
    const p = new CustomerPayment({ ...validPayment(), amount: 100.999, balanceAfter: 10.005 });
    expect(p.amount).toBe(101);
    expect(p.balanceAfter).toBe(10.01);
  });

  it('declares a supporting index for a customer\'s payment history, newest first', () => {
    expect(findIndex(CustomerPayment, { customerId: 1, date: -1 })).toBeDefined();
  });
});
