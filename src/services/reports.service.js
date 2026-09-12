import Sale from '../models/Sale.js';
import Purchase from '../models/Purchase.js';
import Expense from '../models/Expense.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import CustomerPayment from '../models/CustomerPayment.js';
import SupplierPayment from '../models/SupplierPayment.js';
import SalesReturn from '../models/SalesReturn.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import { cairoRangeMatch } from '../utils/timezone.js';
import { round2 } from '../models/shared/money.js';

// Generous cap for an unlimited "full table" request (e.g. the purchases
// report's supplier-balances table, which the frontend renders unpaginated
// today) — protects against a pathological case without changing behavior
// at the scale this system is built for.
const FULL_LIST_SAFETY_CAP = 500;

// `from`/`to` are YYYY-MM-DD as picked in the frontend's date range,
// anchored to Cairo calendar days (see utils/timezone.js) rather than the
// server's own local time — this is what a report period like "today" or
// "this month" actually needs to mean for a shop operating in Egypt.
function dateRangeMatch(from, to) {
  const range = cairoRangeMatch(from, to);
  return Object.keys(range).length ? { date: range } : {};
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
 *
 * `PaymentModel`/`ReturnModel` are optional and, when passed, are folded
 * into `paid`/`remaining` here using the EXACT SAME formula as
 * `personService.getTotals` (standalone settlements reduce `remaining`
 * directly; returns reduce it too and are floored at 0, with any excess
 * ignored here — this report only ever needs `remaining`, never a
 * `creditOwed` figure). This keeps the Reports page's numbers from ever
 * drifting out of sync with what Customer/Supplier Details shows for the
 * same person — the bug this fixes was exactly that drift: a customer who
 * had paid down their balance via a standalone payment, or had goods
 * returned, still showed their old, pre-payment/pre-return balance here.
 */
async function getPersonBalanceReport(Model, TransactionModel, refField, limit, PaymentModel, ReturnModel) {
  const pipeline = [
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
  ];

  if (PaymentModel) {
    pipeline.push(
      {
        $lookup: {
          from: PaymentModel.collection.name,
          localField: '_id',
          foreignField: refField,
          as: '_payments',
        },
      },
      { $addFields: { paid: { $add: ['$paid', { $sum: '$_payments.amount' }] } } },
    );
  }

  if (ReturnModel) {
    pipeline.push(
      {
        $lookup: {
          from: ReturnModel.collection.name,
          localField: '_id',
          foreignField: refField,
          as: '_returns',
        },
      },
      { $addFields: { returned: { $sum: '$_returns.totalReturnAmount' } } },
    );
  }

  pipeline.push({
    $addFields: {
      remaining: ReturnModel
        ? { $subtract: [{ $subtract: ['$total', '$paid'] }, '$returned'] }
        : { $subtract: ['$total', '$paid'] },
    },
  });

  if (ReturnModel) {
    // Same floor-at-0 as personService.getTotals: a return can legitimately
    // push the raw remaining negative (return eligibility is quantity-based
    // only). This report only surfaces `remaining`, so the excess is simply
    // not counted as outstanding — it never displayed a creditOwed figure
    // before this fix either, so that stays out of scope here.
    pipeline.push({ $addFields: { remaining: { $cond: [{ $lt: ['$remaining', 0] }, 0, '$remaining'] } } });
  }

  pipeline.push(
    { $project: { _tx: 0, _payments: 0, _returns: 0 } },
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
  );

  const [result] = await Model.aggregate(pipeline);

  const summary = result.summary[0] || { count: 0, totalOutstanding: 0, withBalanceCount: 0 };
  return { ...summary, top: result.top };
}

/**
 * Sales tab: revenue/collection stats for the range, plus best-selling
 * products (by quantity).
 *
 * `creditOutstandingAtSale`: for sales IN this range, their own `total -
 * paid`, reduced by any SalesReturn actually filed against that SAME sale
 * (fully traceable via SalesReturn.saleId, so this part is exact). It does
 * NOT reduce for a standalone "تسجيل سداد" CustomerPayment, because those
 * settle a customer's AGGREGATE balance across every sale they've ever
 * made, not any one specific invoice — there is no traceable link from a
 * payment back to which sale(s) it paid down, so folding it in here would
 * mean guessing at an allocation the data doesn't actually support. For the
 * customer's true current balance (which DOES account for those payments),
 * see the Customers report tab instead — this figure answers a narrower,
 * but exact, question: "how much credit did sales in this period leave
 * uncollected, net of what was later returned".
 */
export async function getSalesReport({ from, to } = {}) {
  const [result] = await Sale.aggregate([
    { $match: dateRangeMatch(from, to) },
    {
      $lookup: {
        from: SalesReturn.collection.name,
        localField: '_id',
        foreignField: 'saleId',
        as: '_returns',
      },
    },
    {
      $addFields: {
        _liveRemaining: {
          $max: [{ $subtract: ['$remaining', { $sum: '$_returns.totalReturnAmount' }] }, 0],
        },
      },
    },
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
              creditOutstandingAtSale: { $sum: '$_liveRemaining' },
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
    revenue: 0, invoiceCount: 0, cashTotal: 0, creditTotal: 0, paid: 0, creditOutstandingAtSale: 0,
  };
  return {
    ...overall,
    bestSellers: result.bestSellers.map((b) => ({ productId: b._id, name: b.name, qty: b.qty, total: b.total })),
  };
}

/**
 * Purchases tab: totals for the range, plus the (uncapped-in-practice)
 * supplier balance table. `creditOutstandingAtPurchase` follows the exact
 * same reasoning as getSalesReport's `creditOutstandingAtSale` above (swap
 * customer/Sale for supplier/Purchase, SalesReturn for PurchaseReturn) —
 * see that docstring for why standalone SupplierPayments aren't folded in.
 * The supplier-balances table below is unaffected by any of this: it comes
 * from getPersonBalanceReport, which already nets out both payments and
 * returns per supplier (see that function's own docstring).
 */
export async function getPurchasesReport({ from, to } = {}) {
  const [overallResult, supplierBalances] = await Promise.all([
    Purchase.aggregate([
      { $match: dateRangeMatch(from, to) },
      {
        $lookup: {
          from: PurchaseReturn.collection.name,
          localField: '_id',
          foreignField: 'purchaseId',
          as: '_returns',
        },
      },
      {
        $addFields: {
          _liveRemaining: {
            $max: [{ $subtract: ['$remaining', { $sum: '$_returns.totalReturnAmount' }] }, 0],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$total' },
          count: { $sum: 1 },
          paid: { $sum: '$paid' },
          creditOutstandingAtPurchase: { $sum: '$_liveRemaining' },
        },
      },
    ]),
    getPersonBalanceReport(Supplier, Purchase, 'supplierId', FULL_LIST_SAFETY_CAP, SupplierPayment, PurchaseReturn),
  ]);

  const overall = overallResult[0] || { total: 0, count: 0, paid: 0, creditOutstandingAtPurchase: 0 };
  return { ...overall, supplierBalances: supplierBalances.top };
}

/**
 * Profit tab: revenue and cost-of-goods-sold for the range.
 *
 * `revenue` is summed from each sale's own `total` (post-discount — the
 * actual amount invoiced), NOT from `items.price * items.quantity`: a flat
 * invoice-level discount (see the Sale model) is never distributed across
 * lines, so summing the lines directly would overstate revenue by the total
 * discount given in the range. `cogs` has no such concept and is still
 * summed from the lines. Both are computed in one aggregation via `$facet`
 * (one branch unwinds for cogs, the other doesn't) to keep this a single
 * range scan over Sale.
 */
export async function getProfitReport({ from, to } = {}) {
  const [[salesAgg], [expenseAgg]] = await Promise.all([
    Sale.aggregate([
      { $match: dateRangeMatch(from, to) },
      {
        $facet: {
          revenue: [{ $group: { _id: null, revenue: { $sum: '$total' }, discount: { $sum: '$discount' } } }],
          cogs: [
            { $unwind: '$items' },
            { $group: { _id: null, cogs: { $sum: { $multiply: ['$items.cost', '$items.quantity'] } } } },
          ],
        },
      },
      {
        $project: {
          revenue: { $ifNull: [{ $arrayElemAt: ['$revenue.revenue', 0] }, 0] },
          discount: { $ifNull: [{ $arrayElemAt: ['$revenue.discount', 0] }, 0] },
          cogs: { $ifNull: [{ $arrayElemAt: ['$cogs.cogs', 0] }, 0] },
        },
      },
    ]),
    Expense.aggregate([
      { $match: dateRangeMatch(from, to) },
      { $group: { _id: null, sum: { $sum: '$amount' } } },
    ]),
  ]);

  const revenue = salesAgg?.revenue || 0;
  const discount = salesAgg?.discount || 0;
  const cogs = salesAgg?.cogs || 0;
  const gross = revenue - cogs;
  const expenses = expenseAgg?.sum || 0;

  return { revenue, discount, cogs, gross, expenses, net: gross - expenses };
}

/**
 * Inventory tab: a snapshot of the CURRENT catalog — never date-filtered.
 *
 * `items`: the per-product breakdown behind the summary numbers above —
 * name/code/quantity/purchasePrice/salePrice/minQuantity plus derived
 * `totalValue` (quantity × purchasePrice) and `unitProfit`
 * (salePrice − purchasePrice), sorted by name. Hidden products (isActive:
 * false — see product.service.js's deleteProduct) are excluded here, same
 * as everywhere else they're kept out of day-to-day views; they're still
 * counted in the summary stats above though; since that reflects stock the
 * shop still physically owns regardless of whether it's listable right now.
 * Capped at FULL_LIST_SAFETY_CAP for the same reason as the purchases
 * report's supplier-balances table (protects against a pathological
 * catalog size without changing behavior at the scale this system targets).
 */
export async function getInventoryReport() {
  const [summaryResult, items] = await Promise.all([
    Product.aggregate([
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
    ]),
    Product.find({ isActive: { $ne: false } })
      .sort({ name: 1 })
      .limit(FULL_LIST_SAFETY_CAP)
      .select('name code quantity purchasePrice salePrice minQuantity')
      .lean(),
  ]);

  const [result] = summaryResult;
  const stats = result || { productsCount: 0, totalQuantity: 0, costValue: 0, saleValue: 0, lowCount: 0, outCount: 0 };
  return {
    ...stats,
    expectedProfit: stats.saleValue - stats.costValue,
    items: items.map((p) => ({
      productId: p._id,
      name: p.name,
      code: p.code,
      quantity: p.quantity,
      purchasePrice: p.purchasePrice,
      salePrice: p.salePrice,
      minQuantity: p.minQuantity,
      totalValue: round2(p.quantity * p.purchasePrice),
      unitProfit: round2(p.salePrice - p.purchasePrice),
    })),
  };
}

export async function getCustomersReport({ limit = 8 } = {}) {
  const { count, totalOutstanding, withBalanceCount, top } = await getPersonBalanceReport(Customer, Sale, 'customerId', limit, CustomerPayment, SalesReturn);
  return { count, totalOutstanding, withBalanceCount, topCustomers: top };
}

export async function getSuppliersReport({ limit = 8 } = {}) {
  const { count, totalOutstanding, withBalanceCount, top } = await getPersonBalanceReport(Supplier, Purchase, 'supplierId', limit, SupplierPayment, PurchaseReturn);
  return { count, totalOutstanding, withBalanceCount, topSuppliers: top };
}