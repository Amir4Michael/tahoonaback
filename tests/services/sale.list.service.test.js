import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../src/models/Product.js', () => ({ default: { findById: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../../src/models/CashboxTransaction.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../../src/services/sequence.service.js', () => ({ nextSequence: vi.fn() }));
vi.mock('../../src/services/activityLog.service.js', () => ({ recordActivity: vi.fn() }));

const saleMocks = vi.hoisted(() => ({ aggregate: vi.fn(), findById: vi.fn() }));
vi.mock('../../src/models/Sale.js', () => ({
  default: {
    aggregate: (...args) => saleMocks.aggregate(...args),
    findById: (...args) => saleMocks.findById(...args),
  },
}));

vi.mock('../../src/models/Customer.js', () => ({ default: { collection: { name: 'customers' } } }));

import { listSales, getSale } from '../../src/services/sale.service.js';

function mockAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listSales', () => {
  it('returns pagination metadata', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ items: [{ invoiceNumber: 'INV-1' }], totalCount: [{ count: 12 }] }]));
    const result = await listSales({ page: 1, limit: 5 });
    expect(result.pagination).toEqual({ page: 1, limit: 5, total: 12, totalPages: 3 });
  });

  it('filters by exact customerId when provided (not "all")', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    const id = new mongoose.Types.ObjectId().toString();
    await listSales({ customerId: id });
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.customerId).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  it('ignores customerId="all"', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listSales({ customerId: 'all' });
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.customerId).toBeUndefined();
  });

  it('rejects a malformed customerId', async () => {
    await expect(listSales({ customerId: 'not-an-id' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('filters by exact paymentMethod when not "all"', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listSales({ paymentMethod: 'credit' });
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match.paymentMethod).toBe('credit');
  });

  it('applies a date range using day boundaries (00:00:00 to 23:59:59)', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listSales({ from: '2026-01-01', to: '2026-01-31' });
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    const { date } = pipeline.find((s) => s.$match).$match;
    expect(date.$gte.toISOString()).toContain('2026-01-01T00:00:00');
    expect(date.$lte.toISOString()).toContain('2026-01-31T23:59:59');
  });

  it('adds a $lookup + customer-name fallback ("عميل نقدي") and search $match only when search is given', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listSales({ search: 'INV-10' });
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$lookup)).toBeDefined();
    const addFields = pipeline.find((s) => s.$addFields);
    expect(addFields.$addFields._customerName.$ifNull[1]).toBe('عميل نقدي');
  });

  it('skips the $lookup entirely when there is no search (cheaper query)', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listSales({});
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$lookup)).toBeUndefined();
  });
});

describe('getSale', () => {
  it('returns the sale when found', async () => {
    saleMocks.findById.mockResolvedValue({ invoiceNumber: 'INV-1' });
    const sale = await getSale('id1');
    expect(sale.invoiceNumber).toBe('INV-1');
  });

  it('throws 404 when not found', async () => {
    saleMocks.findById.mockResolvedValue(null);
    await expect(getSale('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});
