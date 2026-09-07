import mongoose from 'mongoose';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import CashboxTransaction from '../models/CashboxTransaction.js';
import { AppError } from '../middleware/errorHandler.js';
import { nextSequence } from './sequence.service.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';
import { withTransaction } from '../utils/transactions.js';
import { round2 } from '../models/shared/money.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Creates a sale in a single MongoDB transaction (via the shared
 * `withTransaction` helper, which also retries on transient replica-set
 * errors): validates and prices every line, decrements stock, writes the
 * Sale, records the cashbox movement (if anything was paid), and logs the
 * activity entry — all together, or none of it. A transaction is required
 * here specifically because this touches MULTIPLE documents across MULTIPLE
 * collections that must stay consistent as a group (e.g. stock must never
 * end up decremented for a sale that ultimately failed to save); each
 * individual write below is also atomic on its own, but that alone doesn't
 * protect the group.
 *
 * Mirrors the frontend's completeSaleSvc validation order and messages
 * exactly: empty cart -> credit-without-customer -> per-line checks
 * (existence, quantity, price) -> payment amount checks.
 *
 * `discount` is a FLAT (fixed-amount) reduction on the invoice's `subtotal`
 * as a whole — it is never distributed across `items[]`, so every line's
 * `price` always stays the actual per-unit price the product sold at (the
 * historical-integrity rule above still holds for lines; only the invoice's
 * own total is adjusted). The client's `total`/`discount` are never trusted:
 * `subtotal` is recomputed here from the validated lines, and `discount` is
 * re-validated against that recomputed `subtotal`, not whatever the client
 * sent for `total`.
 */
export async function createSale({ customerId, items, paymentMethod, paid, discount }) {
  if (!items || items.length === 0) {
    throw new AppError('الفاتورة فارغة، أضف منتجات أولاً', 400);
  }
  if (paymentMethod === 'credit' && !customerId) {
    throw new AppError('اختر عميلاً لإتمام البيع بالآجل', 400);
  }

  const sale = await withTransaction(async (session) => {
    const lines = [];
    for (const item of items) {
      const product = await Product.findById(item.productId).session(session);
      if (!product) throw new AppError('منتج غير موجود في المخزون', 404);

      const qty = Number(item.quantity);
      if (!qty || qty <= 0) throw new AppError(`الكمية غير صحيحة للمنتج: ${product.name}`, 400);
      if (qty > product.quantity) {
        throw new AppError(`الكمية المطلوبة من "${product.name}" أكبر من المتاح (${product.quantity})`, 400);
      }

      // Sale price defaults to the product's current sale price, but the
      // caller (POS) may override it for this transaction only. Stamped
      // onto the line only — never written back to the product.
      const hasCustomPrice = item.price !== undefined && item.price !== null && item.price !== '';
      const price = hasCustomPrice ? Number(item.price) : product.salePrice;
      if (Number.isNaN(price) || price < 0) {
        throw new AppError(`سعر البيع غير صحيح للمنتج: ${product.name}`, 400);
      }

      lines.push({
        productId: product._id,
        name: product.name,
        code: product.code,
        price,
        cost: product.purchasePrice, // snapshot of cost AT THE MOMENT of sale
        quantity: qty,
      });
    }

    const subtotal = round2(lines.reduce((s, l) => s + l.price * l.quantity, 0));
    const grossProfit = lines.reduce((s, l) => s + (l.price - l.cost) * l.quantity, 0);

    // Discount defaults to 0 (no discount) when omitted — matches every
    // sale created before this feature existed. Same '' / null / undefined
    // -> "no discount" handling as the per-line custom price above.
    const hasDiscount = discount !== undefined && discount !== null && discount !== '';
    const discountNum = hasDiscount ? round2(Number(discount)) : 0;
    if (Number.isNaN(discountNum) || discountNum < 0) {
      throw new AppError('قيمة الخصم غير صحيحة', 400);
    }
    if (discountNum > subtotal) {
      throw new AppError('الخصم أكبر من إجمالي الفاتورة', 400);
    }

    const total = round2(subtotal - discountNum);
    // The discount reduces actual revenue for this invoice, so it comes off
    // profit too (cost basis of the lines is unaffected by it).
    const profit = round2(grossProfit - discountNum);

    const paidNum = paymentMethod === 'cash' ? total : Number(paid);
    if (Number.isNaN(paidNum) || paidNum < 0) throw new AppError('المبلغ المدفوع غير صحيح', 400);
    if (paidNum > total) throw new AppError('المبلغ المدفوع أكبر من إجمالي الفاتورة', 400);
    const remaining = round2(total - paidNum);

    // Atomic, guarded decrement per line: re-checks availability at WRITE
    // time (the $gte guard), not just against the read taken above. This
    // closes a race the frontend's single-snapshot validation can't: two
    // concurrent sales for the same product can never both succeed past
    // available stock, and a sale that (incorrectly) lists the same
    // product on two lines can never oversell past what the first line
    // already reserved.
    for (const line of lines) {
      const result = await Product.updateOne(
        { _id: line.productId, quantity: { $gte: line.quantity } },
        { $inc: { quantity: -line.quantity } },
        { session },
      );
      if (result.matchedCount === 0) {
        throw new AppError(`الكمية المطلوبة من "${line.name}" لم تعد متاحة`, 409);
      }
    }

    const invoiceNumber = await nextSequence('invoiceNumber', 'INV', session);

    const [createdSale] = await Sale.create(
      [{
        invoiceNumber,
        customerId: customerId || null,
        items: lines,
        subtotal,
        discount: discountNum,
        total,
        paid: paidNum,
        remaining,
        profit,
        paymentMethod,
      }],
      { session },
    );

    if (paidNum > 0) {
      await CashboxTransaction.create(
        [{
          type: 'in',
          amount: paidNum,
          reason: `تحصيل فاتورة بيع رقم ${createdSale.invoiceNumber}`,
          refType: 'sale',
          refId: createdSale._id,
          date: createdSale.date,
        }],
        { session },
      );
    }

    await recordActivity(
      { type: 'sale', description: `تم إنشاء فاتورة بيع رقم ${createdSale.invoiceNumber}`, amount: total, refId: createdSale._id },
      { session },
    );

    await recordAuditLog(
      {
        action: 'sale.create',
        entityType: 'Sale',
        entityId: createdSale._id,
        values: {
          invoiceNumber: createdSale.invoiceNumber,
          customerId: createdSale.customerId,
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

    return createdSale;
  });

  return sale;
}

/**
 * Matches SalesHistoryPage's filters: search (invoice number OR customer
 * name — "عميل نقدي" for a null customerId), exact customerId, exact
 * paymentMethod, and a date range. Customer name isn't stored on Sale (only
 * customerId), so search requires a $lookup; done once per request as part
 * of the same aggregation as pagination, not as a separate query per row.
 */
export async function listSales({ page = 1, limit = DEFAULT_PAGE_SIZE, search, customerId, paymentMethod, from, to } = {}) {
  const match = {};

  if (customerId && customerId !== 'all') {
    if (!mongoose.isValidObjectId(customerId)) throw new AppError('معرّف عميل غير صالح', 400);
    match.customerId = new mongoose.Types.ObjectId(customerId);
  }
  if (paymentMethod && paymentMethod !== 'all') {
    match.paymentMethod = paymentMethod;
  }
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = new Date(`${from}T00:00:00`);
    if (to) match.date.$lte = new Date(`${to}T23:59:59`);
  }

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const pipeline = [{ $match: match }];

  if (search && search.trim()) {
    const re = new RegExp(escapeRegex(search.trim()), 'i');
    pipeline.push(
      {
        $lookup: {
          from: Customer.collection.name,
          localField: 'customerId',
          foreignField: '_id',
          as: '_customer',
        },
      },
      {
        $addFields: {
          _customerName: { $ifNull: [{ $arrayElemAt: ['$_customer.name', 0] }, 'عميل نقدي'] },
        },
      },
      { $match: { $or: [{ invoiceNumber: re }, { _customerName: re }] } },
      { $project: { _customer: 0, _customerName: 0 } },
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

  const [{ items, totalCount }] = await Sale.aggregate(pipeline);
  const total = totalCount[0]?.count || 0;

  return {
    items,
    pagination: { page: pageNum, limit: pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getSale(id) {
  const sale = await Sale.findById(id);
  if (!sale) throw new AppError('الفاتورة غير موجودة', 404);
  return sale;
}
