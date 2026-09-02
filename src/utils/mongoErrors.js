/**
 * True for a MongoDB/Mongoose duplicate-key error (violating a `unique`
 * index) — used to turn a raw driver error into a clean, user-facing
 * AppError instead of leaking Mongo internals through the API.
 */
export function isDuplicateKeyError(err) {
  return Boolean(err) && (err.code === 11000 || err.code === 11001);
}

export default isDuplicateKeyError;
