import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import CustomerPayment from '../models/CustomerPayment.js';
import CashboxTransaction from '../models/CashboxTransaction.js';
import { AppError } from '../middleware/errorHandler.js';
import { isDuplicateKeyError } from '../utils/mongoErrors.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';
import { withTransaction } from '../utils/transactions.js';
import { round2 } from '../models/shared/money.js';
import { getCustomerRemaining } from './customerBalance.service.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Records a standalone settlement against a customer's running balance —
 * NEVER against any specific Sale (see CustomerPayment.js for why). Wrapped
 * in a transaction for the same reason as createSale/createPurchase: the
 * payment record, its cashbox inflow, and the activity/audit trail must all
 * land together or not at all.
 *
 * The system has no concept of a customer "credit balance" (prepaying
 * beyond what they owe) anywhere — Customer has no balance/credit field,
 * and nothing else in the project reads or displays one. So, per policy, an
 * amount greater than the customer's current remaining balance is REJECTED
 * outright here rather than allowed to go negative — that would be
 * inventing new behavior (a credit-balance system) the rest of the app
 * doesn't support.
 *
 * `idempotencyKey` (optional — added during the full regression audit) is
 * the same duplicate-submission guard SalesReturn/PurchaseReturn already
 * use: a retry with the same key is treated as an idempotent no-op instead
 * of creating a second payment. Optional (not required, unlike the return
 * endpoints) purely for backward compatibility with any caller that
 * predates this field — a caller that omits it simply gets no duplicate
 * protection, same as before this audit.
 */
export async function createCustomerPayment({ customerId, amount, note, idempotencyKey }) {
  if (!customerId || !mongoose.isValidObjectId(customerId)) {
    throw new AppError('معرّف عميل غير صالح', 400);
  }

  const amountNum = round2(Number(amount));
  if (Number.isNaN(amountNum) || amountNum <= 0) {
    throw new AppError('قيمة السداد يجب أن تكون أكبر من صفر', 400);
  }

  const key = idempotencyKey && String(idempotencyKey).trim() ? String(idempotencyKey).trim() : null;

  const payment = await withTransaction(async (session) => {
    if (key) {
      const existing = await CustomerPayment.findOne({ idempotencyKey: key }).session(session);
      if (existing) return existing;
    }

    const customer = await Customer.findById(customerId).session(session);
    if (!customer) throw new AppError('العميل غير موجود', 404);

    const currentRemaining = await getCustomerRemaining(customer._id, session);

    if (amountNum > currentRemaining) {
      throw new AppError(
        'مبلغ السداد أكبر من المتبقي على العميل',
        400,
        { code: 'EXCEEDS_REMAINING', remaining: currentRemaining },
      );
    }

    const balanceAfter = round2(currentRemaining - amountNum);

    let created;
    try {
      [created] = await CustomerPayment.create(
        [{ customerId: customer._id, amount: amountNum, balanceAfter, note: note || '', idempotencyKey: key }],
        { session },
      );
    } catch (err) {
      // Rare race: two requests with the same idempotencyKey both passed
      // the findOne check above and both reached create() — the sparse
      // unique index catches it here.
      if (key && isDuplicateKeyError(err)) {
        const raced = await CustomerPayment.findOne({ idempotencyKey: key }).session(session);
        if (raced) return raced;
      }
      throw err;
    }

    await CashboxTransaction.create(
      [{
        type: 'in',
        amount: amountNum,
        reason: `تحصيل سداد من العميل ${customer.name}`,
        refType: 'customer_payment',
        refId: created._id,
        date: created.date,
      }],
      { session },
    );

    await recordActivity(
      {
        type: 'customer',
        description: `تم تسجيل سداد من العميل ${customer.name} بمبلغ ${amountNum}`,
        amount: amountNum,
        refId: created._id,
      },
      { session },
    );

    await recordAuditLog(
      {
        action: 'customer.payment.create',
        entityType: 'CustomerPayment',
        entityId: created._id,
        values: { customerId: customer._id, amount: amountNum, balanceBefore: currentRemaining, balanceAfter },
      },
      { session },
    );

    return created;
  });

  return payment;
}

/** Matches the shape of listSales/listPurchases: paginated, newest first, scoped to one customer. */
export async function listCustomerPayments({ customerId, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
  if (!customerId || !mongoose.isValidObjectId(customerId)) {
    throw new AppError('معرّف عميل غير صالح', 400);
  }

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const [{ items, totalCount }] = await CustomerPayment.aggregate([
    { $match: { customerId: new mongoose.Types.ObjectId(customerId) } },
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
