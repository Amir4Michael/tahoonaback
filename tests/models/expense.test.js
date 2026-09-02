import { describe, it, expect } from 'vitest';
import Expense from '../../src/models/Expense.js';
import { findIndex } from './_helpers.js';

describe('Expense schema', () => {
  it('accepts a valid expense', () => {
    const err = new Expense({ reason: 'إيجار', amount: 3000 }).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires a reason', () => {
    const err = new Expense({ amount: 100 }).validateSync();
    expect(err.errors.reason).toBeDefined();
  });

  it('rejects a zero or negative amount (must be strictly positive)', () => {
    const errZero = new Expense({ reason: 'كهرباء', amount: 0 }).validateSync();
    expect(errZero.errors.amount).toBeDefined();

    const errNeg = new Expense({ reason: 'كهرباء', amount: -50 }).validateSync();
    expect(errNeg.errors.amount).toBeDefined();
  });

  it('rounds the amount to 2 decimal places', () => {
    const e = new Expense({ reason: 'نقل', amount: 199.999 });
    expect(e.amount).toBe(200);
  });

  it('declares a date index for chronological listing/reports', () => {
    expect(findIndex(Expense, { date: -1 })).toBeDefined();
  });
});
