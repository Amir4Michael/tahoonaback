import { logger } from '../config/logger.js';
import env from '../config/env.js';

/**
 * Throw this (or a subclass) for any expected/handled error — a bad request,
 * a business-rule violation, a 404, etc. `isOperational: true` tells the error
 * handler it's safe to show `message` to the client as-is. Anything else
 * (a bug, an unexpected exception) is treated as internal and hidden from
 * the client in production.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

export function notFoundHandler(req, res, next) {
  next(new AppError(`المسار غير موجود: ${req.method} ${req.originalUrl}`, 404));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const statusCode = Number.isInteger(err.statusCode) ? err.statusCode : 500;
  const isOperational = err.isOperational === true;

  logger.error(
    { err, statusCode, path: req.originalUrl, method: req.method },
    err.message || 'Unhandled error',
  );

  res.status(statusCode).json({
    success: false,
    error: {
      message: isOperational ? err.message : 'حدث خطأ غير متوقع في الخادم',
      ...(isOperational && err.details ? { details: err.details } : {}),
      ...(env.NODE_ENV !== 'production' && !isOperational ? { stack: err.stack } : {}),
    },
  });
}
