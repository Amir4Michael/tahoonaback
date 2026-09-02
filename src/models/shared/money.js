/**
 * Round to 2 decimal places. Applied as a Mongoose `set` transform on every
 * money field so floating-point drift never accumulates across repeated
 * writes — most importantly the weighted-average cost recalculation done on
 * every purchase (see the Purchases phase), which chains float arithmetic
 * across many small operations over a product's lifetime.
 */
export const round2 = (value) => (typeof value === 'number' && !Number.isNaN(value) ? Math.round(value * 100) / 100 : value);

/**
 * Shared shape for a non-negative money field (prices, totals, amounts).
 * Pass `overrides` to change `required`/`min`/`default` etc. for a specific
 * field (e.g. an expense amount that must be > 0, not just >= 0).
 */
export const moneyField = (overrides = {}) => ({
  type: Number,
  min: 0,
  default: 0,
  set: round2,
  ...overrides,
});

export default { round2, moneyField };
