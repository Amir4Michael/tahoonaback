import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

describe('signAccessToken / verifyAccessToken', () => {
  it('round-trips a valid token carrying the deviceId', async () => {
    const { signAccessToken, verifyAccessToken } = await import('../../src/config/jwt.js');
    const token = signAccessToken({ deviceId: 'device-abc' });
    const payload = verifyAccessToken(token);
    expect(payload.deviceId).toBe('device-abc');
    expect(payload.sub).toBe('shop');
  });

  it('rejects a token signed with a different secret', async () => {
    const { verifyAccessToken } = await import('../../src/config/jwt.js');
    const forged = jwt.sign({ deviceId: 'device-abc' }, 'wrong-secret', { subject: 'shop', expiresIn: '15m' });
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it('rejects an expired token', async () => {
    const { verifyAccessToken } = await import('../../src/config/jwt.js');
    const expired = jwt.sign(
      { deviceId: 'device-abc' },
      process.env.JWT_ACCESS_SECRET,
      { subject: 'shop', expiresIn: -10 }, // already expired
    );
    expect(() => verifyAccessToken(expired)).toThrow(/expired/i);
  });

  it('rejects a token issued for a different subject', async () => {
    const { verifyAccessToken } = await import('../../src/config/jwt.js');
    const wrongSubject = jwt.sign(
      { deviceId: 'device-abc' },
      process.env.JWT_ACCESS_SECRET,
      { subject: 'someone-else', expiresIn: '15m' },
    );
    expect(() => verifyAccessToken(wrongSubject)).toThrow();
  });
});

describe('signAccessToken without JWT_ACCESS_SECRET configured', () => {
  const ORIGINAL = process.env.JWT_ACCESS_SECRET;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.JWT_ACCESS_SECRET;
  });

  afterEach(() => {
    process.env.JWT_ACCESS_SECRET = ORIGINAL;
  });

  it('throws a clear, actionable error instead of signing with nothing', async () => {
    const { signAccessToken } = await import('../../src/config/jwt.js');
    expect(() => signAccessToken({ deviceId: 'device-abc' })).toThrow(/JWT_ACCESS_SECRET/);
  });
});
