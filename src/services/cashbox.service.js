import CashboxTransaction from '../models/CashboxTransaction.js';
import { AppError } from '../middleware/errorHandler.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';
import { withTransaction } from '../utils/transactions.js';
import { cairoTodayBounds, cairoRangeMatch } from '../utils/timezone.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * All-time balance: sum(in) - sum(out) across every transaction — matches
 * the frontend's `cashboxBalance` selector exactly (a running total over
 * full history, not a materialized/cached field). Pass `session` to read
 * within an existing transaction, which is what makes a balance-sufficiency
 * check actually safe against a race: two concurrent withdrawal requests
 * reading the balance outside a transaction could each see the same
 * "sufficient" balance and both proceed, together overdrawing the cashbox.
 */
export async function getBalance(session) {
  const query = CashboxTransaction.aggregate([
    {
      $group: {
        _id: null,
        balance: { $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', { $multiply: ['$amount', -1] }] } },
      },
    },
  ]);
  if (session) query.session(session);
  const [result] = await query;
  return result?.balance || 0;
}

/** Balance + today's in/out totals, for the cashbox page header stats. */
export async function getSummary() {
  const { start: startOfToday, end: endOfToday } = cairoTodayBounds();

  const [balance, todayAggResult] = await Promise.all([
    getBalance(),
    CashboxTransaction.aggregate([
      { $match: { date: { $gte: startOfToday, $lte: endOfToday } } },
      {
        $group: {
          _id: null,
          todayIn: { $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0] } },
          todayOut: { $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0] } },
        },
      },
    ]),
  ]);

  const [todayAgg] = todayAggResult;
  return { balance, todayIn: todayAgg?.todayIn || 0, todayOut: todayAgg?.todayOut || 0 };
}

/** Matches CashboxPage's filters: exact type, reason substring search, date range. */
export async function listCashboxTransactions({ page = 1, limit = DEFAULT_PAGE_SIZE, type, search, from, to } = {}) {
  const match = {};
  if (type && type !== 'all') match.type = type;
  if (search && search.trim()) {
    match.reason = new RegExp(escapeRegex(search.trim()), 'i');
  }
  const range = cairoRangeMatch(from, to);
  if (Object.keys(range).length) match.date = range;

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const [{ items, totalCount }] = await CashboxTransaction.aggregate([
    { $match: match },
    { $sort: { date: -1 } },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: pageSize }],
        totalCount: [{ $count: 'count' }],
      },
    },
  ]);

  const total = totalCount[0]?.count || 0;
  return {
    items,
    pagination: { page: pageNum, limit: pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/**
 * Creates a manual cashbox movement (deposit or withdrawal). There's no
 * "delete/edit" for these — matches the frontend's `cashTransactionSvc`,
 * which is create-only.
 *
 * Wrapped in a transaction so a withdrawal's balance-sufficiency check reads
 * a value that's guaranteed consistent with the write that follows it (see
 * `getBalance`'s docstring for why that matters under concurrent requests).
 */
export async function createCashTransaction({ type, amount, reason, date, notes }) {
  const amt = Number(amount);
  if (!amt || amt <= 0) throw new AppError('أدخل مبلغاً صحيحاً', 400);
  if (!reason || !reason.trim()) throw new AppError('أدخل سبب العملية', 400);

  return withTransaction(async (session) => {
    if (type === 'out') {
      const balance = await getBalance(session);
      if (amt > balance) throw new AppError('رصيد الصندوق غير كافٍ لهذا السحب', 400);
    }

    const txDate = date ? new Date(`${date}T12:00:00`) : new Date();

    const [tx] = await CashboxTransaction.create(
      [{ type, amount: amt, reason: reason.trim(), refType: 'manual', refId: null, notes: notes || '', date: txDate }],
      { session },
    );

    await recordActivity(
      {
        type: 'cash',
        description: type === 'in' ? `تمت إضافة مبلغ للصندوق: ${tx.reason}` : `تم سحب مبلغ من الصندوق: ${tx.reason}`,
        amount: amt,
        refId: tx._id,
      },
      { session },
    );

    await recordAuditLog(
      { action: 'cashbox.transaction.create', entityType: 'CashboxTransaction', entityId: tx._id, values: { type, amount: amt, reason: tx.reason } },
      { session },
    );

    return tx;
  });
}

/**
 * Deletes a MANUAL cashbox transaction only (refType === 'manual') — a
 * deposit/withdrawal entered directly from the Cashbox page, with no other
 * record depending on it. Every OTHER refType ('sale', 'purchase',
 * 'expense', 'customer_payment', 'supplier_payment') is owned by that other
 * record and must be deleted through IT instead (e.g. deleteExpense,
 * deleteCustomerPayment) so the two stay deleted together — deleting one
 * side here would silently leave the other claiming money moved that no
 * longer shows up anywhere, which is exactly the inconsistency those
 * dedicated delete functions exist to prevent. Rejected outright rather
 * than silently allowed, so that mistake can't happen through this
 * function.
 */
export async function deleteCashTransaction(id) {
  const tx = await CashboxTransaction.findById(id);
  if (!tx) throw new AppError('الحركة غير موجودة', 404);

  if (tx.refType !== 'manual') {
    throw new AppError(
      'الحركة دي مرتبطة بعملية تانية (بيع/شراء/مصروف/سداد) ومينفعش تتحذف من هنا مباشرة — احذف العملية الأصلية بدل كده.',
      400,
    );
  }

  return withTransaction(async (session) => {
    // Removing an 'in' entry effectively un-happens that inflow — if that
    // money has since been spent, the live balance (a running sum, never
    // stored) would go negative the instant this is removed. Same
    // balance-sufficiency reasoning as the CREATION-side check on 'out'
    // transactions above, just applied to deleting an 'in' one instead.
    // Deleting an 'out' entry never has this risk (it only gives money
    // back), so no check is needed in that direction.
    if (tx.type === 'in') {
      const balance = await getBalance(session);
      if (balance - tx.amount < 0) {
        throw new AppError(
          'متقدرش تحذف الحركة دي — الفلوس دي اتصرفت خلاص في حاجة تانية، والصندوق مش هيقدر يستحمل نقصانها دلوقتي',
          400,
          { code: 'WOULD_GO_NEGATIVE' },
        );
      }
    }

    await CashboxTransaction.deleteOne({ _id: id }, { session });

    await recordActivity(
      {
        type: 'cash',
        description: tx.type === 'in'
          ? `تم حذف حركة إضافة للصندوق: ${tx.reason}`
          : `تم حذف حركة سحب من الصندوق: ${tx.reason}`,
        amount: tx.amount,
      },
      { session },
    );

    await recordAuditLog(
      { action: 'cashbox.transaction.delete', entityType: 'CashboxTransaction', entityId: tx._id, values: { type: tx.type, amount: tx.amount, reason: tx.reason } },
      { session },
    );

    return { success: true };
  });
}