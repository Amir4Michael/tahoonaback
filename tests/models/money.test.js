import { describe, it, expect } from 'vitest';
import { round2, moneyField } from '../../src/models/shared/money.js';

describe('round2', () => {
  it('rounds to 2 decimal places', () => {
    expect(round2(12.5)).toBe(12.5);
    expect(round2(12.505)).toBe(12.51); // classic float-drift case
    expect(round2(10 / 3)).toBe(3.33);
    expect(round2(0)).toBe(0);
  });

  it('leaves non-numbers untouched (lets schema-level validation reject them)', () => {
    expect(round2(undefined)).toBe(undefined);
    expect(round2(null)).toBe(null);
    expect(round2('abc')).toBe('abc');
    expect(round2(NaN)).toBe(NaN);
  });
});

describe('moneyField', () => {
  it('defaults to a non-negative Number field with a round2 setter', () => {
    const field = moneyField();
    expect(field.type).toBe(Number);
    expect(field.min).toBe(0);
    expect(field.default).toBe(0);
    expect(field.set).toBe(round2);
  });

  it('allows overriding min/required per field', () => {
    const field = moneyField({ required: true, min: 0.01 });
    expect(field.required).toBe(true);
    expect(field.min).toBe(0.01);
    expect(field.set).toBe(round2); // still rounds, even when overridden
  });
});
