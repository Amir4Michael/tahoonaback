import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const activityMocks = vi.hoisted(() => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/activityLog.service.js', () => ({
  recordActivity: (...args) => activityMocks.recordActivity(...args),
}));

const auditMocks = vi.hoisted(() => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/auditLog.service.js', () => ({
  recordAuditLog: (...args) => auditMocks.recordAuditLog(...args),
}));

import { createPersonService } from '../../src/services/personService.js';

/** Mimics Mongoose's Aggregate: thenable, chainable. */
function mockAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

function makeModelMocks() {
  return {
    aggregate: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    deleteOne: vi.fn(),
    exists: vi.fn(),
    collection: { name: 'transactions' },
  };
}

const labels = {
  notFound: 'العميل غير موجود',
  deleteBlocked: 'لا يمكن حذف عميل له فواتير مسجلة',
  added: 'تمت إضافة عميل جديد',
  updated: 'تم تعديل بيانات العميل',
  deleted: 'تم حذف العميل',
};

function makePersonDoc(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: 'أحمد محمود',
    phone: '01012345678',
    address: '',
    save: vi.fn().mockResolvedValue(undefined),
    toObject() {
      const { save, toObject, ...rest } = this; // eslint-disable-line no-unused-vars
      return rest;
    },
    ...overrides,
  };
}

let Model;
let TransactionModel;
let service;

beforeEach(() => {
  vi.clearAllMocks();
  Model = makeModelMocks();
  TransactionModel = makeModelMocks();
  service = createPersonService({ Model, TransactionModel, refField: 'customerId', activityType: 'customer', entityType: 'Customer', labels });
});

describe('getTotals', () => {
  it('returns zeroed totals when there are no transactions', async () => {
    TransactionModel.aggregate.mockReturnValue(mockAggregate([]));
    const id = new mongoose.Types.ObjectId().toString();
    const totals = await service.getTotals(id);
    expect(totals).toEqual({ total: 0, paid: 0, remaining: 0, count: 0, lastPurchase: null });
  });

  it('computes remaining as total - paid and passes through count/lastPurchase', async () => {
    TransactionModel.aggregate.mockReturnValue(
      mockAggregate([{ total: 1000, paid: 600, count: 3, lastPurchase: '2026-01-01T00:00:00.000Z' }]),
    );
    const id = new mongoose.Types.ObjectId().toString();
    const totals = await service.getTotals(id);
    expect(totals).toEqual({ total: 1000, paid: 600, remaining: 400, count: 3, lastPurchase: '2026-01-01T00:00:00.000Z' });
  });

  it('matches transactions by the configured refField, cast to ObjectId', async () => {
    TransactionModel.aggregate.mockReturnValue(mockAggregate([]));
    const id = new mongoose.Types.ObjectId().toString();
    await service.getTotals(id);
    const pipeline = TransactionModel.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.customerId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(matchStage.$match.customerId.toString()).toBe(id);
  });
});

describe('list', () => {
  it('returns pagination metadata', async () => {
    Model.aggregate.mockReturnValue(mockAggregate([{ items: [makePersonDoc()], totalCount: [{ count: 33 }] }]));
    const result = await service.list({ page: 2, limit: 10 });
    expect(result.pagination).toEqual({ page: 2, limit: 10, total: 33, totalPages: 4 });
  });

  it('builds a case-insensitive name/phone $or for search', async () => {
    Model.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await service.list({ search: 'محمود' });
    const pipeline = Model.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.$or).toHaveLength(2);
    expect(matchStage.$match.$or[0].name).toBeInstanceOf(RegExp);
    expect(matchStage.$match.$or[1].phone).toBeInstanceOf(RegExp);
  });

  it('$lookup joins against the configured TransactionModel collection and refField', async () => {
    Model.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await service.list({});
    const pipeline = Model.aggregate.mock.calls[0][0];
    const facetStage = pipeline.find((s) => s.$facet);
    const lookupStage = facetStage.$facet.items.find((s) => s.$lookup);
    expect(lookupStage.$lookup).toEqual({
      from: 'transactions',
      localField: '_id',
      foreignField: 'customerId',
      as: '_tx',
    });
  });

  it('clamps limit to the max page size', async () => {
    Model.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await service.list({ limit: 9999 });
    const pipeline = Model.aggregate.mock.calls[0][0];
    const facetStage = pipeline.find((s) => s.$facet);
    expect(facetStage.$facet.items).toEqual(expect.arrayContaining([{ $limit: 100 }]));
  });
});

describe('getOne', () => {
  it('returns the person with totals attached', async () => {
    const doc = makePersonDoc();
    Model.findById.mockResolvedValue(doc);
    TransactionModel.aggregate.mockReturnValue(mockAggregate([{ total: 500, paid: 200, count: 1, lastPurchase: null }]));

    const result = await service.getOne(doc._id.toString());

    expect(result.name).toBe('أحمد محمود');
    expect(result.totals).toEqual({ total: 500, paid: 200, remaining: 300, count: 1, lastPurchase: null });
    expect(result.save).toBeUndefined(); // toObject() strips Mongoose internals
  });

  it('throws 404 when not found', async () => {
    Model.findById.mockResolvedValue(null);
    await expect(service.getOne('missing')).rejects.toMatchObject({ statusCode: 404, message: labels.notFound });
  });
});

describe('create', () => {
  it('creates and records an activity entry using the configured labels/type', async () => {
    const doc = makePersonDoc();
    Model.create.mockResolvedValue(doc);

    const result = await service.create({ name: 'أحمد محمود' });

    expect(result).toBe(doc);
    expect(activityMocks.recordActivity).toHaveBeenCalledWith({
      type: 'customer',
      description: `${labels.added}: أحمد محمود`,
      refId: doc._id,
    });
  });
});

describe('update', () => {
  it('throws 404 when not found', async () => {
    Model.findById.mockResolvedValue(null);
    await expect(service.update('missing', { name: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('applies a true partial update (only provided fields change)', async () => {
    const doc = makePersonDoc({ phone: '0100000000' });
    Model.findById.mockResolvedValue(doc);

    await service.update(doc._id.toString(), { address: 'شارع الجمهورية' });

    expect(doc.address).toBe('شارع الجمهورية');
    expect(doc.phone).toBe('0100000000'); // untouched
    expect(doc.save).toHaveBeenCalled();
    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'customer', description: expect.stringContaining(labels.updated) }),
    );
  });
});

describe('remove', () => {
  it('checks for existing transactions BEFORE checking the person exists (matches frontend order)', async () => {
    TransactionModel.exists.mockResolvedValue(true);

    await expect(service.remove('any-id')).rejects.toMatchObject({
      statusCode: 409,
      message: labels.deleteBlocked,
      details: { code: 'HAS_TRANSACTIONS' },
    });
    expect(Model.findById).not.toHaveBeenCalled(); // never even looked up
  });

  it('throws 404 when the person does not exist and has no transactions', async () => {
    TransactionModel.exists.mockResolvedValue(false);
    Model.findById.mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deletes and records an activity entry on success', async () => {
    TransactionModel.exists.mockResolvedValue(false);
    const doc = makePersonDoc();
    Model.findById.mockResolvedValue(doc);

    await service.remove(doc._id.toString());

    expect(Model.deleteOne).toHaveBeenCalledWith({ _id: doc._id.toString() });
    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'customer', description: expect.stringContaining(labels.deleted) }),
    );
  });
});
