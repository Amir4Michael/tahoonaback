import Sale from '../models/Sale.js';
import Purchase from '../models/Purchase.js';
import Expense from '../models/Expense.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';

// Generous cap for an unlimited "full table" request (e.g. the purchases
// report's supplier-balances table, which the frontend renders unpaginated
// today) — protects against a pathological case without changing behavior
// at the scale this system is built for.
const FULL_LIST_SAFETY_CAP = 500;

function dateRangeMatch(from, to) {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = new Date(`${from}T00:00:00`);
  if (to) range.$lte = new Date(`${to}T23:59:59`);
  return { date: range };
}

/**
 * Rolls up total/paid/remaining per person (Customer or Supplier) from their
 * transaction collection (Sale or Purchase) — shared by the customers and
 * suppliers reports AND by the purchases report's full supplier-balances
 * table (called there with a large `limit` and only its `.top` used). One
 * aggregation computes both the summary numbers (count/outstanding/with-
 * balance count) and the sorted top-N list together via $facet, so this is
 * a single database round-trip regardless of collection size — unlike
 * fetching everyone and reducing in application code, which would not scale.
 *
 * NOT date-filtered — matches the frontend's customerTotals/supplierTotals
 * selectors, which are always all-time balances regardless of any report
 * period selected elsewhere on the page.
 */
async function getPersonBalanceReport(Model, TransactionModel, refField, limit) {
  const [result] = await Model.aggregate([
    {
      $lookup: {
        from: TransactionModel.collection.name,
        localField: '_id',
        foreignField: refField,
        as: '_tx',
      },
    },
    {
      $addFields: {
        total: { $sum: '$_tx.total' },
        paid: { $sum: '$_tx.paid' },
      },
    },
    { $addFields: { remaining: { $subtract: ['$total', '$paid'] } } },
    { $project: { _tx: 0 } },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              totalOutstanding: { $sum: '$remaining' },
              withBalanceCount: { $sum: { $cond: [{ $gt: ['$remaining', 0] }, 1, 0] } },
            },
          },
        ],
        top: [{ $sort: { total: -1 } }, { $limit: limit }],
      },
    },
  ]);

  const summary = result.summary[0] || { count: 0, totalOutstanding: 0, withBalanceCount: 0 };
  return { ...summary, top: result.top };
}

/** Sales tab: revenue/collection stats for the range, plus best-selling products (by quantity). */
export async function getSalesReport({ from, to } = {}) {
  const [result] = await Sale.aggregate([
    { $match: dateRangeMatch(from, to) },
    {
      $facet: {
        overall: [
          {
            $group: {
              _id: null,
              revenue: { $sum: '$total' },
              invoiceCount: { $sum: 1 },
              cashTotal: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash'] }, '$total', 0] } },
              creditTotal: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'credit'] }, '$total', 0] } },
              paid: { $sum: '$paid' },
              remaining: { $sum: '$remaining' },
            },
          },
        ],
        bestSellers: [
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.productId',
              name: { $first: '$items.name' },
              qty: { $sum: '$items.quantity' },
              total: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
            },
          },
          { $sort: { qty: -1 } },
          { $limit: 5 },
        ],
      },
    },
  ]);

  const overall = result.overall[0] || {
    revenue: 0, invoiceCount: 0, cashTotal: 0, creditTotal: 0, paid: 0, remaining: 0,
  };
  return {
    ...overall,
    bestSellers: result.bestSellers.map((b) => ({ productId: b._id, name: b.name, qty: b.qty, total: b.total })),
  };
}

/** Purchases tab: totals for the range, plus the (uncapped-in-practice) supplier balance table. */
export async function getPurchasesReport({ from, to } = {}) {
  const [overallResult, supplierBalances] = await Promise.all([
    Purchase.aggregate([
      { $match: dateRangeMatch(from, to) },
      {
        $group: {
          _id: null,
          total: { $sum: '$total' },
          count: { $sum: 1 },
          paid: { $sum: '$paid' },
          remaining: { $sum: '$remaining' },
        },
      },
    ]),
    getPersonBalanceReport(Supplier, Purchase, 'supplierId', FULL_LIST_SAFETY_CAP),
  ]);

  const overall = overallResult[0] || { total: 0, count: 0, paid: 0, remaining: 0 };
  return { ...overall, supplierBalances: supplierBalances.top };
}

/**
 * Profit tab: revenue and cost-of-goods-sold computed together from sale
 * line items in a single $unwind pass (revenue this way equals summing
 * `total` per sale, since a sale's `total` is always the sum of its own
 * lines by construction — computing both from items in one aggregation
 * avoids a second query for what would otherwise be the same range scan).
 */
export async function getProfitReport({ from, to } = {}) {
  const [[salesAgg], [expenseAgg]] = await Promise.all([
    Sale.aggregate([
      { $match: dateRangeMatch(from, to) },
      { $unwind: '$items' },
      {
        $group: {
          _id: null,
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          cogs: { $sum: { $multiply: ['$items.cost', '$items.quantity'] } },
        },
      },
    ]),
    Expense.aggregate([
      { $match: dateRangeMatch(from, to) },
      { $group: { _id: null, sum: { $sum: '$amount' } } },
    ]),
  ]);

  const revenue = salesAgg?.revenue || 0;
  const cogs = salesAgg?.cogs || 0;
  const gross = revenue - cogs;
  const expenses = expenseAgg?.sum || 0;

  return { revenue, cogs, gross, expenses, net: gross - expenses };
}

/** Inventory tab: a snapshot of the CURRENT catalog — never date-filtered. */
export async function getInventoryReport() {
  const [result] = await Product.aggregate([
    {
      $group: {
        _id: null,
        productsCount: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' },
        costValue: { $sum: { $multiply: ['$purchasePrice', '$quantity'] } },
        saleValue: { $sum: { $multiply: ['$salePrice', '$quantity'] } },
        lowCount: {
          $sum: { $cond: [{ $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$minQuantity'] }] }, 1, 0] },
        },
        outCount: { $sum: { $cond: [{ $lte: ['$quantity', 0] }, 1, 0] } },
      },
    },
  ]);

  const stats = result || { productsCount: 0, totalQuantity: 0, costValue: 0, saleValue: 0, lowCount: 0, outCount: 0 };
  return { ...stats, expectedProfit: stats.saleValue - stats.costValue };
}

export async function getCustomersReport({ limit = 8 } = {}) {
  const { count, totalOutstanding, withBalanceCount, top } = await getPersonBalanceReport(Customer, Sale, 'customerId', limit);
  return { count, totalOutstanding, withBalanceCount, topCustomers: top };
}

export async function getSuppliersReport({ limit = 8 } = {}) {
  const { count, totalOutstanding, withBalanceCount, top } = await getPersonBalanceReport(Supplier, Purchase, 'supplierId', limit);
  return { count, totalOutstanding, withBalanceCount, topSuppliers: top };
}
