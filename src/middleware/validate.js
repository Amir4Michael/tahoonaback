import { AppError } from './errorHandler.js';

/**
 * Validates `req.body` against a zod schema and replaces it with the parsed
 * (typed/defaulted/trimmed) result on success. On failure, forwards a 400
 * AppError with per-field messages — reusable by every future route that
 * accepts a body (Products, Sales, Purchases, ...).
 */
export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    next(new AppError('بيانات غير صالحة', 400, result.error.flatten().fieldErrors));
    return;
  }
  req.body = result.data;
  next();
};

/**
 * Same idea for `req.query` (pagination, search, filters), but stores the
 * parsed result on `req.validatedQuery` instead of overwriting `req.query`
 * directly — some Express/Node combinations define `req.query` as a
 * getter-only property, where reassigning it throws. Reading from
 * `req.validatedQuery` in controllers sidesteps that entirely.
 */
export const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    next(new AppError('معايير البحث غير صالحة', 400, result.error.flatten().fieldErrors));
    return;
  }
  req.validatedQuery = result.data;
  next();
};

export default validateBody;
