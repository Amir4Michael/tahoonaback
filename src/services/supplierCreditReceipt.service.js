import mongoose from 'mongoose';
import Supplier from '../models/Supplier.js';
import SupplierCreditReceipt from '../models/SupplierCreditReceipt.js';
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
 * Records receiving part or all of a supplier's creditOwed balance (money
 * THEY owe us — see personService.js's getTotals doc block, almost always
 * arising from a purchase return worth more than what we still owed them at
 * the time). The supplier-side mirror of createCustomerCreditPayout: that
 * records money going OUT to a customer against their creditOwed; this
 * records money coming IN from a supplier against theirs.
 *
 * `getSupplierRemaining` returns a single signed figure (negative means
 * credit owed TO us) — the current creditOwed is derived from it the same
 * way personService.getTotals derives its own creditOwed.
 *
 * Rejects an amount larger than the current creditOwed (same "no invented
 * balance" policy as every other payment/payout in this project). Unlike
 * createCustomerCreditPayout, this does NOT need a cashbox-balance check —
 * money coming IN never needs the register to already have enough in it.
 */
export async function createSupplierCreditReceipt({ supplierId, amount, note, idempotencyKey }) {
  if (!supplierId || !mongoose.isValidObjectId(supplierId)) {
    throw new AppError('معرّف مورد غير صالح', 400);
  }

  const amountNum = round2(Number(amount));
  if (Number.isNaN(amountNum) || amountNum <= 0) {
    throw new AppError('قيمة الاستلام يجب أن تكون أكبر من صفر', 400);
  }

  const key = idempotencyKey && String(idempotencyKey).trim() ? String(idempotencyKey).trim() : null;

  const receipt = await withTransaction(async (session) => {
    if (key) {
      const existing = await SupplierCreditReceipt.findOne({ idempotencyKey: key }).session(session);
      if (existing) return existing;
    }

    const supplier = await Supplier.findById(supplierId).session(session);
    if (!supplier) throw new AppError('المورد غير موجود', 404);

    const rawRemaining = await getSupplierRemaining(supplier._id, session);
    const currentCreditOwed = rawRemaining < 0 ? round2(-rawRemaining) : 0;

    if (currentCreditOwed <= 0) {
      throw new AppError('لا يوجد مبلغ مستحق من هذا المورد حاليًا', 400, { code: 'NO_CREDIT_OWED' });
    }
    if (amountNum > currentCreditOwed) {
      throw new AppError(
        'المبلغ أكبر من المستحق الفعلي من هذا المورد',
        400,
        { code: 'EXCEEDS_CREDIT_OWED', creditOwed: currentCreditOwed },
      );
    }

    const creditOwedAfter = round2(currentCreditOwed - amountNum);

    let created;
    try {
      [created] = await SupplierCreditReceipt.create(
        [{ supplierId: supplier._id, amount: amountNum, creditOwedAfter, note: note || '', idempotencyKey: key }],
        { session },
      );
    } catch (err) {
      // Rare race: two requests with the same idempotencyKey both passed
      // the findOne check above and both reached create() — the sparse
      // unique index catches it here.
      if (key && isDuplicateKeyError(err)) {
        const raced = await SupplierCreditReceipt.findOne({ idempotencyKey: key }).session(session);
        if (raced) return raced;
      }
      throw err;
    }

    await CashboxTransaction.create(
      [{
        type: 'in',
        amount: amountNum,
        reason: `استلام مستحق من المورد ${supplier.name}`,
        refType: 'supplier_credit_receipt',
        refId: created._id,
        date: created.date,
      }],
      { session },
    );

    await recordActivity(
      {
        type: 'supplier',
        description: `تم استلام مستحق من المورد ${supplier.name} بمبلغ ${amountNum}`,
        amount: amountNum,
        refId: created._id,
      },
      { session },
    );

    await recordAuditLog(
      {
        action: 'supplier.creditReceipt.create',
        entityType: 'SupplierCreditReceipt',
        entityId: created._id,
        values: { supplierId: supplier._id, amount: amountNum, creditOwedBefore: currentCreditOwed, creditOwedAfter },
      },
      { session },
    );

    return created;
  });

  return receipt;
}

/** Matches the shape of listSupplierPayments: paginated, newest first, scoped to one supplier. */
export async function listSupplierCreditReceipts({ supplierId, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
  if (!supplierId || !mongoose.isValidObjectId(supplierId)) {
    throw new AppError('معرّف مورد غير صالح', 400);
  }

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const [{ items, totalCount }] = await SupplierCreditReceipt.aggregate([
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
 * Deletes a receipt AND its linked cashbox transaction together — same
 * undo pattern as deleteExpense/deleteCustomerPayment/
 * deleteCustomerCreditPayout. Safe by construction: creditOwed is always
 * computed live (see personService.getTotals), never stored, so removing
 * this receipt automatically makes the supplier's creditOwed correct again.
 *
 * This receipt was a cashbox 'in' — same balance-sufficiency check as
 * deleteCustomerPayment, and for the same reason: if this money has since
 * been spent, removing it would retroactively push the live balance
 * negative. Rejected outright rather than silently allowed.
 */
export async function deleteSupplierCreditReceipt(id) {
  if (!id || !mongoose.isValidObjectId(id)) {
    throw new AppError('معرّف العملية غير صالح', 400);
  }
  const receipt = await SupplierCreditReceipt.findById(id);
  if (!receipt) throw new AppError('العملية غير موجودة', 404);

  return withTransaction(async (session) => {
    const supplier = await Supplier.findById(receipt.supplierId).session(session);

    const cashboxBalance = await getBalance(session);
    if (cashboxBalance - receipt.amount < 0) {
      throw new AppError(
        'متقدرش تحذف عملية الاستلام دي — الفلوس دي اتصرفت خلاص في حاجة تانية، والصندوق مش هيقدر يستحمل نقصانها دلوقتي',
        400,
        { code: 'WOULD_GO_NEGATIVE' },
      );
    }

    await SupplierCreditReceipt.deleteOne({ _id: id }, { session });
    await CashboxTransaction.deleteMany({ refType: 'supplier_credit_receipt', refId: id }, { session });

    await recordActivity(
      {
        type: 'supplier',
        description: `تم حذف استلام مستحق بمبلغ ${receipt.amount} من المورد ${supplier?.name || ''}`,
        amount: receipt.amount,
      },
      { session },
    );
    await recordAuditLog(
      {
        action: 'supplier.creditReceipt.delete',
        entityType: 'SupplierCreditReceipt',
        entityId: receipt._id,
        values: { supplierId: receipt.supplierId, amount: receipt.amount },
      },
      { session },
    );

    return { success: true };
  });
}