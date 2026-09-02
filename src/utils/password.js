import bcrypt from 'bcryptjs';
import env from '../config/env.js';

/** Hash a plaintext password for storage. Never store the plaintext itself. */
export async function hashPassword(plain) {
  return bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
}

/** Compare a plaintext password against a stored hash. Safe to call with a missing hash. */
export async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}
