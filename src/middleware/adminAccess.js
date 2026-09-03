import crypto from 'node:crypto';
import { AppError } from './errorHandler.js';
import { logger } from '../config/logger.js';
import env from '../config/env.js';

/**
 * Gate for /api/admin/* — the future System 5's read-only view into this
 * shop's full data. Deliberately independent from `requireAuth` (JWT/device
 * login, see middleware/auth.js): that mechanism represents "the shop is
 * logged in on a registered device" and was never designed to express a
 * separate, external, permanently-read-only caller. Reusing it would mean
 * either handing System 5 a real shop session (full read/write, wrong shape
 * entirely) or bolting a role field onto a token payload that intentionally
 * has none. A single static key checked here is simpler, and — combined with
 * every route in admin.route.js being GET-only by construction, not by a
 * permission check — makes "read-only" a structural fact rather than a rule
 * that could be misapplied to one forgotten route.
 *
 * Compares with a constant-time check so response timing can't be used to
 * guess the key one byte at a time.
 */
export function requireAdminReadKey(req, res, next) {
  if (!env.ADMIN_READONLY_KEY) {
    next(new AppError('الوصول المركزي للقراءة غير مُفعّل على هذا النظام', 503));
    return;
  }

  const provided = req.headers['x-admin-key'];

  if (!provided || typeof provided !== 'string') {
    next(new AppError('مفتاح الوصول المركزي مطلوب', 401));
    return;
  }

  const expected = Buffer.from(env.ADMIN_READONLY_KEY);
  const actual = Buffer.from(provided);

  // timingSafeEqual throws on length mismatch rather than returning false,
  // and requires equal-length buffers — pad the comparison so a wrong-length
  // key still takes the "compare" path instead of short-circuiting on length,
  // which would leak the correct key's length via timing.
  const isValid =
    expected.length === actual.length
      ? crypto.timingSafeEqual(expected, actual)
      : false;

  if (!isValid) {
    logger.warn({ path: req.originalUrl, ip: req.ip }, 'Rejected /api/admin request: invalid key');
    next(new AppError('مفتاح الوصول المركزي غير صحيح', 401));
    return;
  }

  logger.info({ path: req.originalUrl, ip: req.ip }, 'Admin read-only access');
  req.isAdminReadOnly = true;
  next();
}

export default requireAdminReadKey;
