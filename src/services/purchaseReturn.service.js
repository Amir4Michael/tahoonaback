import mongoose from 'mongoose';
import Purchase from '../models/Purchase.js';
import Product from '../models/Product.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import { AppError } from '../middleware/errorHandler.js';
import { isDuplicateKeyError } from '../utils/mongoErrors.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';
import { withTransaction } from '../utils/transactions.js';
import { round2 } from '../models/shared/money.js';
import { getSupplierRemaining } from './supplierBalance.service.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * How much of a given purchase line has already been returned, summed
 * across every PurchaseReturn on file for that purchase — read inside the
 * given session so it's consistent with the write that follows it (see
 * createPurchaseReturn). Returns a Map keyed by productId string ->
 * already-returned quantity. Structurally identical to salesReturn.
 * service.js's getAlreadyReturnedMap — not shared into a common helper
 * because the two would otherwise need a generic "which field/model" shape
 * for a single two-line query body, which isn't worth the indirection.
 */
async function getAlreadyReturnedMap(purchaseId, session) {
  const query = PurchaseReturn.aggregate([
    { $match: { purchaseId } },
    { $unwind: '$items' },
    { $group: { _id: '$items.productId', qty: { $sum: '$items.returnedQuantity' } } },
  ]);
  if (session) query.session(session);
  const rows = await query;
  return new Map(rows.map((r) => [r._id.toString(), r.qty]));
}

/**
 * Returns, per line of the given purchase, the original quantity, quantity
 * already returned, and quantity still available to return — what Supplier
 * Details needs to render the "pick a product to return" screen.
 */
export async function getReturnableForPurchase(purchaseId) {
  if (!purchaseId || !mongoose.isValidObjectId(purchaseId)) {
    throw new AppError('معرّف عملية الشراء غير صالح', 400);
  }

  const purchase = await Purchase.findById(purchaseId);
  if (!purchase) throw new AppError('عملية الشراء غير موجودة', 404);

  const alreadyReturnedMap = await getAlreadyReturnedMap(purchase._id);

  const items = purchase.items.map((line) => {
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
    purchaseId: purchase._id,
    purchaseNumber: purchase.purchaseNumber,
    supplierId: purchase.supplierId,
    date: purchase.date,
    items,
  };
}

/**
 * Records a return of goods BACK TO THE SUPPLIER against ONE existing
 * Purchase — the purchase itself is only ever READ here, never updated or
 * deleted (same historical-integrity rule as everywhere else).
 *
 * NOT a mirror-image of createSalesReturn in every detail — see
 * PurchaseReturn.js for the full reasoning. The two differences that
 * matter here:
 *
 * 1. STOCK DIRECTION: a sales return puts goods back INTO the shop (stock
 *    increases, no scarcity check needed). A purchase return takes goods
 *    OUT of the shop back to the supplier (stock DECREASES), so it needs
 *    the same atomic `$gte`-guarded decrement createSale uses for its own
 *    stock decrement — you cannot return more units than are CURRENTLY in
 *    stock, even if the purchase invoice would otherwise still allow it
 *    (e.g. 10 bought, 8 already sold, only 2 left: returning 3 to the
 *    supplier is impossible no matter what the invoice says, even though
 *    3 <= 10 originally purchased).
 * 2. No weighted-average cost recalculation on Product.purchasePrice
 *    either way — the returned units leave stock without touching the
 *    live blended average (same simplification createSalesReturn already
 *    makes when returned units re-enter stock).
 *
 * ACCOUNTING POLICY (corrected): identical to createSalesReturn, mirrored
 * for what WE owe the supplier instead of what a customer owes us —
 * eligibility is quantity/stock-based only, NEVER conditioned on what we
 * currently owe the supplier. Any excess (the return is worth more than
 * what we owed) surfaces as `creditOwed` in personService.getTotals —
 * money the supplier owes back to us — not silently absorbed or used to
 * block the return.
 *
 * `idempotencyKey` (required) makes this endpoint safe against duplicate
 * submission — identical mechanism to createSalesReturn.
 */
export async function createPurchaseReturn({ purchaseId, items, idempotencyKey }) {
  if (!purchaseId || !mongoose.isValidObjectId(purchaseId)) {
    throw new AppError('معرّف عملية الشراء غير صالح', 400);
  }
  if (!items || items.length === 0) {
    throw new AppError('اختر منتجًا واحدًا على الأقل للإرجاع', 400);
  }
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    throw new AppError('طلب غير صالح', 400);
  }

  const purchaseReturn = await withTransaction(async (session) => {
    // Idempotency fast-path: this exact action was already processed
    // (double-tap, network retry) — return the original result rather than
    // erroring, and touch nothing else.
    const existing = await PurchaseReturn.findOne({ idempotencyKey }).session(session);
    if (existing) return existing;

    const purchase = await Purchase.findById(purchaseId).session(session);
    if (!purchase) throw new AppError('عملية الشراء غير موجودة', 404);
    if (!purchase.supplierId) {
      // Defensive: supplierId is required on every Purchase at the route
      // layer, so this should be unreachable in practice — kept as a guard
      // rather than assumed, the same way createSalesReturn guards a
      // walk-in sale's missing customerId.
      throw new AppError('لا يمكن تسجيل مرتجع لعملية شراء بدون مورد مسجل', 400);
    }

    const alreadyReturnedMap = await getAlreadyReturnedMap(purchase._id, session);

    const lines = [];
    for (const reqItem of items) {
      const purchaseLine = purchase.items.find((l) => l.productId.toString() === String(reqItem.productId));
      if (!purchaseLine) throw new AppError('المنتج غير موجود في عملية الشراء هذه', 400);

      const requestedQty = Number(reqItem.quantity);
      if (!requestedQty || requestedQty <= 0) {
        throw new AppError(`الكمية غير صحيحة للمنتج: ${purchaseLine.name}`, 400);
      }

      const alreadyReturned = alreadyReturnedMap.get(purchaseLine.productId.toString()) || 0;
      const availableToReturn = purchaseLine.quantity - alreadyReturned;
      if (requestedQty > availableToReturn) {
        throw new AppError(
          `الكمية المطلوب إرجاعها من "${purchaseLine.name}" أكبر من المتاح للإرجاع (${availableToReturn})`,
          400,
        );
      }

      lines.push({
        productId: purchaseLine.productId,
        name: purchaseLine.name,
        code: purchaseLine.code,
        returnedQuantity: requestedQty,
        originalUnitPrice: purchaseLine.price,
        returnAmount: round2(purchaseLine.price * requestedQty),
      });
    }

    const totalReturnAmount = round2(lines.reduce((s, l) => s + l.returnAmount, 0));

    // Eligibility for a return is quantity/stock-based ONLY (checked above
    // and via the guarded stock decrement below) — a return is NEVER
    // rejected based on what we currently owe the supplier. `currentRemaining`
    // is still read here purely to log an accurate balanceBefore/balanceAfter
    // on the audit trail below; any excess beyond what we owed surfaces as
    // `creditOwed` in personService.getTotals (see salesReturn.service.js
    // for the full reasoning, mirrored here for the supplier side).
    const currentRemaining = await getSupplierRemaining(purchase.supplierId, session);

    // Send stock back OUT to the supplier — atomic, guarded decrement per
    // line (mirrors createSale's own stock decrement exactly): re-checks
    // availability at WRITE time, not just against whatever was read
    // above, so two concurrent purchase returns for the same product can
    // never both succeed past what's actually sitting in stock.
    for (const line of lines) {
      const result = await Product.updateOne(
        { _id: line.productId, quantity: { $gte: line.returnedQuantity } },
        { $inc: { quantity: -line.returnedQuantity } },
        { session },
      );
      if (result.matchedCount === 0) {
        throw new AppError(`الكمية المطلوب إرجاعها من "${line.name}" لم تعد متاحة في المخزون`, 409);
      }
    }

    let created;
    try {
      [created] = await PurchaseReturn.create(
        [{
          purchaseId: purchase._id,
          supplierId: purchase.supplierId,
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
        const raced = await PurchaseReturn.findOne({ idempotencyKey }).session(session);
        if (raced) return raced;
      }
      throw err;
    }

    await recordActivity(
      {
        type: 'purchase',
        description: `تم تسجيل مرتجع بقيمة ${totalReturnAmount} على عملية الشراء رقم ${purchase.purchaseNumber}`,
        amount: totalReturnAmount,
        refId: created._id,
      },
      { session },
    );

    await recordAuditLog(
      {
        action: 'purchase.return.create',
        entityType: 'PurchaseReturn',
        entityId: created._id,
        values: {
          purchaseId: purchase._id,
          supplierId: purchase.supplierId,
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

  return purchaseReturn;
}

/** Matches the shape of listSalesReturns: paginated, newest first, scoped to one supplier or purchase. */
export async function listPurchaseReturns({ supplierId, purchaseId, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
  const match = {};
  if (supplierId) {
    if (!mongoose.isValidObjectId(supplierId)) throw new AppError('معرّف مورد غير صالح', 400);
    match.supplierId = new mongoose.Types.ObjectId(supplierId);
  }
  if (purchaseId) {
    if (!mongoose.isValidObjectId(purchaseId)) throw new AppError('معرّف عملية شراء غير صالح', 400);
    match.purchaseId = new mongoose.Types.ObjectId(purchaseId);
  }
  if (!supplierId && !purchaseId) {
    throw new AppError('حدد موردًا أو عملية شراء لعرض المرتجعات', 400);
  }

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const [{ items, totalCount }] = await PurchaseReturn.aggregate([
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
