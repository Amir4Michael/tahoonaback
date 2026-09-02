import mongoose from 'mongoose';

const TRANSIENT_LABELS = ['TransientTransactionError', 'UnknownTransactionCommitResult'];

function isTransientTransactionError(err) {
  return typeof err?.hasErrorLabel === 'function' && TRANSIENT_LABELS.some((label) => err.hasErrorLabel(label));
}

/**
 * Runs `fn(session)` inside a MongoDB transaction, retrying a bounded number
 * of times on transient errors — MongoDB's own documented pattern for
 * replica-set transactions (Atlas runs as a replica set even on the free
 * tier, which is what makes transactions available at all here). A
 * transient network blip or a write conflict with another concurrent
 * transaction touching the same document is expected to happen occasionally
 * under real traffic and is safe to just retry: the whole transaction is
 * atomic, so a retry re-runs `fn` cleanly from scratch, never partially.
 *
 * A business-rule rejection (an `AppError` — insufficient stock, invalid
 * price, ...) is never transient and is never retried: `err.hasErrorLabel`
 * only exists on real MongoDB driver errors, so a plain `AppError` safely
 * falls through to the `throw` on the first attempt.
 */
export async function withTransaction(fn, { maxAttempts = 3 } = {}) {
  const session = await mongoose.startSession();
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let result;
      try {
        await session.withTransaction(async () => {
          result = await fn(session);
        });
        return result;
      } catch (err) {
        const isLastAttempt = attempt >= maxAttempts;
        if (isLastAttempt || !isTransientTransactionError(err)) {
          throw err;
        }
      }
    }
    // Unreachable: the loop always either returns or throws.
    return undefined;
  } finally {
    await session.endSession();
  }
}

export default withTransaction;
