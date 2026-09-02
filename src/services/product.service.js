import Product from '../models/Product.js';
import { AppError } from '../middleware/errorHandler.js';
import { isDuplicateKeyError } from '../utils/mongoErrors.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DUPLICATE_CODE_ERROR = () => new AppError('كود المنتج مستخدم من قبل', 409, { code: 'DUPLICATE_CODE' });

/**
 * Matches the current frontend's InventoryPage exactly:
 * - search: substring match (case-insensitive) on name OR code
 * - filter: 'low' (0 < qty <= minQuantity), 'out' (qty <= 0), 'available' (qty > minQuantity)
 * - sort: 'name' (Arabic-locale order, default), 'qtyAsc', 'qtyDesc', 'profit' (salePrice - purchasePrice, desc)
 *
 * Built as a single aggregation ($facet) so the page of items and the total
 * count for pagination come back in one round-trip to MongoDB instead of two
 * separate queries.
 */
export async function listProducts({ page = 1, limit = DEFAULT_PAGE_SIZE, search, filter, sort } = {}) {
  const match = {};

  if (search && search.trim()) {
    const re = new RegExp(escapeRegex(search.trim()), 'i');
    match.$or = [{ name: re }, { code: re }];
  }

  if (filter === 'out') {
    match.quantity = { $lte: 0 };
  } else if (filter === 'low') {
    match.$expr = { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$minQuantity'] }] };
  } else if (filter === 'available') {
    match.$expr = { $gt: ['$quantity', '$minQuantity'] };
  }

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const pipeline = [{ $match: match }];

  let sortStage;
  let collation;
  if (sort === 'qtyAsc') {
    sortStage = { quantity: 1 };
  } else if (sort === 'qtyDesc') {
    sortStage = { quantity: -1 };
  } else if (sort === 'profit') {
    pipeline.push({ $addFields: { _profit: { $subtract: ['$salePrice', '$purchasePrice'] } } });
    sortStage = { _profit: -1 };
  } else {
    sortStage = { name: 1 };
    collation = { locale: 'ar' }; // approximates the frontend's localeCompare('ar')
  }

  pipeline.push(
    { $sort: sortStage },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: pageSize }, { $project: { _profit: 0 } }],
        totalCount: [{ $count: 'count' }],
      },
    },
  );

  const aggQuery = Product.aggregate(pipeline);
  if (collation) aggQuery.collation(collation);
  const [{ items, totalCount }] = await aggQuery;

  const total = totalCount[0]?.count || 0;
  return {
    items,
    pagination: { page: pageNum, limit: pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getProduct(id) {
  const product = await Product.findById(id);
  if (!product) throw new AppError('المنتج غير موجود', 404);
  return product;
}

export async function createProduct(data) {
  const codeTaken = await Product.exists({ code: data.code });
  if (codeTaken) throw DUPLICATE_CODE_ERROR();

  let product;
  try {
    product = await Product.create(data);
  } catch (err) {
    // Backstop for a race between two concurrent creates with the same code —
    // the check above is a fast, friendly rejection for the common case; the
    // unique index is the actual source of truth.
    if (isDuplicateKeyError(err)) throw DUPLICATE_CODE_ERROR();
    throw err;
  }

  await recordActivity({ type: 'product', description: `تمت إضافة منتج جديد: ${product.name}`, refId: product._id });
  await recordAuditLog({
    action: 'product.create',
    entityType: 'Product',
    entityId: product._id,
    values: { name: product.name, code: product.code, salePrice: product.salePrice, purchasePrice: product.purchasePrice, quantity: product.quantity },
  });
  return product;
}

export async function updateProduct(id, data) {
  const product = await Product.findById(id);
  if (!product) throw new AppError('المنتج غير موجود', 404);

  if (data.code && data.code !== product.code) {
    const codeTaken = await Product.exists({ code: data.code, _id: { $ne: id } });
    if (codeTaken) throw DUPLICATE_CODE_ERROR();
  }

  // Snapshot only the fields actually being changed, before they change —
  // gives a precise before/after diff in the audit log rather than a full
  // (and less useful) document dump.
  const changedKeys = Object.keys(data);
  const before = {};
  for (const key of changedKeys) before[key] = product[key];

  Object.assign(product, data);

  try {
    await product.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) throw DUPLICATE_CODE_ERROR();
    throw err;
  }

  const after = {};
  for (const key of changedKeys) after[key] = product[key];

  await recordActivity({ type: 'product', description: `تم تعديل المنتج: ${product.name}`, refId: product._id });
  await recordAuditLog({
    action: 'product.update',
    entityType: 'Product',
    entityId: product._id,
    values: { changed: changedKeys, before, after },
  });
  return product;
}

/**
 * No referential check against Sale/Purchase history here — matching the
 * current frontend's deleteProductSvc exactly. This is intentional, not an
 * oversight: every Sale/Purchase line already stores its own name/code/price
 * snapshot independent of the live Product document (see Sale/Purchase model
 * docs), so deleting a product never corrupts historical records or reports.
 * (Contrast with Customer/Supplier deletion, which the frontend DOES block
 * when they have transactions on file — that's preserved as-is too.)
 */
export async function deleteProduct(id) {
  const product = await Product.findById(id);
  if (!product) throw new AppError('المنتج غير موجود', 404);

  await Product.deleteOne({ _id: id });
  await recordActivity({ type: 'product', description: `تم حذف المنتج: ${product.name}` });
  await recordAuditLog({
    action: 'product.delete',
    entityType: 'Product',
    entityId: product._id,
    values: { name: product.name, code: product.code },
  });
  return { success: true };
}
