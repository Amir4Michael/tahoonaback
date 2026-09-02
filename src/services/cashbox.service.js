import CashboxTransaction from '../models/CashboxTransaction.js';
import { AppError } from '../middleware/errorHandler.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';
import { withTransaction } from '../utils/transactions.js';

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
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

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
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = new Date(`${from}T00:00:00`);
    if (to) match.date.$lte = new Date(`${to}T23:59:59`);
  }

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
