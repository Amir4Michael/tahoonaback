import { describe, it, expect } from 'vitest';
import Customer from '../../src/models/Customer.js';
import { findIndex } from './_helpers.js';

describe('Customer schema', () => {
  it('accepts a valid customer with just a name', () => {
    const err = new Customer({ name: 'أحمد محمود' }).validateSync();
    expect(err).toBeUndefined();
  });

  it('requires a name', () => {
    const err = new Customer({ phone: '01012345678' }).validateSync();
    expect(err.errors.name).toBeDefined();
  });

  it('defaults phone/address to empty strings', () => {
    const c = new Customer({ name: 'أحمد' });
    expect(c.phone).toBe('');
    expect(c.address).toBe('');
  });

  it('trims fields', () => {
    const c = new Customer({ name: '  أحمد محمود  ', phone: ' 01012345678 ' });
    expect(c.name).toBe('أحمد محمود');
    expect(c.phone).toBe('01012345678');
  });

  it('declares a text index for quick search and a phone index', () => {
    const textIdx = findIndex(Customer, { name: 'text', phone: 'text' });
    expect(textIdx).toBeDefined();
    expect(findIndex(Customer, { phone: 1 })).toBeDefined();
  });
});
