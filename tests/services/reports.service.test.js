import { describe, it, expect, vi, beforeEach } from 'vitest';

const saleMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Sale.js', () => ({
  default: { aggregate: (...args) => saleMocks.aggregate(...args), collection: { name: 'sales' } },
}));

const purchaseMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Purchase.js', () => ({
  default: { aggregate: (...args) => purchaseMocks.aggregate(...args), collection: { name: 'purchases' } },
}));

const expenseMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Expense.js', () => ({
  default: { aggregate: (...args) => expenseMocks.aggregate(...args) },
}));

const productMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Product.js', () => ({
  default: { aggregate: (...args) => productMocks.aggregate(...args) },
}));

const customerMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Customer.js', () => ({
  default: { aggregate: (...args) => customerMocks.aggregate(...args), collection: { name: 'customers' } },
}));

const supplierMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Supplier.js', () => ({
  default: { aggregate: (...args) => supplierMocks.aggregate(...args), collection: { name: 'suppliers' } },
}));

import {
  getSalesReport,
  getPurchasesReport,
  getProfitReport,
  getInventoryReport,
  getCustomersReport,
  getSuppliersReport,
} from '../../src/services/reports.service.js';

function mockAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSalesReport', () => {
  it('returns overall stats and mapped best sellers', async () => {
    saleMocks.aggregate.mockReturnValue(
      mockAggregate([{
        overall: [{ revenue: 5000, invoiceCount: 20, cashTotal: 3000, creditTotal: 2000, paid: 4500, remaining: 500 }],
        bestSellers: [{ _id: 'p1', name: 'فلتر زيت', qty: 40, total: 4800 }],
      }]),
    );
    const report = await getSalesReport({ from: '2026-01-01', to: '2026-01-31' });
    expect(report.revenue).toBe(5000);
    expect(report.invoiceCount).toBe(20);
    expect(report.bestSellers).toEqual([{ productId: 'p1', name: 'فلتر زيت', qty: 40, total: 4800 }]);
  });

  it('defaults to zeros and an empty bestSellers list when there are no sales', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ overall: [], bestSellers: [] }]));
    const report = await getSalesReport({});
    expect(report).toMatchObject({ revenue: 0, invoiceCount: 0, cashTotal: 0, creditTotal: 0, paid: 0, remaining: 0 });
    expect(report.bestSellers).toEqual([]);
  });

  it('applies the date range in $match', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ overall: [], bestSellers: [] }]));
    await getSalesReport({ from: '2026-02-01', to: '2026-02-28' });
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    const { date } = pipeline.find((s) => s.$match).$match;
    expect(date.$gte.toISOString()).toContain('2026-02-01T00:00:00');
    expect(date.$lte.toISOString()).toContain('2026-02-28T23:59:59');
  });

  it('applies no date bound at all when from/to are both omitted', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ overall: [], bestSellers: [] }]));
    await getSalesReport({});
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match).toEqual({});
  });
});

describe('getPurchasesReport', () => {
  it('combines overall totals with the supplier balances table', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ total: 9000, count: 12, paid: 7000, remaining: 2000 }]));
    supplierMocks.aggregate.mockReturnValue(
      mockAggregate([{ summary: [{ count: 3, totalOutstanding: 2000, withBalanceCount: 1 }], top: [{ name: 'مورد أ', total: 5000, paid: 3000, remaining: 2000 }] }]),
    );
    const report = await getPurchasesReport({});
    expect(report.total).toBe(9000);
    expect(report.supplierBalances).toEqual([{ name: 'مورد أ', total: 5000, paid: 3000, remaining: 2000 }]);
  });

  it('defaults overall totals to zero when there are no purchases', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([]));
    supplierMocks.aggregate.mockReturnValue(mockAggregate([{ summary: [], top: [] }]));
    const report = await getPurchasesReport({});
    expect(report).toMatchObject({ total: 0, count: 0, paid: 0, remaining: 0 });
  });

  it('requests the supplier balance table with a generous (uncapped-in-practice) limit', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ total: 0, count: 0, paid: 0, remaining: 0 }]));
    supplierMocks.aggregate.mockReturnValue(mockAggregate([{ summary: [], top: [] }]));
    await getPurchasesReport({});
    const pipeline = supplierMocks.aggregate.mock.calls[0][0];
    const facet = pipeline.find((s) => s.$facet);
    const limitStage = facet.$facet.top.find((s) => s.$limit);
    expect(limitStage.$limit).toBeGreaterThanOrEqual(500);
  });
});

describe('getProfitReport', () => {
  it('computes gross and net profit from combined sales/expenses aggregations', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ revenue: 10000, cogs: 6000 }]));
    expenseMocks.aggregate.mockReturnValue(mockAggregate([{ sum: 1500 }]));
    const report = await getProfitReport({});
    expect(report).toEqual({ revenue: 10000, cogs: 6000, gross: 4000, expenses: 1500, net: 2500 });
  });

  it('defaults to zeros when there is no data at all', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([]));
    expenseMocks.aggregate.mockReturnValue(mockAggregate([]));
    const report = await getProfitReport({});
    expect(report).toEqual({ revenue: 0, cogs: 0, gross: 0, expenses: 0, net: 0 });
  });

  it('computes revenue/cogs from sale line items via a single $unwind pass', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ revenue: 0, cogs: 0 }]));
    expenseMocks.aggregate.mockReturnValue(mockAggregate([]));
    await getProfitReport({});
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$unwind)).toEqual({ $unwind: '$items' });
    const groupStage = pipeline.find((s) => s.$group).$group;
    expect(groupStage.revenue).toEqual({ $sum: { $multiply: ['$items.price', '$items.quantity'] } });
    expect(groupStage.cogs).toEqual({ $sum: { $multiply: ['$items.cost', '$items.quantity'] } });
  });
});

describe('getInventoryReport', () => {
  it('computes stock value and expected profit', async () => {
    productMocks.aggregate.mockReturnValue(
      mockAggregate([{ productsCount: 50, totalQuantity: 800, costValue: 40000, saleValue: 60000, lowCount: 3, outCount: 1 }]),
    );
    const report = await getInventoryReport();
    expect(report.expectedProfit).toBe(20000);
    expect(report.lowCount).toBe(3);
    expect(report.outCount).toBe(1);
  });

  it('defaults to zeros when the catalog is empty', async () => {
    productMocks.aggregate.mockReturnValue(mockAggregate([]));
    const report = await getInventoryReport();
    expect(report).toEqual({
      productsCount: 0, totalQuantity: 0, costValue: 0, saleValue: 0, lowCount: 0, outCount: 0, expectedProfit: 0,
    });
  });

  it('classifies low stock as 0 < quantity <= minQuantity, and out-of-stock as quantity <= 0', async () => {
    productMocks.aggregate.mockReturnValue(mockAggregate([{ productsCount: 1, totalQuantity: 1, costValue: 1, saleValue: 1, lowCount: 0, outCount: 0 }]));
    await getInventoryReport();
    const pipeline = productMocks.aggregate.mock.calls[0][0];
    const groupStage = pipeline.find((s) => s.$group).$group;
    expect(groupStage.lowCount.$sum.$cond[0]).toEqual({ $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$minQuantity'] }] });
    expect(groupStage.outCount.$sum.$cond[0]).toEqual({ $lte: ['$quantity', 0] });
  });
});

describe('getCustomersReport', () => {
  it('rolls up from Sale via customerId and renames "top" to "topCustomers"', async () => {
    customerMocks.aggregate.mockReturnValue(
      mockAggregate([{ summary: [{ count: 10, totalOutstanding: 3000, withBalanceCount: 4 }], top: [{ name: 'أحمد', total: 1000 }] }]),
    );
    const report = await getCustomersReport({ limit: 8 });
    expect(report).toEqual({
      count: 10, totalOutstanding: 3000, withBalanceCount: 4, topCustomers: [{ name: 'أحمد', total: 1000 }],
    });
    const pipeline = customerMocks.aggregate.mock.calls[0][0];
    const lookupStage = pipeline.find((s) => s.$lookup);
    expect(lookupStage.$lookup).toMatchObject({ from: 'sales', foreignField: 'customerId' });
  });

  it('defaults to zeros when there are no customers', async () => {
    customerMocks.aggregate.mockReturnValue(mockAggregate([{ summary: [], top: [] }]));
    const report = await getCustomersReport({});
    expect(report).toEqual({ count: 0, totalOutstanding: 0, withBalanceCount: 0, topCustomers: [] });
  });
});

describe('getSuppliersReport', () => {
  it('rolls up from Purchase via supplierId and renames "top" to "topSuppliers"', async () => {
    supplierMocks.aggregate.mockReturnValue(
      mockAggregate([{ summary: [{ count: 5, totalOutstanding: 900, withBalanceCount: 2 }], top: [{ name: 'مورد', total: 500 }] }]),
    );
    const report = await getSuppliersReport({ limit: 8 });
    expect(report.topSuppliers).toEqual([{ name: 'مورد', total: 500 }]);
    const pipeline = supplierMocks.aggregate.mock.calls[0][0];
    const lookupStage = pipeline.find((s) => s.$lookup);
    expect(lookupStage.$lookup).toMatchObject({ from: 'purchases', foreignField: 'supplierId' });
  });

  it('respects a custom limit for the top list', async () => {
    supplierMocks.aggregate.mockReturnValue(mockAggregate([{ summary: [], top: [] }]));
    await getSuppliersReport({ limit: 3 });
    const pipeline = supplierMocks.aggregate.mock.calls[0][0];
    const facet = pipeline.find((s) => s.$facet);
    expect(facet.$facet.top.find((s) => s.$limit)).toEqual({ $limit: 3 });
  });
});
