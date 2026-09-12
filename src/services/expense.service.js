import Expense from '../models/Expense.js';
import CashboxTransaction from '../models/CashboxTransaction.js';
import { AppError } from '../middleware/errorHandler.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';
import { withTransaction } from '../utils/transactions.js';
import { getBalance } from './cashbox.service.js';
import { cairoRangeMatch, cairoTodayBounds, cairoMonthBounds } from '../utils/timezone.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Every distinct reason actually typed on a real expense — the correct
 * source for the reason FILTER dropdown, which previously listed only a
 * fixed set of suggested categories (EXPENSE_SUGGESTIONS on the frontend)
 * regardless of what shows up in the data. Since `reason` is free text (see
 * ExpensesPage's datalist), someone could type "فاتورة كهربا" once and
 * "كهرباء" another time and neither would ever appear as a selectable
 * filter option before this — this is what makes them selectable. Sorted
 * so the dropdown is stable and easy to scan; empty/blank values can't
 * occur (createExpense requires a non-empty reason).
 */
export async function getDistinctReasons() {
  const reasons = await Expense.distinct('reason');
  return reasons.filter(Boolean).sort((a, b) => a.localeCompare(b, 'ar'));
}

/** Matches ExpensesPage's filters: exact reason (or 'all'), date range. */
export async function listExpenses({ page = 1, limit = DEFAULT_PAGE_SIZE, reason, from, to } = {}) {
  const match = {};
  if (reason && reason !== 'all') match.reason = reason;
  const range = cairoRangeMatch(from, to);
  if (Object.keys(range).length) match.date = range;

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const [{ items, totalCount, totalAmountAgg }] = await Expense.aggregate([
    { $match: match },
    { $sort: { date: -1 } },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: pageSize }],
        totalCount: [{ $count: 'count' }],
        // Sum over EVERY matching row (all filters applied, not just this
        // page) — mirrors the frontend's `filteredTotal`, which sums the
        // whole filtered list, not just what's visible on screen.
        totalAmountAgg: [{ $group: { _id: null, sum: { $sum: '$amount' } } }],
      },
    },
  ]);

  const total = totalCount[0]?.count || 0;
  return {
    items,
    pagination: { page: pageNum, limit: pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    totalAmount: totalAmountAgg[0]?.sum || 0,
  };
}

/** Today's and this-month's expense totals, for the expenses page header stats. */
export async function getSummary() {
  const { start: startOfToday, end: endOfToday } = cairoTodayBounds();
  const { start: startOfMonth, end: endOfMonth } = cairoMonthBounds();

  const [todayResult, monthResult] = await Promise.all([
    Expense.aggregate([
      { $match: { date: { $gte: startOfToday, $lte: endOfToday } } },
      { $group: { _id: null, sum: { $sum: '$amount' } } },
    ]),
    Expense.aggregate([
      { $match: { date: { $gte: startOfMonth, $lte: endOfMonth } } },
      { $group: { _id: null, sum: { $sum: '$amount' } } },
    ]),
  ]);

  return { todayTotal: todayResult[0]?.sum || 0, monthTotal: monthResult[0]?.sum || 0 };
}

/**
 * Creates an expense AND its linked cashbox 'out' transaction together in
 * one transaction — these are two core financial records that must stay
 * consistent with each other (an expense with no matching cashbox
 * deduction, or vice versa, would corrupt the balance). The
 * balance-sufficiency check reads within the same transaction for the same
 * race-safety reason as manual withdrawals (see cashbox.service.js).
 */
export async function createExpense({ reason, amount, date, notes }) {
  if (!reason || !reason.trim()) throw new AppError('أدخل سبب المصروف', 400);
  const amt = Number(amount);
  if (!amt || amt <= 0) throw new AppError('أدخل مبلغاً صحيحاً', 400);

  return withTransaction(async (session) => {
    const balance = await getBalance(session);
    if (amt > balance) throw new AppError('رصيد الصندوق غير كافٍ لهذا المصروف', 400);

    const expenseDate = date ? new Date(`${date}T12:00:00`) : new Date();

    const [expense] = await Expense.create(
      [{ reason: reason.trim(), amount: amt, notes: notes || '', date: expenseDate }],
      { session },
    );

    await CashboxTransaction.create(
      [{
        type: 'out',
        amount: amt,
        reason: `مصروف: ${expense.reason}`,
        refType: 'expense',
        refId: expense._id,
        notes: expense.notes,
        date: expense.date,
      }],
      { session },
    );

    await recordActivity(
      { type: 'expense', description: `تم تسجيل مصروف: ${expense.reason}`, amount: amt, refId: expense._id },
      { session },
    );

    await recordAuditLog(
      { action: 'expense.create', entityType: 'Expense', entityId: expense._id, values: { reason: expense.reason, amount: amt } },
      { session },
    );

    return expense;
  });
}

/**
 * Deletes an expense AND its linked cashbox transaction together — matches
 * the frontend's `deleteExpenseSvc`, which removes the cashbox entry created
 * alongside the expense so the balance correctly "gives the money back".
 */
export async function deleteExpense(id) {
  const expense = await Expense.findById(id);
  if (!expense) throw new AppError('المصروف غير موجود', 404);

  return withTransaction(async (session) => {
    await Expense.deleteOne({ _id: id }, { session });
    await CashboxTransaction.deleteMany({ refType: 'expense', refId: id }, { session });
    await recordActivity(
      { type: 'expense', description: `تم حذف مصروف: ${expense.reason}`, amount: expense.amount },
      { session },
    );
    await recordAuditLog(
      { action: 'expense.delete', entityType: 'Expense', entityId: expense._id, values: { reason: expense.reason, amount: expense.amount } },
      { session },
    );
    return { success: true };
  });
}