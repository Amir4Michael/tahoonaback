import { round2 } from '../models/shared/money.js';

export async function getPersonRemaining({ TransactionModel, PaymentModel, ReturnModel, PayoutModel, refField, personId, session }) {
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

  return round2(txTotal - txPaid - priorPayments - priorReturns + priorPayouts);
}

export default getPersonRemaining;