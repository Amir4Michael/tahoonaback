import { describe, it, expect, vi, beforeEach } from 'vitest';

const transactionMocks = vi.hoisted(() => ({ withTransaction: vi.fn() }));
vi.mock('../../src/utils/transactions.js', () => ({
  withTransaction: (...args) => transactionMocks.withTransaction(...args),
}));

const SESSION_TOKEN = { fake: 'session' };

const purchaseMocks = vi.hoisted(() => ({ findById: vi.fn(), aggregate: vi.fn() }));
vi.mock('../../src/models/Purchase.js', () => ({
  default: {
    findById: (...args) => purchaseMocks.findById(...args),
    aggregate: (...args) => purchaseMocks.aggregate(...args),
  },
}));

const productMocks = vi.hoisted(() => ({ updateOne: vi.fn() }));
vi.mock('../../src/models/Product.js', () => ({
  default: { updateOne: (...args) => productMocks.updateOne(...args) },
}));

const purchaseReturnMocks = vi.hoisted(() => ({ findOne: vi.fn(), create: vi.fn(), aggregate: vi.fn() }));
vi.mock('../../src/models/PurchaseReturn.js', () => ({
  default: {
    findOne: (...args) => purchaseReturnMocks.findOne(...args),
    create: (...args) => purchaseReturnMocks.create(...args),
    aggregate: (...args) => purchaseReturnMocks.aggregate(...args),
  },
}));

const paymentMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/SupplierPayment.js', () => ({
  default: { aggregate: (...args) => paymentMocks.aggregate(...args) },
}));

const activityMocks = vi.hoisted(() => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/activityLog.service.js', () => ({
  recordActivity: (...args) => activityMocks.recordActivity(...args),
}));

const auditMocks = vi.hoisted(() => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/auditLog.service.js', () => ({
  recordAuditLog: (...args) => auditMocks.recordAuditLog(...args),
}));

import { createPurchaseReturn, listPurchaseReturns, getReturnableForPurchase } from '../../src/services/purchaseReturn.service.js';

function aggregateResult(result) {
  const obj = { session: () => obj, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
  return obj;
}
function plainAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

const VALID_PURCHASE_ID = '507f1f77bcf86cd799439011';

// findById(...).session(session) resolves to the purchase doc (or null)
function findByIdQuery(result) {
  return { session: vi.fn(() => Promise.resolve(result)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionMocks.withTransaction.mockImplementation((fn) => fn(SESSION_TOKEN));
  purchaseReturnMocks.findOne.mockReturnValue({ session: vi.fn(() => Promise.resolve(null)) });
  purchaseReturnMocks.aggregate.mockReturnValue(aggregateResult([]));
  paymentMocks.aggregate.mockReturnValue(aggregateResult([]));
  productMocks.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  purchaseReturnMocks.create.mockImplementation(async (docs) => [
    { ...docs[0], _id: 'return-1', date: new Date('2026-02-01T12:00:00.000Z') },
  ]);
});

const PURCHASE_DOC = {
  _id: 'purchase-1',
  purchaseNumber: 'PUR-1001',
  supplierId: 'sup-1',
  items: [
    { productId: { toString: () => 'p1' }, name: 'منتج أ', code: 'A-1', price: 100, quantity: 10 },
    { productId: { toString: () => 'p2' }, name: 'منتج ب', code: 'B-1', price: 200, quantity: 4 },
  ],
};

describe('createPurchaseReturn — validation before touching the database', () => {
  it('rejects a missing/invalid purchaseId without starting a transaction', async () => {
    await expect(
      createPurchaseReturn({ purchaseId: 'not-an-id', items: [{ productId: 'p1', quantity: 1 }], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects an empty items array', async () => {
    await expect(
      createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a missing idempotencyKey', async () => {
    await expect(
      createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 1 }] }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('createPurchaseReturn — purchase existence and eligibility', () => {
  it('rejects when the purchase does not exist', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(null));
    await expect(
      createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 1 }], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a product that was not on this purchase at all', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    await expect(
      createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'ghost', quantity: 1 }], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a zero/negative return quantity', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    await expect(
      createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 0 }], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('createPurchaseReturn — the 10 bought / 3 returned scenario from the spec', () => {
  it('accepts a partial return (3 of 10) and computes the correct return amount (3*100=300)', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }])); // we owe the full 1000

    const ret = await createPurchaseReturn({
      purchaseId: VALID_PURCHASE_ID,
      items: [{ productId: 'p1', quantity: 3 }],
      idempotencyKey: 'k-partial',
    });

    expect(ret.items[0].returnedQuantity).toBe(3);
    expect(ret.items[0].originalUnitPrice).toBe(100);
    expect(ret.items[0].returnAmount).toBe(300);
    expect(ret.totalReturnAmount).toBe(300);
  });

  it('rejects returning more than what is still available (10 bought, 3 already returned -> max 7, requesting 8 fails)', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseReturnMocks.aggregate.mockReturnValue(aggregateResult([{ _id: { toString: () => 'p1' }, qty: 3 }]));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }]));

    await expect(
      createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 8 }], idempotencyKey: 'k-over' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(productMocks.updateOne).not.toHaveBeenCalled();
    expect(purchaseReturnMocks.create).not.toHaveBeenCalled();
  });

  it('accepts a FULL return of a line (all 10 units, none returned before)', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }]));

    const ret = await createPurchaseReturn({
      purchaseId: VALID_PURCHASE_ID,
      items: [{ productId: 'p1', quantity: 10 }],
      idempotencyKey: 'k-full',
    });
    expect(ret.items[0].returnedQuantity).toBe(10);
    expect(ret.totalReturnAmount).toBe(1000);
  });

  it('handles two different products in a single return (Product A + Product B together)', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1800, paid: 0 }]));

    const ret = await createPurchaseReturn({
      purchaseId: VALID_PURCHASE_ID,
      items: [{ productId: 'p1', quantity: 3 }, { productId: 'p2', quantity: 1 }],
      idempotencyKey: 'k-two-products',
    });
    expect(ret.items).toHaveLength(2);
    expect(ret.totalReturnAmount).toBe(500); // 3*100 + 1*200
  });

  it('handles multiple separate returns of the same product over time, each aware of the prior one', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }]));

    purchaseReturnMocks.aggregate.mockReturnValueOnce(aggregateResult([]));
    const first = await createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 3 }], idempotencyKey: 'k-a' });
    expect(first.items[0].returnedQuantity).toBe(3);

    purchaseReturnMocks.aggregate.mockReturnValueOnce(aggregateResult([{ _id: { toString: () => 'p1' }, qty: 3 }]));
    const second = await createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 4 }], idempotencyKey: 'k-b' });
    expect(second.items[0].returnedQuantity).toBe(4);
  });
});

describe('createPurchaseReturn — rejecting refund/credit-balance scenarios (no such concept in this system)', () => {
  it('rejects a return whose value exceeds what we currently owe the supplier', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    // We already paid the supplier in full (remaining = 0) -> any return needs a refund/credit, unsupported.
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 1000 }]));

    await expect(
      createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 3 }], idempotencyKey: 'k-exceeds' }),
    ).rejects.toMatchObject({ statusCode: 400, details: expect.objectContaining({ code: 'EXCEEDS_REMAINING' }) });
    expect(productMocks.updateOne).not.toHaveBeenCalled();
    expect(purchaseReturnMocks.create).not.toHaveBeenCalled();
  });

  it('accepts a return exactly equal to what we currently owe the supplier (boundary)', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 700 }])); // remaining = 300
    const ret = await createPurchaseReturn({
      purchaseId: VALID_PURCHASE_ID,
      items: [{ productId: 'p1', quantity: 3 }], // exactly 300
      idempotencyKey: 'k-boundary',
    });
    expect(ret.totalReturnAmount).toBe(300);
  });
});

describe('createPurchaseReturn — stock DECREASES (opposite direction from a sales return)', () => {
  it('decrements exactly the returned quantity from stock, once, via an atomic guarded $inc', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }]));

    await createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 3 }], idempotencyKey: 'k-stock' });

    expect(productMocks.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = productMocks.updateOne.mock.calls[0];
    expect(filter._id.toString()).toBe('p1');
    expect(filter.quantity).toEqual({ $gte: 3 });
    expect(update).toEqual({ $inc: { quantity: -3 } });
    expect(options).toEqual({ session: SESSION_TOKEN });
  });

  it('rejects the return with a 409 (not 400) when there is not enough PHYSICAL stock to send back, even if the invoice would allow it', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }]));
    // 10 bought, but only 2 left in stock (8 already sold) — the invoice
    // alone would allow returning up to 10, but physical stock won't.
    productMocks.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    await expect(
      createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 3 }], idempotencyKey: 'k-insufficient-stock' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(purchaseReturnMocks.create).not.toHaveBeenCalled();
  });

  it('does not touch purchasePrice/weighted-average cost — only quantity', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }]));
    await createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 3 }], idempotencyKey: 'k-cost' });
    const [, update] = productMocks.updateOne.mock.calls[0];
    expect(update).toEqual({ $inc: { quantity: -3 } });
    expect(update.$set).toBeUndefined();
  });

  it('decrements stock separately per product for a multi-product return', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1800, paid: 0 }]));
    await createPurchaseReturn({
      purchaseId: VALID_PURCHASE_ID,
      items: [{ productId: 'p1', quantity: 3 }, { productId: 'p2', quantity: 1 }],
      idempotencyKey: 'k-multi-stock',
    });
    expect(productMocks.updateOne).toHaveBeenCalledTimes(2);
    const [[filter1, update1], [filter2, update2]] = productMocks.updateOne.mock.calls;
    expect(filter1._id.toString()).toBe('p1');
    expect(update1).toEqual({ $inc: { quantity: -3 } });
    expect(filter2._id.toString()).toBe('p2');
    expect(update2).toEqual({ $inc: { quantity: -1 } });
  });
});

describe('createPurchaseReturn — the original Purchase is never modified', () => {
  it('only reads the Purchase (findById) — no updateOne/save/findByIdAndUpdate exists on the mock at all', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }]));
    await createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 3 }], idempotencyKey: 'k-immutable' });
    expect(purchaseMocks.findById).toHaveBeenCalled();
  });
});

describe('createPurchaseReturn — duplicate submission / idempotency', () => {
  it('returns the ORIGINAL result on a retry with the same idempotencyKey, without touching stock or creating a new record', async () => {
    const existingReturn = { _id: 'return-existing', idempotencyKey: 'dup-key', totalReturnAmount: 300 };
    purchaseReturnMocks.findOne.mockReturnValue({ session: vi.fn(() => Promise.resolve(existingReturn)) });

    const result = await createPurchaseReturn({
      purchaseId: VALID_PURCHASE_ID,
      items: [{ productId: 'p1', quantity: 3 }],
      idempotencyKey: 'dup-key',
    });

    expect(result).toBe(existingReturn);
    expect(purchaseMocks.findById).not.toHaveBeenCalled();
    expect(productMocks.updateOne).not.toHaveBeenCalled();
    expect(purchaseReturnMocks.create).not.toHaveBeenCalled();
  });

  it('recovers gracefully from a raced duplicate-key error at create() time (two concurrent requests, same key)', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }]));

    const dupErr = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    purchaseReturnMocks.create.mockRejectedValueOnce(dupErr);
    const racedRecord = { _id: 'return-raced', idempotencyKey: 'race-key' };
    purchaseReturnMocks.findOne
      .mockReturnValueOnce({ session: vi.fn(() => Promise.resolve(null)) })
      .mockReturnValueOnce({ session: vi.fn(() => Promise.resolve(racedRecord)) });

    const result = await createPurchaseReturn({
      purchaseId: VALID_PURCHASE_ID,
      items: [{ productId: 'p1', quantity: 3 }],
      idempotencyKey: 'race-key',
    });

    expect(result).toBe(racedRecord);
  });
});

describe('createPurchaseReturn — side effects (activity + audit log)', () => {
  it('records an activity entry and an audit log entry with balanceBefore/balanceAfter', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }]));

    await createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 3 }], idempotencyKey: 'k-audit' });

    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'purchase' }),
      { session: SESSION_TOKEN },
    );
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'purchase.return.create',
        entityType: 'PurchaseReturn',
        values: expect.objectContaining({ totalReturnAmount: 300, balanceBefore: 1000, balanceAfter: 700 }),
      }),
      { session: SESSION_TOKEN },
    );
  });

  it('does NOT create any cashbox transaction — a return is a debt adjustment, not a cash movement by itself', async () => {
    purchaseMocks.findById.mockReturnValue(findByIdQuery(PURCHASE_DOC));
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 0 }]));
    await createPurchaseReturn({ purchaseId: VALID_PURCHASE_ID, items: [{ productId: 'p1', quantity: 3 }], idempotencyKey: 'k-no-cashbox' });
    // No CashboxTransaction model is even mocked/imported in this service —
    // if it tried to use one, the module import itself would fail.
    expect(purchaseReturnMocks.create).toHaveBeenCalled();
  });
});

describe('getReturnableForPurchase', () => {
  it('rejects a missing/invalid purchaseId', async () => {
    await expect(getReturnableForPurchase('bad-id')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects when the purchase does not exist', async () => {
    purchaseMocks.findById.mockResolvedValue(null);
    await expect(getReturnableForPurchase(VALID_PURCHASE_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('computes availableToReturn = original - alreadyReturned per line', async () => {
    purchaseMocks.findById.mockResolvedValue(PURCHASE_DOC);
    purchaseReturnMocks.aggregate.mockReturnValue(plainAggregate([{ _id: { toString: () => 'p1' }, qty: 3 }]));

    const result = await getReturnableForPurchase(VALID_PURCHASE_ID);

    const p1 = result.items.find((i) => i.productId.toString() === 'p1');
    expect(p1.originalQuantity).toBe(10);
    expect(p1.alreadyReturnedQuantity).toBe(3);
    expect(p1.availableToReturn).toBe(7);

    const p2 = result.items.find((i) => i.productId.toString() === 'p2');
    expect(p2.originalQuantity).toBe(4);
    expect(p2.alreadyReturnedQuantity).toBe(0);
    expect(p2.availableToReturn).toBe(4);
  });

  it('never lets availableToReturn go below 0', async () => {
    purchaseMocks.findById.mockResolvedValue(PURCHASE_DOC);
    purchaseReturnMocks.aggregate.mockReturnValue(plainAggregate([{ _id: { toString: () => 'p1' }, qty: 99 }]));
    const result = await getReturnableForPurchase(VALID_PURCHASE_ID);
    const p1 = result.items.find((i) => i.productId.toString() === 'p1');
    expect(p1.availableToReturn).toBe(0);
  });
});

describe('listPurchaseReturns', () => {
  it('requires either a supplierId or a purchaseId', async () => {
    await expect(listPurchaseReturns({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it('lists returns for a supplier, sorted newest first', async () => {
    purchaseReturnMocks.aggregate.mockReturnValue(
      plainAggregate([{ items: [{ _id: 'r1', totalReturnAmount: 300 }], totalCount: [{ count: 1 }] }]),
    );
    const result = await listPurchaseReturns({ supplierId: VALID_PURCHASE_ID, page: 1, limit: 20 });
    expect(result.items).toEqual([{ _id: 'r1', totalReturnAmount: 300 }]);
    const pipeline = purchaseReturnMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$sort).$sort).toEqual({ date: -1 });
  });
});
