import mongoose from 'mongoose';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import SalesReturn from '../models/SalesReturn.js';
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
 * How much of a given sale line has already been returned, summed across
 * every SalesReturn on file for that sale — read inside the given session
 * so it's consistent with the write that follows it (see createSalesReturn).
 * Returns a Map keyed by productId string -> already-returned quantity.
 */
async function getAlreadyReturnedMap(saleId, session) {
  const query = SalesReturn.aggregate([
    { $match: { saleId } },
    { $unwind: '$items' },
    { $group: { _id: '$items.productId', qty: { $sum: '$items.returnedQuantity' } } },
  ]);
  if (session) query.session(session);
  const rows = await query;
  return new Map(rows.map((r) => [r._id.toString(), r.qty]));
}

/**
 * Returns, per line of the given sale, the original quantity, quantity
 * already returned, and quantity still available to return — exactly what
 * Customer Details needs to render the "pick a product to return" screen
 * (see the Returns phase spec: name / original qty / already-returned qty /
 * available qty / original price / quantity-to-return input).
 */
export async function getReturnableForSale(saleId) {
  if (!saleId || !mongoose.isValidObjectId(saleId)) {
    throw new AppError('معرّف الفاتورة غير صالح', 400);
  }

  const sale = await Sale.findById(saleId);
  if (!sale) throw new AppError('الفاتورة غير موجودة', 404);

  const alreadyReturnedMap = await getAlreadyReturnedMap(sale._id);

  const items = sale.items.map((line) => {
    const alreadyReturned = alreadyReturnedMap.get(line.productId.toString()) || 0;
    return {
      productId: line.productId,
      name: line.name,
      code: line.code,
      originalQuantity: line.quantity,
      alreadyReturnedQuantity: alreadyReturned,
      availableToReturn: Math.max(0, line.quantity - alreadyReturned),
      originalUnitPrice: line.price,
    };
  });

  return {
    saleId: sale._id,
    invoiceNumber: sale.invoiceNumber,
    customerId: sale.customerId,
    date: sale.date,
    items,
  };
}

/**
 * Records a return against ONE existing Sale — the sale itself is only ever
 * READ here, never updated or deleted (see Sale.js / SalesReturn.js for
 * why: historical-integrity is a hard rule throughout this project).
 *
 * ACCOUNTING POLICY (read before touching this function): the system has no
 * refund or credit-balance concept anywhere — Customer has no such field,
 * and nothing else reads or displays one. A return reduces the CUSTOMER'S
 * aggregate outstanding balance (across all their sales, minus payments,
 * minus earlier returns — see getCustomerRemaining), the same aggregate
 * figure a "تسجيل سداد" payment is validated against. This correctly
 * handles the case in the spec (customer owed 400, returns goods worth 200
 * -> now owes 200) WITHOUT inventing anything: it's the same aggregate-debt
 * model already used for CustomerPayment, just subtracting from `total`
 * instead of adding to `paid`.
 *
 * If a return's value would exceed what the customer currently owes overall
 * (e.g. they already fully paid for the returned goods and have no other
 * debt to offset it against), that is EXACTLY the refund/credit-balance
 * case this system doesn't support — it is REJECTED outright rather than
 * allowed to drive the balance negative. See the phase's design note for
 * what a Refund or Credit Balance feature would need to look like.
 *
 * Wrapped in a transaction for the same reason as createSale/createPurchase
 * /createCustomerPayment: the return record, the stock restoration, and the
 * activity/audit trail must all land together or not at all.
 *
 * `idempotencyKey` (required) makes this endpoint safe against duplicate
 * submission: the same key can never produce two return documents (unique
 * index on SalesReturn) — a retry with the same key is treated as an
 * idempotent no-op, returning the original return instead of erroring or
 * double-crediting stock.
 */
export async function createSalesReturn({ saleId, items, idempotencyKey }) {
  if (!saleId || !mongoose.isValidObjectId(saleId)) {
    throw new AppError('معرّف الفاتورة غير صالح', 400);
  }
  if (!items || items.length === 0) {
    throw new AppError('اختر منتجًا واحدًا على الأقل للإرجاع', 400);
  }
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    throw new AppError('طلب غير صالح', 400);
  }

  const salesReturn = await withTransaction(async (session) => {
    // Idempotency fast-path: this exact action was already processed
    // (double-tap, network retry) — return the original result rather than
    // erroring, and touch nothing else.
    const existing = await SalesReturn.findOne({ idempotencyKey }).session(session);
    if (existing) return existing;

    const sale = await Sale.findById(saleId).session(session);
    if (!sale) throw new AppError('الفاتورة غير موجودة', 404);
    if (!sale.customerId) {
      // Entry point for this feature is Customer Details, which only ever
      // lists a real customer's own invoices — a walk-in/cash sale with no
      // customerId has no account to adjust a balance against, so it's out
      // of scope rather than silently mishandled.
      throw new AppError('لا يمكن تسجيل مرتجع لعملية بيع بدون عميل مسجل', 400);
    }

    const alreadyReturnedMap = await getAlreadyReturnedMap(sale._id, session);

    const lines = [];
    for (const reqItem of items) {
      const saleLine = sale.items.find((l) => l.productId.toString() === String(reqItem.productId));
      if (!saleLine) throw new AppError('المنتج غير موجود في هذه الفاتورة', 400);

      const requestedQty = Number(reqItem.quantity);
      if (!requestedQty || requestedQty <= 0) {
        throw new AppError(`الكمية غير صحيحة للمنتج: ${saleLine.name}`, 400);
      }

      const alreadyReturned = alreadyReturnedMap.get(saleLine.productId.toString()) || 0;
      const availableToReturn = saleLine.quantity - alreadyReturned;
      if (requestedQty > availableToReturn) {
        throw new AppError(
          `الكمية المطلوب إرجاعها من "${saleLine.name}" أكبر من المتاح للإرجاع (${availableToReturn})`,
          400,
        );
      }

      lines.push({
        productId: saleLine.productId,
        name: saleLine.name,
        code: saleLine.code,
        returnedQuantity: requestedQty,
        originalUnitPrice: saleLine.price,
        returnAmount: round2(saleLine.price * requestedQty),
      });
    }

    const totalReturnAmount = round2(lines.reduce((s, l) => s + l.returnAmount, 0));

    const currentRemaining = await getCustomerRemaining(sale.customerId, session);
    if (totalReturnAmount > currentRemaining) {
      throw new AppError(
        'قيمة المرتجع أكبر من المتبقي المستحق على العميل — هذا يستلزم استرداد نقدي أو رصيد دائن، وهو غير مدعوم في النظام حاليًا',
        400,
        { code: 'EXCEEDS_REMAINING', remaining: currentRemaining, returnAmount: totalReturnAmount },
      );
    }

    // Restore stock — a plain, atomic $inc per line. No weighted-average
    // cost recalculation: the returned units go back at their existing
    // cost basis, this isn't a new purchase (see SalesReturn.js).
    for (const line of lines) {
      await Product.updateOne({ _id: line.productId }, { $inc: { quantity: line.returnedQuantity } }, { session });
    }

    let created;
    try {
      [created] = await SalesReturn.create(
        [{
          saleId: sale._id,
          customerId: sale.customerId,
          items: lines,
          totalReturnAmount,
          idempotencyKey,
        }],
        { session },
      );
    } catch (err) {
      // Rare race: two requests with the same idempotencyKey both passed
      // the findOne check above and both reached create() — the unique
      // index catches it here. Treat it the same as the fast-path above.
      if (isDuplicateKeyError(err)) {
        const raced = await SalesReturn.findOne({ idempotencyKey }).session(session);
        if (raced) return raced;
      }
      throw err;
    }

    await recordActivity(
      {
        type: 'sale',
        description: `تم تسجيل مرتجع بقيمة ${totalReturnAmount} على الفاتورة رقم ${sale.invoiceNumber}`,
        amount: totalReturnAmount,
        refId: created._id,
      },
      { session },
    );

    await recordAuditLog(
      {
        action: 'sale.return.create',
        entityType: 'SalesReturn',
        entityId: created._id,
        values: {
          saleId: sale._id,
          customerId: sale.customerId,
          items: lines.map((l) => ({ productId: l.productId, returnedQuantity: l.returnedQuantity, returnAmount: l.returnAmount })),
          totalReturnAmount,
          balanceBefore: currentRemaining,
          balanceAfter: round2(currentRemaining - totalReturnAmount),
        },
      },
      { session },
    );

    return created;
  });

  return salesReturn;
}

/** Matches the shape of listSales/listCustomerPayments: paginated, newest first, scoped to one customer. */
export async function listSalesReturns({ customerId, saleId, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
  const match = {};
  if (customerId) {
    if (!mongoose.isValidObjectId(customerId)) throw new AppError('معرّف عميل غير صالح', 400);
    match.customerId = new mongoose.Types.ObjectId(customerId);
  }
  if (saleId) {
    if (!mongoose.isValidObjectId(saleId)) throw new AppError('معرّف فاتورة غير صالح', 400);
    match.saleId = new mongoose.Types.ObjectId(saleId);
  }
  if (!customerId && !saleId) {
    throw new AppError('حدد عميلاً أو فاتورة لعرض المرتجعات', 400);
  }

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const [{ items, totalCount }] = await SalesReturn.aggregate([
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
