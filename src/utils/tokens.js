import crypto from 'node:crypto';

/**
 * Refresh tokens are opaque, high-entropy random strings — not JWTs. Unlike
 * the short-lived access token (which benefits from being self-contained and
 * verifiable by signature alone, without a DB round-trip), a refresh token's
 * only job is to be looked up against the one device record it belongs to,
 * so a random value plus a stored hash is simpler and just as secure.
 */
export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex'); // 384 bits of entropy
}

/**
 * Hashed with SHA-256 rather than bcrypt: bcrypt's deliberate slowness exists
 * to resist brute-forcing a low-entropy human password. A 384-bit random
 * token has nothing to brute-force — a fast, constant-time-compared SHA-256
 * hash is the standard, appropriate choice here (the same approach used for
 * opaque OAuth refresh/reference tokens).
 */
export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison so response timing can't leak how much of the token matched. */
export function compareRefreshToken(token, hash) {
  if (!token || !hash) return false;
  const a = Buffer.from(hashRefreshToken(token));
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
