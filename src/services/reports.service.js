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
/**
 * Sales-returns breakdown for a date range — shared by getSalesReport
 * (Sales Returns / Net Sales / per-product Returned) and getProfitReport
 * (Sales Returns / Returned COGS / Net Revenue / Net COGS), so the two tabs
 * can never compute "how many returns happened this period" differently
 * from each other.
 *
 * DATE CONVENTION (deliberate, and different from `creditOutstandingAtSale`
 * elsewhere in this file): matched by the RETURN's OWN `date`, NOT the
 * date of the sale it's against. A period report must only reflect what
 * actually happened during that period — a return processed in April
 * against a March sale is an April event; counting it in March's report
 * just because the sale happened to fall there would mean a March report
 * printed on April 1st and reprinted on April 5th could show different
 * numbers for the exact same March, which defeats the point of a period
 * report. (`creditOutstandingAtSale` is intentionally different: it
 * answers "how much of THIS SPECIFIC invoice is still uncollected right
 * now", a live per-invoice figure, not a period total — see its own
 * docstring above.)
 *
 * One consequence of this convention, by design: a product's `returnedQty`
 * (and therefore Net Sold) is NOT restricted to only sales that themselves
 * fall in this same range — a return this period of a product sold last
 * period still counts here. This can make Net Sold read lower than Gross
 * Sold sold-this-period alone, or even negative in an unusual period, and
 * that is not a bug — it is what a period-accurate return figure has to
 * allow for whenever a return doesn't land in the same period as its sale.
 *
 * `returnedCogs` is pulled from the ORIGINAL sale's own item snapshot
 * (`Sale.items.cost` — frozen at the moment that sale was made), NEVER
 * from the product's current `purchasePrice` — the whole point of a
 * snapshot is that it keeps reporting what those specific units actually
 * cost back then, unaffected by any purchase made since (see Sale.js /
 * Product.js). Matched back to that one specific original sale via
 * `saleId` (never ambiguous: a single sale's own cart never lists the same
 * product on two separate lines — see PosPage's addToCart, which merges
 * quantity into the existing line instead — so "the cost of this product
 * in that sale" always resolves to exactly one value).
 *
 * `totalReturnAmount` already has the sale's own discount ratio baked in
 * (see createSalesReturn), so summing it directly here — with no further
 * discount adjustment — is what keeps Sales Returns and Gross Sales
 * (also already discount-adjusted, via Sale.total) comparable without
 * double-counting or double-discounting either figure.
 */
async function getSalesReturnsBreakdown(from, to) {
  const [result] = await SalesReturn.aggregate([
    { $match: dateRangeMatch(from, to) },
    {
      $facet: {
        // Grouped from the ORIGINAL (not yet unwound) return documents —
        // `totalReturnAmount` is a per-RETURN figure, so summing it must
        // happen before any $unwind of items, or a multi-item return would
        // get counted once per item instead of once per return.
        overall: [
          { $group: { _id: null, salesReturns: { $sum: '$totalReturnAmount' } } },
        ],
        returnedCogs: [
          { $unwind: '$items' },
          {
            $lookup: {
              from: Sale.collection.name,
              localField: 'saleId',
              foreignField: '_id',
              as: '_sale',
            },
          },
          { $unwind: '$_sale' },
          {
            $addFields: {
              _originalCost: {
                $let: {
                  vars: {
                    matchedLine: {
                      $arrayElemAt: [
                        { $filter: { input: '$_sale.items', cond: { $eq: ['$$this.productId', '$items.productId'] } } },
                        0,
                      ],
                    },
                  },
                  in: '$$matchedLine.cost',
                },
              },
            },
          },
          { $group: { _id: null, sum: { $sum: { $multiply: ['$_originalCost', '$items.returnedQuantity'] } } } },
        ],
        byProduct: [
          { $unwind: '$items' },
          { $group: { _id: '$items.productId', returnedQty: { $sum: '$items.returnedQuantity' } } },
        ],
      },
    },
  ]);

  const salesReturns = result?.overall[0]?.salesReturns || 0;
  const returnedCogs = result?.returnedCogs[0]?.sum || 0;
  const byProduct = new Map((result?.byProduct || []).map((r) => [r._id.toString(), r.returnedQty]));
  return { salesReturns, returnedCogs, byProduct };
}

/**
 * Sales tab: revenue/collection stats for the range, plus best-selling
 * products (by quantity).
 *
 * `grossSales`/`salesReturns`/`netSales`: see getSalesReturnsBreakdown's
 * docstring for the date convention (returns matched by their OWN date,
 * not their original sale's).
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
 * uncollected, net of what was later returned". This one is intentionally
 * still matched by the ORIGINAL SALE's return-linkage (via saleId, no date
 * filter on the return itself) rather than getSalesReturnsBreakdown's
 * convention — it's a live "how much of this invoice is outstanding right
 * now" figure, not a period total, so it must reflect every return against
 * it regardless of when that return happened.
 */
export async function getSalesReport({ from, to } = {}) {
  const [[result], returnsBreakdown] = await Promise.all([
    Sale.aggregate([
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
              grossSales: { $sum: '$total' },
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
              grossSold: { $sum: '$items.quantity' },
              total: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
            },
          },
          { $sort: { grossSold: -1 } },
          { $limit: 5 },
        ],
      },
    },
    ]),
    getSalesReturnsBreakdown(from, to),
  ]);

  const overall = result.overall[0] || {
    grossSales: 0, invoiceCount: 0, cashTotal: 0, creditTotal: 0, paid: 0, creditOutstandingAtSale: 0,
  };
  const { salesReturns, byProduct } = returnsBreakdown;

  return {
    ...overall,
    salesReturns,
    netSales: round2(overall.grossSales - salesReturns),
    bestSellers: result.bestSellers.map((b) => {
      const returned = byProduct.get(b._id.toString()) || 0;
      return { productId: b._id, name: b.name, grossSold: b.grossSold, returned, netSold: b.grossSold - returned, total: b.total };
    }),
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
 * `grossSales` is summed from each sale's own `total` (post-discount — the
 * actual amount invoiced), NOT from `items.price * items.quantity`: a flat
 * invoice-level discount (see the Sale model) is never distributed across
 * lines, so summing the lines directly would overstate revenue by the total
 * discount given in the range. `grossCogs` has no such concept and is still
 * summed from the lines.
 *
 * `salesReturns`/`returnedCogs` come from the shared getSalesReturnsBreakdown
 * (see its own docstring for the date convention — matched by the RETURN's
 * own date, not the date of the sale it's against — and for why
 * `returnedCogs` is pulled from the original sale's frozen cost snapshot,
 * never Product's current purchasePrice). Using the same helper as
 * getSalesReport is what keeps Sales and Profit tabs from ever disagreeing
 * on "how much got returned this period".
 *
 * `netRevenue` = grossSales − salesReturns (same figure as getSalesReport's
 * netSales). `netCogs` = grossCogs − returnedCogs. `grossProfit` is built
 * from those NET figures (netRevenue − netCogs), not from the gross ones —
 * a returned unit's margin no longer counts as profit once it's back on
 * the shelf. `net` (net profit) = grossProfit − expenses, unchanged.
 */
export async function getProfitReport({ from, to } = {}) {
  const [[salesAgg], [expenseAgg], returnsBreakdown] = await Promise.all([
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
    getSalesReturnsBreakdown(from, to),
  ]);

  const grossSales = salesAgg?.revenue || 0;
  const discount = salesAgg?.discount || 0;
  const grossCogs = salesAgg?.cogs || 0;
  const { salesReturns, returnedCogs } = returnsBreakdown;
  const netRevenue = round2(grossSales - salesReturns);
  const netCogs = round2(grossCogs - returnedCogs);
  const grossProfit = round2(netRevenue - netCogs);
  const expenses = expenseAgg?.sum || 0;

  return {
    grossSales,
    discount,
    salesReturns,
    netRevenue,
    grossCogs,
    returnedCogs,
    netCogs,
    grossProfit,
    expenses,
    net: round2(grossProfit - expenses),
  };
}


/**
 * Inventory tab: a snapshot of the CURRENT catalog — never date-filtered.
 *
 * `productsCount`/`lowCount`/`outCount` count only ACTIVE products — the
 * ones actually visible in Inventory/POS/Purchases day to day — so this
 * number always matches what the shop owner can see and count themselves.
 * Hidden products (isActive: false — see product.service.js's
 * deleteProduct) are surfaced separately as `hiddenCount`, rather than
 * silently folded into `productsCount`: mixing them in there produced a
 * confirmed, confusing bug — the count would read higher than however many
 * products the shop owner could actually find in their own list, with
 * nothing explaining the gap.
 *
 * `totalQuantity`/`costValue`/`saleValue` still total across ALL products,
 * hidden included — that stock is real and still owned by the shop even
 * `totalQuantity`/`costValue`/`saleValue` now ALSO count only active
 * products, matching `productsCount` — a shop owner comparing this number
 * against their own visible product list is exactly the case that must
 * match, and a "quantity/value includes stock I can't currently see or
 * sell" figure was a second, separate source of the same confusion as
 * `productsCount` above. Hidden stock's value is instead surfaced
 * separately as `hiddenValue`, so it's never silently absorbed into the
 * headline number, but also never claimed as part of what's on the floor.
 *
 * `items`: the per-product breakdown behind the summary numbers above —
 * name/code/quantity/purchasePrice/salePrice/minQuantity plus derived
 * `totalValue` (quantity × purchasePrice) and `unitProfit`
 * (salePrice − purchasePrice), sorted by name. Hidden products are excluded
 * here too, same as everywhere else they're kept out of day-to-day views.
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
          productsCount: { $sum: { $cond: [{ $ne: ['$isActive', false] }, 1, 0] } },
          hiddenCount: { $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] } },
          totalQuantity: { $sum: { $cond: [{ $ne: ['$isActive', false] }, '$quantity', 0] } },
          costValue: {
            $sum: { $cond: [{ $ne: ['$isActive', false] }, { $multiply: ['$purchasePrice', '$quantity'] }, 0] },
          },
          saleValue: {
            $sum: { $cond: [{ $ne: ['$isActive', false] }, { $multiply: ['$salePrice', '$quantity'] }, 0] },
          },
          hiddenValue: {
            $sum: { $cond: [{ $eq: ['$isActive', false] }, { $multiply: ['$purchasePrice', '$quantity'] }, 0] },
          },
          lowCount: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$isActive', false] }, { $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$minQuantity'] }] },
                1,
                0,
              ],
            },
          },
          outCount: {
            $sum: { $cond: [{ $and: [{ $ne: ['$isActive', false] }, { $lte: ['$quantity', 0] }] }, 1, 0] },
          },
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
  const stats = result || { productsCount: 0, hiddenCount: 0, totalQuantity: 0, costValue: 0, saleValue: 0, hiddenValue: 0, lowCount: 0, outCount: 0 };
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