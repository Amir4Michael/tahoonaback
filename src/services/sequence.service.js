import Counter from '../models/Counter.js';

/**
 * Atomically returns the next number for a named sequence, formatted with
 * the given prefix (e.g. `nextSequence('invoiceNumber', 'INV')` -> 'INV-1').
 * Safe under concurrent calls: MongoDB's `findOneAndUpdate` with `$inc` is
 * atomic on a single document at the database level, so two simultaneous
 * calls can never receive the same number — no separate transaction needed
 * for this specific operation, though it also works fine participating in
 * one (pass `session` when called from inside a larger transaction, so the
 * counter only advances if the rest of that transaction actually commits).
 *
 * Starts from 1 for a brand-new counter. If you want numbering to start
 * higher (e.g. to continue from existing legacy data), seed it once before
 * go-live: `Counter.create({ name: 'invoiceNumber', value: 1000 })`.
 */
export async function nextSequence(name, prefix, session) {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { value: 1 } },
    { upsert: true, new: true, session },
  );
  return `${prefix}-${counter.value}`;
}

export default nextSequence;
