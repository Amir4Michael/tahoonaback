import mongoose from 'mongoose';
import Purchase from '../models/Purchase.js';
import Product from '../models/Product.js';
import Supplier from '../models/Supplier.js';
import CashboxTransaction from '../models/CashboxTransaction.js';
import { AppError } from '../middleware/errorHandler.js';
import { nextSequence } from './sequence.service.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';
import { withTransaction } from '../utils/transactions.js';
import { round2 } from '../models/shared/money.js';
import { getBalance } from './cashbox.service.js';
import { cairoRangeMatch } from '../utils/timezone.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Creates a purchase in a single MongoDB transaction: validates every line,
 * updates each affected product's cost (see below) AND quantity, writes the
 * Purchase, records the cashbox movement (if anything was paid), and logs
 * the activity entry — all together, or none of it. Same atomicity
 * reasoning as createSale (see sale.service.js and the README): a failed
 * purchase must never leave a product's cost/quantity updated with nothing
 * to show for it.
 *
 * Mirrors the frontend's addPurchaseSvc validation order and messages
 * exactly: no supplier -> empty items -> per-line checks (existence,
 * quantity, price) -> payment amount checks.
 *
 * `discount` is a FLAT (fixed-amount) reduction on the purchase's
 * `subtotal` as a whole — it is never distributed across `items[]`, so
 * every line's `price` (which sets the product's new cost below) always
 * stays the actual per-unit price paid in this batch. The client's
 * `total`/`discount` are never trusted: `subtotal` is recomputed here from
 * the validated lines, and `discount` is re-validated against that
 * recomputed `subtotal`.
 */
export async function createPurchase({ supplierId, items, paymentMethod, paid, date, notes, discount }) {
  if (!supplierId) {
    throw new AppError('اختر المورد أولاً', 400);
  }
  if (!items || items.length === 0) {
    throw new AppError('أضف منتجات لعملية الشراء', 400);
  }

  const purchase = await withTransaction(async (session) => {
    const lines = [];
    for (const item of items) {
      const product = await Product.findById(item.productId).session(session);
      if (!product) throw new AppError('منتج غير موجود', 404);

      const qty = Number(item.quantity);
      const price = Number(item.price);
      if (!qty || qty <= 0) throw new AppError(`الكمية غير صحيحة للمنتج: ${product.name}`, 400);
      if (Number.isNaN(price) || price < 0) throw new AppError(`سعر الشراء غير صحيح للمنتج: ${product.name}`, 400);

      lines.push({ productId: product._id, name: product.name, code: product.code, price, quantity: qty });
    }

    const subtotal = round2(lines.reduce((s, l) => s + l.price * l.quantity, 0));

    // Discount defaults to 0 (no discount) when omitted — matches every
    // purchase created before this feature existed. Same '' / null /
    // undefined -> "no discount" handling as the sale-side discount.
    const hasDiscount = discount !== undefined && discount !== null && discount !== '';
    const discountNum = hasDiscount ? round2(Number(discount)) : 0;
    if (Number.isNaN(discountNum) || discountNum < 0) {
      throw new AppError('قيمة الخصم غير صحيحة', 400);
    }
    if (discountNum > subtotal) {
      throw new AppError('الخصم أكبر من إجمالي العملية', 400);
    }

    const total = round2(subtotal - discountNum);
    const paidNum = paymentMethod === 'cash' ? total : Number(paid);
    if (Number.isNaN(paidNum) || paidNum < 0) throw new AppError('المبلغ المدفوع غير صحيح', 400);
    if (paidNum > total) throw new AppError('المبلغ المدفوع أكبر من إجمالي العملية', 400);
    const remaining = round2(total - paidNum);

    // Cash actually leaving the register for this purchase must never
    // exceed what's actually in it — same balance-sufficiency rule already
    // enforced for manual withdrawals (cashbox.service.js) and expenses
    // (expense.service.js). Checked inside this transaction (via `session`)
    // for the same race-safety reason as those two: a balance read outside
    // the transaction could go stale against a concurrent write. Checked
    // BEFORE any stock/document mutation below so a rejected purchase never
    // leaves partial side effects behind.
    if (paidNum > 0) {
      const balance = await getBalance(session);
      if (paidNum > balance) {
        throw new AppError('رصيد الصندوق غير كافٍ لدفع هذا المبلغ لعملية الشراء', 400);
      }
    }

    // Cost = the price of the MOST RECENT purchase for this product — not a
    // weighted average. This is a deliberate shop-specific choice (they
    // don't want old, cheaper stock dragging today's cost basis down when a
    // supplier raises prices): every purchase of a product simply
    // overwrites its purchasePrice with this line's price, full stop.
    // Quantity still accumulates as always — only the cost calculation
    // changed. Still done via the same atomic aggregation-pipeline update
    // (rather than a separate read-then-write) for the same reason as
    // before: no read/write race window, even for a purchase that lists the
    // same product on two lines — each line's update simply overwrites
    // purchasePrice again, so whichever line is processed LAST naturally
    // wins, with no special-casing needed for that.
    const priceWarnings = [];
    for (const line of lines) {
      const updated = await Product.findOneAndUpdate(
        { _id: line.productId },
        [
          {
            $set: {
              quantity: { $add: ['$quantity', line.quantity] },
              purchasePrice: line.price,
            },
          },
        ],
        { session, new: true, projection: { purchasePrice: 1, salePrice: 1, name: 1 } },
      );
      if (!updated) {
        // Only reachable if the product was deleted between the validation
        // read above and this write, within the same transaction.
        throw new AppError(`المنتج غير موجود: ${line.name}`, 404);
      }
      // Flag right here, at the exact moment a purchase is what pushed the
      // cost to this point — the natural place to notice, rather than only
      // discovering it later while selling at a loss. Never blocks the
      // purchase itself; see product.service.js's `needsReview` filter for
      // the standing way to find every such product later too.
      if (updated.purchasePrice >= updated.salePrice) {
        priceWarnings.push({ productId: updated._id, name: updated.name, purchasePrice: updated.purchasePrice, salePrice: updated.salePrice });
      }
    }

    const purchaseNumber = await nextSequence('purchaseNumber', 'PUR', session);

    // Backdating support (matches the frontend's purchase form): a supplied
    // `date` (YYYY-MM-DD) is pinned to noon on that day, avoiding midnight/
    // timezone edge effects; otherwise defaults to now.
    const purchaseDate = date ? new Date(`${date}T12:00:00`) : new Date();

    const [createdPurchase] = await Purchase.create(
      [{
        purchaseNumber,
        supplierId,
        items: lines,
        subtotal,
        discount: discountNum,
        total,
        paid: paidNum,
        remaining,
        paymentMethod,
        notes: notes || '',
        date: purchaseDate,
      }],
      { session },
    );

    if (paidNum > 0) {
      await CashboxTransaction.create(
        [{
          type: 'out',
          amount: paidNum,
          reason: `دفع عملية شراء رقم ${createdPurchase.purchaseNumber}`,
          refType: 'purchase',
          refId: createdPurchase._id,
          date: createdPurchase.date,
        }],
        { session },
      );
    }

    await recordActivity(
      {
        type: 'purchase',
        description: `تم تسجيل عملية شراء رقم ${createdPurchase.purchaseNumber}`,
        amount: total,
        refId: createdPurchase._id,
      },
      { session },
    );

    await recordAuditLog(
      {
        action: 'purchase.create',
        entityType: 'Purchase',
        entityId: createdPurchase._id,
        values: {
          purchaseNumber: createdPurchase.purchaseNumber,
          supplierId: createdPurchase.supplierId,
          subtotal,
          discount: discountNum,
          total,
          paid: paidNum,
          remaining,
          paymentMethod,
          itemCount: lines.length,
        },
      },
      { session },
    );

    return { createdPurchase, priceWarnings };
  });

  return { ...purchase.createdPurchase.toObject(), priceWarnings: purchase.priceWarnings };
}

/**
 * Matches the shape of listSales: search (purchase number OR supplier
 * name — via $lookup), exact supplierId, exact paymentMethod, date range.
 */
export async function listPurchases({ page = 1, limit = DEFAULT_PAGE_SIZE, search, supplierId, paymentMethod, from, to } = {}) {
  const match = {};

  if (supplierId && supplierId !== 'all') {
    if (!mongoose.isValidObjectId(supplierId)) throw new AppError('معرّف مورد غير صالح', 400);
    match.supplierId = new mongoose.Types.ObjectId(supplierId);
  }
  if (paymentMethod && paymentMethod !== 'all') {
    match.paymentMethod = paymentMethod;
  }
  const range = cairoRangeMatch(from, to);
  if (Object.keys(range).length) match.date = range;

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const pipeline = [{ $match: match }];

  if (search && search.trim()) {
    const re = new RegExp(escapeRegex(search.trim()), 'i');
    pipeline.push(
      {
        $lookup: {
          from: Supplier.collection.name,
          localField: 'supplierId',
          foreignField: '_id',
          as: '_supplier',
        },
      },
      { $addFields: { _supplierName: { $ifNull: [{ $arrayElemAt: ['$_supplier.name', 0] }, ''] } } },
      { $match: { $or: [{ purchaseNumber: re }, { _supplierName: re }] } },
      { $project: { _supplier: 0, _supplierName: 0 } },
    );
  }

  pipeline.push(
    { $sort: { date: -1 } },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: pageSize }],
        totalCount: [{ $count: 'count' }],
      },
    },
  );

  const [{ items, totalCount }] = await Purchase.aggregate(pipeline);
  const total = totalCount[0]?.count || 0;

  return {
    items,
    pagination: { page: pageNum, limit: pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getPurchase(id) {
  const purchase = await Purchase.findById(id);
  if (!purchase) throw new AppError('عملية الشراء غير موجودة', 404);
  return purchase;
}