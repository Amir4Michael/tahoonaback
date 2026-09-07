import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import Sale from '../../src/models/Sale.js';
import { findIndex } from './_helpers.js';

const productId = new mongoose.Types.ObjectId();
const customerId = new mongoose.Types.ObjectId();

const validSale = () => ({
  invoiceNumber: 'INV-1001',
  customerId,
  items: [
    { productId, name: 'فلتر زيت', code: 'P-1001', price: 120, cost: 80, quantity: 2 },
  ],
  total: 240,
  paid: 240,
  remaining: 0,
  profit: 80,
  paymentMethod: 'cash',
});

describe('Sale schema', () => {
  it('accepts a valid sale', () => {
    const err = new Sale(validSale()).validateSync();
    expect(err).toBeUndefined();
  });

  it('allows customerId to be null (walk-in / cash customer)', () => {
    const err = new Sale({ ...validSale(), customerId: null }).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires at least one item', () => {
    const err = new Sale({ ...validSale(), items: [] }).validateSync();
    expect(err.errors.items).toBeDefined();
  });

  it('requires a valid paymentMethod', () => {
    const err = new Sale({ ...validSale(), paymentMethod: 'bitcoin' }).validateSync();
    expect(err.errors.paymentMethod).toBeDefined();
  });

  it('rejects a line item with quantity < 1', () => {
    const err = new Sale({
      ...validSale(),
      items: [{ productId, name: 'فلتر زيت', price: 120, cost: 80, quantity: 0 }],
    }).validateSync();
    expect(err.errors['items.0.quantity']).toBeDefined();
  });

  it('allows a line price to differ from any notion of a "base price" — the schema has no such constraint', () => {
    // This is the custom-price-per-sale business rule: nothing here ties
    // items[].price to a product document at all, by design.
    const err = new Sale({
      ...validSale(),
      items: [{ productId, name: 'فلتر زيت', code: 'P-1001', price: 999, cost: 80, quantity: 1 }],
    }).validateSync();
    expect(err).toBeUndefined();
  });

  it('allows profit to be negative (sold below cost)', () => {
    const err = new Sale({
      ...validSale(),
      items: [{ productId, name: 'فلتر زيت', code: 'P-1001', price: 50, cost: 80, quantity: 1 }],
      total: 50,
      profit: -30,
    }).validateSync();
    expect(err).toBeUndefined();
  });

  it('rejects negative total/paid/remaining', () => {
    const err = new Sale({ ...validSale(), total: -1, paid: -1, remaining: -1 }).validateSync();
    expect(err.errors.total).toBeDefined();
    expect(err.errors.paid).toBeDefined();
    expect(err.errors.remaining).toBeDefined();
  });

  it('defaults subtotal to total when omitted (no-discount sales built before this field existed)', () => {
    const sale = new Sale(validSale());
    expect(sale.subtotal).toBe(sale.total);
  });

  it('defaults discount to 0 when omitted', () => {
    const sale = new Sale(validSale());
    expect(sale.discount).toBe(0);
  });

  it('accepts an explicit subtotal/discount pair (subtotal - discount need not be re-validated here — that cross-field rule lives in the service layer)', () => {
    const err = new Sale({ ...validSale(), subtotal: 300, discount: 60, total: 240 }).validateSync();
    expect(err).toBeUndefined();
  });

  it('rejects a negative discount', () => {
    const err = new Sale({ ...validSale(), discount: -5 }).validateSync();
    expect(err.errors.discount).toBeDefined();
  });

  it('rejects a negative subtotal', () => {
    const err = new Sale({ ...validSale(), subtotal: -5 }).validateSync();
    expect(err.errors.subtotal).toBeDefined();
  });

  it('rounds subtotal/discount to 2 decimal places like every other money field', () => {
    const sale = new Sale({ ...validSale(), subtotal: 100.999, discount: 10.005 });
    expect(sale.subtotal).toBe(101);
    expect(sale.discount).toBe(10.01);
  });

  it('does not give line items their own _id (plain snapshot, not an entity)', () => {
    const sale = new Sale(validSale());
    expect(sale.items[0]._id).toBeUndefined();
  });

  it('defaults date to now when omitted', () => {
    const sale = new Sale(validSale());
    expect(sale.date).toBeInstanceOf(Date);
  });

  it('declares a unique index on invoiceNumber', () => {
    const idx = findIndex(Sale, { invoiceNumber: 1 });
    expect(idx).toBeDefined();
    expect(idx[1].unique).toBe(true);
  });

  it('declares supporting indexes for customer history and date-range reports', () => {
    expect(findIndex(Sale, { customerId: 1, date: -1 })).toBeDefined();
    expect(findIndex(Sale, { date: -1 })).toBeDefined();
  });
});
