import jwt from 'jsonwebtoken';
import env from './env.js';

function requireSecret() {
  if (!env.JWT_ACCESS_SECRET) {
    throw new Error('JWT_ACCESS_SECRET is not configured — set it in your environment to issue/verify tokens.');
  }
  return env.JWT_ACCESS_SECRET;
}

/**
 * Minimal payload on purpose: there is only one account (the shop), so no
 * roles/permissions/user id to carry — just which registered device this
 * session belongs to, which is what every authenticated route needs to know
 * (e.g. "log out" only clears this device's session).
 */
export function signAccessToken({ deviceId }) {
  return jwt.sign({ deviceId }, requireSecret(), {
    expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`,
    subject: 'shop',
  });
}

/** Throws if the token is missing, malformed, expired, or signed with a different secret. */
export function verifyAccessToken(token) {
  return jwt.verify(token, requireSecret(), { subject: 'shop' });
}
