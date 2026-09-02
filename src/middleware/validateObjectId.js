import mongoose from 'mongoose';
import { AppError } from './errorHandler.js';

/**
 * Rejects a malformed `:id`-style param with a clean 400 before it ever
 * reaches a query — without this, an invalid id falls through to Mongoose as
 * a `CastError`, which is unnecessary DB round-trip work for input we can
 * already tell is wrong, and a worse error message for the client.
 */
export function validateObjectIdParam(paramName = 'id') {
  return (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params[paramName])) {
      next(new AppError('معرّف غير صالح', 400));
      return;
    }
    next();
  };
}

export default validateObjectIdParam;
