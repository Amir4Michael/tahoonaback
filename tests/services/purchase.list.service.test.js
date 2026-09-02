import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../src/models/Product.js', () => ({ default: { findById: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../../src/models/CashboxTransaction.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../../src/services/sequence.service.js', () => ({ nextSequence: vi.fn() }));
vi.mock('../../src/services/activityLog.service.js', () => ({ recordActivity: vi.fn() }));
vi.mock('../../src/utils/transactions.js', () => ({ withTransaction: vi.fn() }));

const purchaseMocks = vi.hoisted(() => ({ aggregate: vi.fn(), findById: vi.fn() }));
vi.mock('../../src/models/Purchase.js', () => ({
  default: {
    aggregate: (...args) => purchaseMocks.aggregate(...args),
    findById: (...args) => purchaseMocks.findById(...args),
  },
}));

vi.mock('../../src/models/Supplier.js', () => ({ default: { collection: { name: 'suppliers' } } }));

import { listPurchases, getPurchase } from '../../src/services/purchase.service.js';

function mockAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listPurchases', () => {
  it('returns pagination metadata', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [{ purchaseNumber: 'PUR-1' }], totalCount: [{ count: 7 }] }]));
    const result = await listPurchases({ page: 1, limit: 5 });
    expect(result.pagination).toEqual({ page: 1, limit: 5, total: 7, totalPages: 2 });
  });

  it('filters by exact supplierId when provided (not "all")', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    const id = new mongoose.Types.ObjectId().toString();
    await listPurchases({ supplierId: id });
    const pipeline = purchaseMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.supplierId).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  it('ignores supplierId="all"', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listPurchases({ supplierId: 'all' });
    const pipeline = purchaseMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match.supplierId).toBeUndefined();
  });

  it('rejects a malformed supplierId', async () => {
    await expect(listPurchases({ supplierId: 'not-an-id' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('filters by exact paymentMethod when not "all"', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listPurchases({ paymentMethod: 'credit' });
    const pipeline = purchaseMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match.paymentMethod).toBe('credit');
  });

  it('applies a date range using day boundaries', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listPurchases({ from: '2026-02-01', to: '2026-02-28' });
    const pipeline = purchaseMocks.aggregate.mock.calls[0][0];
    const { date } = pipeline.find((s) => s.$match).$match;
    expect(date.$gte.toISOString()).toContain('2026-02-01T00:00:00');
    expect(date.$lte.toISOString()).toContain('2026-02-28T23:59:59');
  });

  it('adds a $lookup for supplier-name search only when search is given', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listPurchases({ search: 'PUR-10' });
    const pipeline = purchaseMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$lookup)).toBeDefined();
  });

  it('skips the $lookup entirely when there is no search', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listPurchases({});
    const pipeline = purchaseMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$lookup)).toBeUndefined();
  });
});

describe('getPurchase', () => {
  it('returns the purchase when found', async () => {
    purchaseMocks.findById.mockResolvedValue({ purchaseNumber: 'PUR-1' });
    const purchase = await getPurchase('id1');
    expect(purchase.purchaseNumber).toBe('PUR-1');
  });

  it('throws 404 when not found', async () => {
    purchaseMocks.findById.mockResolvedValue(null);
    await expect(getPurchase('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});
