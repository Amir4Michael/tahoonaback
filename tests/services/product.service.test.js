import { describe, it, expect, vi, beforeEach } from 'vitest';

const productMocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  findById: vi.fn(),
  exists: vi.fn(),
  create: vi.fn(),
  deleteOne: vi.fn(),
}));

const activityMocks = vi.hoisted(() => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));

/** Mimics Mongoose's Aggregate: thenable, with an optional .collation() that returns itself. */
function mockAggregate(result) {
  const agg = {
    collation: vi.fn(() => agg),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return agg;
}

vi.mock('../../src/models/Product.js', () => ({
  default: {
    aggregate: (...args) => productMocks.aggregate(...args),
    findById: (...args) => productMocks.findById(...args),
    exists: (...args) => productMocks.exists(...args),
    create: (...args) => productMocks.create(...args),
    deleteOne: (...args) => productMocks.deleteOne(...args),
  },
}));

const auditMocks = vi.hoisted(() => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/auditLog.service.js', () => ({
  recordAuditLog: (...args) => auditMocks.recordAuditLog(...args),
}));

vi.mock('../../src/services/activityLog.service.js', () => ({
  recordActivity: (...args) => activityMocks.recordActivity(...args),
}));

import * as productService from '../../src/services/product.service.js';

function makeProductDoc(overrides = {}) {
  return {
    _id: 'product-id-1',
    name: 'فلتر زيت',
    code: 'P-1001',
    purchasePrice: 80,
    salePrice: 120,
    quantity: 10,
    minQuantity: 5,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listProducts', () => {
  it('paginates using page/limit and returns pagination metadata', async () => {
    productMocks.aggregate.mockReturnValue(
      mockAggregate([{ items: [makeProductDoc()], totalCount: [{ count: 45 }] }]),
    );

    const result = await productService.listProducts({ page: 2, limit: 10 });

    expect(result.pagination).toEqual({ page: 2, limit: 10, total: 45, totalPages: 5 });
    expect(result.items).toHaveLength(1);

    const pipeline = productMocks.aggregate.mock.calls[0][0];
    const facetStage = pipeline.find((s) => s.$facet);
    expect(facetStage.$facet.items).toEqual(
      expect.arrayContaining([{ $skip: 10 }, { $limit: 10 }]),
    );
  });

  it('clamps limit to the max page size', async () => {
    productMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await productService.listProducts({ page: 1, limit: 9999 });
    const pipeline = productMocks.aggregate.mock.calls[0][0];
    const facetStage = pipeline.find((s) => s.$facet);
    expect(facetStage.$facet.items).toEqual(expect.arrayContaining([{ $limit: 100 }]));
  });

  it('returns total 0 and totalPages 1 when the collection/match is empty', async () => {
    productMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    const result = await productService.listProducts({});
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(1);
  });

  it('builds a case-insensitive name/code $or for search', async () => {
    productMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await productService.listProducts({ search: 'زيت' });
    const pipeline = productMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.$or).toHaveLength(2);
    expect(matchStage.$match.$or[0].name).toBeInstanceOf(RegExp);
    expect(matchStage.$match.$or[1].code).toBeInstanceOf(RegExp);
  });

  it('escapes regex special characters in search so they are treated literally', async () => {
    productMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await productService.listProducts({ search: 'a.b*c' });
    const pipeline = productMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.$or[0].name.source).toBe('a\\.b\\*c');
  });

  it('filter=out matches quantity <= 0', async () => {
    productMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await productService.listProducts({ filter: 'out' });
    const pipeline = productMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.quantity).toEqual({ $lte: 0 });
  });

  it('filter=low matches 0 < quantity <= minQuantity via $expr', async () => {
    productMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await productService.listProducts({ filter: 'low' });
    const pipeline = productMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.$expr).toEqual({
      $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$minQuantity'] }],
    });
  });

  it('filter=available matches quantity > minQuantity via $expr', async () => {
    productMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await productService.listProducts({ filter: 'available' });
    const pipeline = productMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.$expr).toEqual({ $gt: ['$quantity', '$minQuantity'] });
  });

  it('sort=profit adds a computed _profit field and sorts by it descending', async () => {
    const agg = mockAggregate([{ items: [], totalCount: [] }]);
    productMocks.aggregate.mockReturnValue(agg);
    await productService.listProducts({ sort: 'profit' });
    const pipeline = productMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$addFields)).toEqual({
      $addFields: { _profit: { $subtract: ['$salePrice', '$purchasePrice'] } },
    });
    expect(pipeline.find((s) => s.$sort)).toEqual({ $sort: { _profit: -1 } });
  });

  it('sort=qtyAsc/qtyDesc sort by quantity directly', async () => {
    productMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await productService.listProducts({ sort: 'qtyAsc' });
    expect(productMocks.aggregate.mock.calls[0][0].find((s) => s.$sort)).toEqual({ $sort: { quantity: 1 } });

    productMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await productService.listProducts({ sort: 'qtyDesc' });
    expect(productMocks.aggregate.mock.calls[1][0].find((s) => s.$sort)).toEqual({ $sort: { quantity: -1 } });
  });

  it('default sort applies Arabic collation for locale-correct name ordering', async () => {
    const agg = mockAggregate([{ items: [], totalCount: [] }]);
    productMocks.aggregate.mockReturnValue(agg);
    await productService.listProducts({});
    expect(agg.collation).toHaveBeenCalledWith({ locale: 'ar' });
  });
});

describe('getProduct', () => {
  it('returns the product when found', async () => {
    const doc = makeProductDoc();
    productMocks.findById.mockResolvedValue(doc);
    await expect(productService.getProduct('product-id-1')).resolves.toBe(doc);
  });

  it('throws 404 when not found', async () => {
    productMocks.findById.mockResolvedValue(null);
    await expect(productService.getProduct('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('createProduct', () => {
  it('rejects a duplicate code before attempting to create', async () => {
    productMocks.exists.mockResolvedValue(true);
    await expect(productService.createProduct({ name: 'x', code: 'DUP' })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'DUPLICATE_CODE' },
    });
    expect(productMocks.create).not.toHaveBeenCalled();
  });

  it('creates the product and records an activity entry', async () => {
    productMocks.exists.mockResolvedValue(false);
    const doc = makeProductDoc();
    productMocks.create.mockResolvedValue(doc);

    const result = await productService.createProduct({ name: 'فلتر زيت', code: 'P-1001' });

    expect(result).toBe(doc);
    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'product', refId: doc._id }),
    );
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product.create', entityType: 'Product', entityId: doc._id }),
    );
  });

  it('translates a race-condition duplicate-key error from the DB into a clean 409', async () => {
    productMocks.exists.mockResolvedValue(false); // passed the pre-check...
    productMocks.create.mockRejectedValue({ code: 11000 }); // ...but lost the race
    await expect(productService.createProduct({ name: 'x', code: 'DUP' })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('updateProduct', () => {
  it('throws 404 when the product does not exist', async () => {
    productMocks.findById.mockResolvedValue(null);
    await expect(productService.updateProduct('missing', { name: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('only checks code uniqueness when the code is actually changing', async () => {
    const doc = makeProductDoc({ code: 'P-1001' });
    productMocks.findById.mockResolvedValue(doc);

    await productService.updateProduct('product-id-1', { name: 'اسم جديد' });

    expect(productMocks.exists).not.toHaveBeenCalled();
    expect(doc.name).toBe('اسم جديد');
    expect(doc.save).toHaveBeenCalled();
  });

  it('rejects when changing to a code already used by another product', async () => {
    const doc = makeProductDoc({ code: 'P-1001' });
    productMocks.findById.mockResolvedValue(doc);
    productMocks.exists.mockResolvedValue(true);

    await expect(productService.updateProduct('product-id-1', { code: 'P-9999' })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'DUPLICATE_CODE' },
    });
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('never overwrites an omitted field (true partial update)', async () => {
    const doc = makeProductDoc({ purchasePrice: 80, salePrice: 120 });
    productMocks.findById.mockResolvedValue(doc);

    await productService.updateProduct('product-id-1', { salePrice: 150 });

    expect(doc.salePrice).toBe(150);
    expect(doc.purchasePrice).toBe(80); // untouched, not reset to any default
  });

  it('records a precise before/after audit diff limited to the fields actually changed', async () => {
    const doc = makeProductDoc({ salePrice: 120, purchasePrice: 80 });
    productMocks.findById.mockResolvedValue(doc);

    await productService.updateProduct('product-id-1', { salePrice: 150 });

    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product.update',
        entityType: 'Product',
        values: { changed: ['salePrice'], before: { salePrice: 120 }, after: { salePrice: 150 } },
      }),
    );
  });
});

describe('deleteProduct', () => {
  it('deletes unconditionally, with no check against Sale/Purchase history (matches the frontend)', async () => {
    const doc = makeProductDoc();
    productMocks.findById.mockResolvedValue(doc);

    await productService.deleteProduct('product-id-1');

    expect(productMocks.deleteOne).toHaveBeenCalledWith({ _id: 'product-id-1' });
    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'product', description: expect.stringContaining('حذف') }),
    );
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'product.delete', entityType: 'Product', entityId: doc._id }),
    );
  });

  it('throws 404 when the product does not exist', async () => {
    productMocks.findById.mockResolvedValue(null);
    await expect(productService.deleteProduct('missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(productMocks.deleteOne).not.toHaveBeenCalled();
  });
});
