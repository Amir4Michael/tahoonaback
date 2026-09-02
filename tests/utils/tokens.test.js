import { describe, it, expect } from 'vitest';
import { generateRefreshToken, hashRefreshToken, compareRefreshToken } from '../../src/utils/tokens.js';

describe('generateRefreshToken', () => {
  it('produces a long, hex-encoded, unpredictable value', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).toMatch(/^[0-9a-f]+$/);
    expect(a.length).toBe(96); // 48 bytes -> 96 hex chars
    expect(a).not.toBe(b);
  });
});

describe('hashRefreshToken', () => {
  it('is deterministic for the same input', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('produces different hashes for different tokens', () => {
    expect(hashRefreshToken('token-a')).not.toBe(hashRefreshToken('token-b'));
  });
});

describe('compareRefreshToken', () => {
  it('matches a token against its own hash', () => {
    const token = generateRefreshToken();
    expect(compareRefreshToken(token, hashRefreshToken(token))).toBe(true);
  });

  it('rejects a wrong token', () => {
    const token = generateRefreshToken();
    const otherHash = hashRefreshToken(generateRefreshToken());
    expect(compareRefreshToken(token, otherHash)).toBe(false);
  });

  it('safely returns false for missing token/hash instead of throwing', () => {
    expect(compareRefreshToken('', 'somehash')).toBe(false);
    expect(compareRefreshToken('token', '')).toBe(false);
    expect(compareRefreshToken(null, null)).toBe(false);
  });

  it('handles a hash of a different length without throwing', () => {
    expect(compareRefreshToken('token', 'short')).toBe(false);
  });
});
