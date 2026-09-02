import { AppError } from './errorHandler.js';
import { verifyAccessToken } from '../config/jwt.js';
import { runWithContext } from '../utils/requestContext.js';

/**
 * Requires a valid `Authorization: Bearer <accessToken>` header. On success,
 * attaches `req.auth = { deviceId }` — every authenticated route in this
 * single-account system only ever needs to know which device is asking —
 * and runs the rest of the request inside a context carrying that deviceId
 * (see utils/requestContext.js), which is how audit logging identifies the
 * acting device deep inside a service call without an explicit parameter.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    next(new AppError('يجب تسجيل الدخول', 401));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.auth = { deviceId: payload.deviceId };
    runWithContext({ deviceId: payload.deviceId }, next);
  } catch {
    next(new AppError('جلسة الدخول غير صالحة أو منتهية، يرجى تسجيل الدخول مرة أخرى', 401));
  }
}

export default requireAuth;
