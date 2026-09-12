import mongoose from 'mongoose';
import Supplier from '../models/Supplier.js';
import SupplierPayment from '../models/SupplierPayment.js';
import CashboxTransaction from '../models/CashboxTransaction.js';
import { AppError } from '../middleware/errorHandler.js';
import { isDuplicateKeyError } from '../utils/mongoErrors.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';
import { withTransaction } from '../utils/transactions.js';
import { round2 } from '../models/shared/money.js';
import { getSupplierRemaining } from './supplierBalance.service.js';
import { getBalance } from './cashbox.service.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Records a standalone settlement WE pay to a supplier against our running
 * balance — NEVER against any specific Purchase (see SupplierPayment.js for
 * why). The mirror of customerPayment.service.js's createCustomerPayment,
 * with money flowing the opposite direction: the cashbox entry here is
 * `type: 'out'` (cash leaving the register), not `'in'`.
 *
 * No cashbox-balance-sufficiency check before recording the 'out' entry —
 * deliberately matching createPurchase's existing paid-purchase cashbox
 * entry (see purchase.service.js), which doesn't check it either. Only the
 * MANUAL cashbox withdrawal endpoint (cashbox.service.js's
 * createCashTransaction) enforces that, for discretionary cash-out actions;
 * a supplier settlement is a business-transaction consequence, same
 * category as a purchase's own payment, not a discretionary withdrawal.
 *
 * Same no-credit-balance policy as customer payments: the system has no
 * concept of the supplier owing US money back (no field, nothing reads
 * one), so an amount greater than what we currently owe this supplier is
 * REJECTED outright here rather than allowed to go negative.
 *
 * `idempotencyKey` (optional — added during the full regression audit,
 * matching customerPayment.service.js) is the same duplicate-submission
 * guard SalesReturn/PurchaseReturn already use.
 */
export async function createSupplierPayment({ supplierId, amount, note, idempotencyKey }) {
  if (!supplierId || !mongoose.isValidObjectId(supplierId)) {
    throw new AppError('معرّف مورد غير صالح', 400);
  }

  const amountNum = round2(Number(amount));
  if (Number.isNaN(amountNum) || amountNum <= 0) {
    throw new AppError('قيمة السداد يجب أن تكون أكبر من صفر', 400);
  }

  const key = idempotencyKey && String(idempotencyKey).trim() ? String(idempotencyKey).trim() : null;

  const payment = await withTransaction(async (session) => {
    if (key) {
      const existing = await SupplierPayment.findOne({ idempotencyKey: key }).session(session);
      if (existing) return existing;
    }

    const supplier = await Supplier.findById(supplierId).session(session);
    if (!supplier) throw new AppError('المورد غير موجود', 404);

    const currentRemaining = await getSupplierRemaining(supplier._id, session);

    if (amountNum > currentRemaining) {
      throw new AppError(
        'مبلغ السداد أكبر من المتبقي المستحق لهذا المورد',
        400,
        { code: 'EXCEEDS_REMAINING', remaining: currentRemaining },
      );
    }

    // Cash actually leaving the register for this settlement must never
    // exceed what's actually in it — same balance-sufficiency rule already
    // enforced for manual withdrawals (cashbox.service.js), expenses
    // (expense.service.js), and now paid purchases (purchase.service.js).
    // Checked inside this transaction (via `session`) for the same
    // race-safety reason as those, and before the payment document is
    // created so a rejected settlement never leaves partial side effects.
    const cashboxBalance = await getBalance(session);
    if (amountNum > cashboxBalance) {
      throw new AppError('رصيد الصندوق غير كافٍ لدفع هذا السداد', 400);
    }

    const balanceAfter = round2(currentRemaining - amountNum);

    let created;
    try {
      [created] = await SupplierPayment.create(
        [{ supplierId: supplier._id, amount: amountNum, balanceAfter, note: note || '', idempotencyKey: key }],
        { session },
      );
    } catch (err) {
      if (key && isDuplicateKeyError(err)) {
        const raced = await SupplierPayment.findOne({ idempotencyKey: key }).session(session);
        if (raced) return raced;
      }
      throw err;
    }

    await CashboxTransaction.create(
      [{
        type: 'out',
        amount: amountNum,
        reason: `سداد للمورد ${supplier.name}`,
        refType: 'supplier_payment',
        refId: created._id,
        date: created.date,
      }],
      { session },
    );

    await recordActivity(
      {
        type: 'supplier',
        description: `تم تسجيل سداد للمورد ${supplier.name} بمبلغ ${amountNum}`,
        amount: amountNum,
        refId: created._id,
      },
      { session },
    );

    await recordAuditLog(
      {
        action: 'supplier.payment.create',
        entityType: 'SupplierPayment',
        entityId: created._id,
        values: { supplierId: supplier._id, amount: amountNum, balanceBefore: currentRemaining, balanceAfter },
      },
      { session },
    );

    return created;
  });

  return payment;
}

/** Matches the shape of listCustomerPayments: paginated, newest first, scoped to one supplier. */
export async function listSupplierPayments({ supplierId, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
  if (!supplierId || !mongoose.isValidObjectId(supplierId)) {
    throw new AppError('معرّف مورد غير صالح', 400);
  }

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const [{ items, totalCount }] = await SupplierPayment.aggregate([
    { $match: { supplierId: new mongoose.Types.ObjectId(supplierId) } },
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
 * Deletes a supplier payment AND its linked cashbox transaction together —
 * mirror of customerPayment.service.js's deleteCustomerPayment (see that
 * docstring for why this is safe: the supplier's `remaining` is always
 * computed live, never stored, so nothing else needs recalculating).
 */
export async function deleteSupplierPayment(id) {
  if (!id || !mongoose.isValidObjectId(id)) {
    throw new AppError('معرّف السداد غير صالح', 400);
  }
  const payment = await SupplierPayment.findById(id);
  if (!payment) throw new AppError('السداد غير موجود', 404);

  return withTransaction(async (session) => {
    const supplier = await Supplier.findById(payment.supplierId).session(session);

    await SupplierPayment.deleteOne({ _id: id }, { session });
    await CashboxTransaction.deleteMany({ refType: 'supplier_payment', refId: id }, { session });

    await recordActivity(
      {
        type: 'supplier',
        description: `تم حذف سداد بمبلغ ${payment.amount} للمورد ${supplier?.name || ''}`,
        amount: payment.amount,
      },
      { session },
    );
    await recordAuditLog(
      {
        action: 'supplier.payment.delete',
        entityType: 'SupplierPayment',
        entityId: payment._id,
        values: { supplierId: payment.supplierId, amount: payment.amount },
      },
      { session },
    );

    return { success: true };
  });
}