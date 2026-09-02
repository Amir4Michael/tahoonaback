import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';

describe('password hashing', () => {
  it('hashes a password to something other than the plaintext', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).not.toBe('correct-horse-battery-staple');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies the correct password against its hash', async () => {
    const hash = await hashPassword('123456');
    await expect(verifyPassword('123456', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('123456');
    await expect(verifyPassword('654321', hash)).resolves.toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
  });

  it('safely returns false for missing password/hash instead of throwing', async () => {
    await expect(verifyPassword('', 'some-hash')).resolves.toBe(false);
    await expect(verifyPassword('pw', '')).resolves.toBe(false);
    await expect(verifyPassword(null, null)).resolves.toBe(false);
  });
});
