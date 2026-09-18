import { round2 } from '../models/shared/money.js';

/**
 * Single source of truth for "how much does this person (customer or
 * supplier) currently owe / is owed, right now" — used by every service
 * that needs to validate an action against a LIVE balance inside a
 * transaction (recording a payment, recording a return). Mirrors
 * personService.getTotals' remaining formula exactly:
 * transactionsTotal - transactionsPaid - payments - returns + payouts.
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
 * `PayoutModel` (optional, Customer-only for now — CustomerCreditPayout):
 * money the shop has paid BACK to a person for a creditOwed balance (see
 * customerCreditPayout.service.js). Added back with a `+` because it moves
 * the raw figure toward zero/positive — the opposite direction from
 * `priorReturns`/`priorPayments`, which push it negative (money owed TO the
 * person). This is what lets a settled payout actually bring creditOwed
 * back down instead of leaving it stuck at whatever a return first set it
 * to.
 *
 * `PersonModel` (Customer or Supplier — needed to read `openingBalance`,
 * see those models' own docstrings): folded in as the STARTING term of the
 * whole formula, signed relative to `openingBalancePositiveDirection` (see
 * that param below) — this is what makes an opening balance behave exactly
 * like "one more historical transaction" for every consumer of this
 * function, without it actually being a Sale/Purchase/CashboxTransaction —
 * see Customer.js/Supplier.js's own docstrings for why that matters (it
 * must never touch the cashbox or any sales/profit figure).
 *
 * `openingBalancePositiveDirection` (required whenever `PersonModel` is
 * passed): which of Customer.js/Supplier.js's two `openingBalance.direction`
 * values should contribute POSITIVELY to this raw figure — i.e. push it the
 * same way an ordinary unpaid transaction already does. This is NOT the
 * same value for Customer and Supplier, because "raw positive" itself means
 * opposite things for the two: for a customer it's built from
 * `Sale.total - Sale.paid`, positive when THEY owe US more, so
 * `'they_owe_us'` is what should add. For a supplier it's built from
 * `Purchase.total - Purchase.paid`, positive when WE owe THEM more, so
 * `'we_owe_them'` is what should add — the opposite label from the
 * customer case. Passing the wrong one silently flips every opening
 * balance's effect for that person type (a real, confirmed bug this
 * comment exists to prevent recurring — see
 * /decisions-and-learnings.md): a supplier opening balance recorded as
 * "the shop owes the supplier" would otherwise show up as the supplier
 * owing the shop instead. customerBalance.service.js /
 * supplierBalance.service.js each hardcode the correct value for their own
 * entity type so this can never be passed wrong from a call site.
 *
 * `session` is required (not optional) — every caller runs inside a
 * transaction anyway (see withTransaction in the callers), and a balance
 * check for money movement outside a transaction would defeat the whole
 * point of reading it consistently with the write that follows.
 */
export async function getPersonRemaining({ TransactionModel, PaymentModel, ReturnModel, PayoutModel, PersonModel, openingBalancePositiveDirection, refField, personId, session }) {
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

  let priorPayouts = 0;
  if (PayoutModel) {
    const [payoutsAgg] = await PayoutModel.aggregate([
      { $match: { [refField]: personId } },
      { $group: { _id: null, paidOut: { $sum: '$amount' } } },
    ]).session(session);
    priorPayouts = payoutsAgg?.paidOut || 0;
  }

  let openingBalanceSigned = 0;
  if (PersonModel) {
    const person = await PersonModel.findById(personId).select('openingBalance').session(session);
    const ob = person?.openingBalance;
    if (ob?.amount) openingBalanceSigned = ob.direction === openingBalancePositiveDirection ? ob.amount : -ob.amount;
  }

  return round2(openingBalanceSigned + txTotal - txPaid - priorPayments - priorReturns + priorPayouts);
}

export default getPersonRemaining;