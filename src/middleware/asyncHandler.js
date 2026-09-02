/**
 * Wrap an async Express route/middleware so a rejected promise (a thrown
 * error inside `async`) is forwarded to `next()` instead of crashing the
 * process or hanging the request.
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
