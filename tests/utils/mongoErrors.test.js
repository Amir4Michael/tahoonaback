import { describe, it, expect } from 'vitest';
import { isDuplicateKeyError } from '../../src/utils/mongoErrors.js';

describe('isDuplicateKeyError', () => {
  it('recognizes MongoDB error code 11000', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
  });

  it('recognizes MongoDB error code 11001', () => {
    expect(isDuplicateKeyError({ code: 11001 })).toBe(true);
  });

  it('returns false for an unrelated error', () => {
    expect(isDuplicateKeyError(new TypeError('boom'))).toBe(false);
    expect(isDuplicateKeyError({ code: 500 })).toBe(false);
  });

  it('handles null/undefined safely', () => {
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
  });
});
