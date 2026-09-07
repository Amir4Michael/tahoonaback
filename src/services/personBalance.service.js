import { round2 } from '../models/shared/money.js';

/**
 * Single source of truth for "how much does this person (customer or
 * supplier) currently owe / is owed, right now" — used by every service
 * that needs to validate an action against a LIVE balance inside a
 * transaction (recording a payment, recording a return). Mirrors
 * personService.getTotals' remaining formula exactly:
 * transactionsTotal - transactionsPaid - payments - returns.
 *
 * Generalized from what used to be a Customer-only helper
 * (customerBalance.service.js) once Supplier needed the EXACT same
 * computation for the exact same reason: a supplier payment and a purchase
 * return validated against two separately-duplicated copies of this formula
 * risk drifting apart — the classic bug where either could read a stale,
 * too-generous balance and "succeed" past what's actually owed. One
 * function, parameterized by which models to read, is what prevents that
 * for both Customer and Supplier at once.
 *
 * `session` is required (not optional) — every caller runs inside a
 * transaction anyway (see withTransaction in the callers), and a balance
 * check for money movement outside a transaction would defeat the whole
 * point of reading it consistently with the write that follows.
 */
export async function getPersonRemaining({ TransactionModel, PaymentModel, ReturnModel, refField, personId, session }) {
  const [txAgg] = await TransactionModel.aggregate([
    { $match: { [refField]: personId } },
    { $group: { _id: null, total: { $sum: '$total' }, paid: { $sum: '$paid' } } },
  ]).session(session);
  const txTotal = txAgg?.total || 0;
  const txPaid = txAgg?.paid || 0;

  const [paymentsAgg] = await PaymentModel.aggregate([
    { $match: { [refField]: personId } },
    { $group: { _id: null, paid: { $sum: '$amount' } } },
  ]).session(session);
  const priorPayments = paymentsAgg?.paid || 0;

  const [returnsAgg] = await ReturnModel.aggregate([
    { $match: { [refField]: personId } },
    { $group: { _id: null, returned: { $sum: '$totalReturnAmount' } } },
  ]).session(session);
  const priorReturns = returnsAgg?.returned || 0;

  return round2(txTotal - txPaid - priorPayments - priorReturns);
}

export default getPersonRemaining;
