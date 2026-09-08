import { describe, it, expect, vi, beforeEach } from 'vitest';

const transactionMocks = vi.hoisted(() => ({ withTransaction: vi.fn() }));
vi.mock('../../src/utils/transactions.js', () => ({
  withTransaction: (...args) => transactionMocks.withTransaction(...args),
}));

const SESSION_TOKEN = { fake: 'session' };

const saleMocks = vi.hoisted(() => ({ findById: vi.fn(), aggregate: vi.fn() }));
vi.mock('../../src/models/Sale.js', () => ({
  default: {
    findById: (...args) => saleMocks.findById(...args),
    aggregate: (...args) => saleMocks.aggregate(...args),
  },
}));

const productMocks = vi.hoisted(() => ({ updateOne: vi.fn() }));
vi.mock('../../src/models/Product.js', () => ({
  default: { updateOne: (...args) => productMocks.updateOne(...args) },
}));

const salesReturnMocks = vi.hoisted(() => ({ findOne: vi.fn(), create: vi.fn(), aggregate: vi.fn() }));
vi.mock('../../src/models/SalesReturn.js', () => ({
  default: {
    findOne: (...args) => salesReturnMocks.findOne(...args),
    create: (...args) => salesReturnMocks.create(...args),
    aggregate: (...args) => salesReturnMocks.aggregate(...args),
  },
}));

const paymentMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/CustomerPayment.js', () => ({
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

import { createSalesReturn, listSalesReturns, getReturnableForSale } from '../../src/services/salesReturn.service.js';

function aggregateResult(result) {
  const obj = {
    session: () => obj,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return obj;
}
function plainAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

const VALID_SALE_ID = '507f1f77bcf86cd799439011';

// findById(...).session(session) resolves to the sale doc (or null)
function findByIdQuery(result) {
  return { session: vi.fn(() => Promise.resolve(result)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionMocks.withTransaction.mockImplementation((fn) => fn(SESSION_TOKEN));
  salesReturnMocks.findOne.mockReturnValue({ session: vi.fn(() => Promise.resolve(null)) }); // no existing idempotent record by default
  salesReturnMocks.aggregate.mockReturnValue(aggregateResult([])); // no prior returns by default
  paymentMocks.aggregate.mockReturnValue(aggregateResult([])); // no prior payments by default
  productMocks.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  salesReturnMocks.create.mockImplementation(async (docs) => [
    { ...docs[0], _id: 'return-1', date: new Date('2026-02-01T12:00:00.000Z') },
  ]);
});

const SALE_DOC = {
  _id: 'sale-1',
  invoiceNumber: 'INV-1001',
  customerId: 'cust-1',
  items: [
    { productId: { toString: () => 'p1' }, name: 'منتج أ', code: 'A-1', price: 100, cost: 60, quantity: 5 },
    { productId: { toString: () => 'p2' }, name: 'منتج ب', code: 'B-1', price: 200, cost: 120, quantity: 2 },
  ],
};

describe('createSalesReturn — validation before touching the database', () => {
  it('rejects a missing/invalid saleId without starting a transaction', async () => {
    await expect(
      createSalesReturn({ saleId: 'not-an-id', items: [{ productId: 'p1', quantity: 1 }], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects an empty items array', async () => {
    await expect(
      createSalesReturn({ saleId: VALID_SALE_ID, items: [], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a missing idempotencyKey', async () => {
    await expect(
      createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 1 }] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });
});

describe('createSalesReturn — sale existence and eligibility', () => {
  it('rejects when the sale does not exist', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(null));
    await expect(
      createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 1 }], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a sale with no registered customer (walk-in/cash sale — no balance to adjust)', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery({ ...SALE_DOC, customerId: null }));
    await expect(
      createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 1 }], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a product that was not on this sale at all', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    await expect(
      createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'ghost', quantity: 1 }], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a zero/negative return quantity', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    await expect(
      createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 0 }], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('createSalesReturn — the 5 sold / 2 returned scenario from the spec', () => {
  it('accepts a partial return (2 of 5) and computes the correct return amount (2*100=200)', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([])); // remaining will come from sale total-paid
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }])); // customer owes the full 900

    const ret = await createSalesReturn({
      saleId: VALID_SALE_ID,
      items: [{ productId: 'p1', quantity: 2 }],
      idempotencyKey: 'k-partial',
    });

    expect(ret.items[0].returnedQuantity).toBe(2);
    expect(ret.items[0].originalUnitPrice).toBe(100);
    expect(ret.items[0].returnAmount).toBe(200);
    expect(ret.totalReturnAmount).toBe(200);
  });

  it('rejects returning more than what is still available (5 sold, 2 already returned -> max 3, requesting 4 fails)', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    salesReturnMocks.aggregate.mockReturnValue(aggregateResult([{ _id: { toString: () => 'p1' }, qty: 2 }]));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));

    await expect(
      createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 4 }], idempotencyKey: 'k-over' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(productMocks.updateOne).not.toHaveBeenCalled();
    expect(salesReturnMocks.create).not.toHaveBeenCalled();
  });

  it('accepts returning exactly what remains available (3 of the remaining 3 after 2 already returned)', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    salesReturnMocks.aggregate.mockReturnValue(aggregateResult([{ _id: { toString: () => 'p1' }, qty: 2 }]));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));

    const ret = await createSalesReturn({
      saleId: VALID_SALE_ID,
      items: [{ productId: 'p1', quantity: 3 }],
      idempotencyKey: 'k-exact',
    });
    expect(ret.items[0].returnedQuantity).toBe(3);
  });

  it('accepts a FULL return of a line (all 5 units, none returned before)', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));

    const ret = await createSalesReturn({
      saleId: VALID_SALE_ID,
      items: [{ productId: 'p1', quantity: 5 }],
      idempotencyKey: 'k-full',
    });
    expect(ret.items[0].returnedQuantity).toBe(5);
    expect(ret.totalReturnAmount).toBe(500);
  });

  it('handles two different products in a single return (Product A + Product B together)', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));

    const ret = await createSalesReturn({
      saleId: VALID_SALE_ID,
      items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }],
      idempotencyKey: 'k-two-products',
    });
    expect(ret.items).toHaveLength(2);
    expect(ret.totalReturnAmount).toBe(400); // 2*100 + 1*200
  });
});

describe('createSalesReturn — return acceptance is NEVER blocked by customer balance (bug fix)', () => {
  it('accepts a return even when the customer already paid in full (remaining = 0) — no rejection', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    // Customer already fully paid (remaining = 0) — must NOT be rejected.
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 900 }]));

    const ret = await createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 2 }], idempotencyKey: 'k-exceeds' });
    expect(ret.totalReturnAmount).toBe(200);
  });

  it('accepts a return when the customer has enough OTHER debt to absorb it, even if this specific sale was cash/fully paid', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    // Aggregate customer picture: 900 (this sale, paid) + 300 (another credit sale) = 1200 total, 900 paid -> remaining 300.
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1200, paid: 900 }]));

    const ret = await createSalesReturn({
      saleId: VALID_SALE_ID,
      items: [{ productId: 'p1', quantity: 2 }], // return worth 200, well within the 300 aggregate remaining
      idempotencyKey: 'k-absorbed',
    });
    expect(ret.totalReturnAmount).toBe(200);
  });

  it('accepts a return even when its value exceeds what the customer currently owes overall (creditOwed handles the excess, not a rejection)', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }])); // sales-side remaining = 900
    paymentMocks.aggregate.mockReturnValue(aggregateResult([{ paid: 750 }])); // customer already settled 750 -> remaining = 150

    // Returning product A (2 * 100 = 200) exceeds the true 150 remaining —
    // must still be accepted.
    const ret = await createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 2 }], idempotencyKey: 'k-cross-feature' });
    expect(ret.totalReturnAmount).toBe(200);
  });

  it('accepts a return exactly equal to the current remaining balance (boundary)', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 700 }])); // remaining = 200
    const ret = await createSalesReturn({
      saleId: VALID_SALE_ID,
      items: [{ productId: 'p1', quantity: 2 }], // exactly 200
      idempotencyKey: 'k-boundary',
    });
    expect(ret.totalReturnAmount).toBe(200);
  });
});

describe('createSalesReturn — inventory restoration', () => {
  it('restores exactly the returned quantity to stock, once, via an atomic $inc', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));

    await createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 2 }], idempotencyKey: 'k-stock' });

    expect(productMocks.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = productMocks.updateOne.mock.calls[0];
    expect(filter._id.toString()).toBe('p1');
    expect(update).toEqual({ $inc: { quantity: 2 } });
    expect(options).toEqual({ session: SESSION_TOKEN });
  });

  it('does not touch purchasePrice/weighted-average cost — only quantity', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));
    await createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 2 }], idempotencyKey: 'k-cost' });
    const [, update] = productMocks.updateOne.mock.calls[0];
    expect(update).toEqual({ $inc: { quantity: 2 } });
    expect(update.$set).toBeUndefined();
  });

  it('restores stock separately per product for a multi-product return', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));
    await createSalesReturn({
      saleId: VALID_SALE_ID,
      items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }],
      idempotencyKey: 'k-multi-stock',
    });
    expect(productMocks.updateOne).toHaveBeenCalledTimes(2);
    const [[filter1, update1], [filter2, update2]] = productMocks.updateOne.mock.calls;
    expect(filter1._id.toString()).toBe('p1');
    expect(update1).toEqual({ $inc: { quantity: 2 } });
    expect(filter2._id.toString()).toBe('p2');
    expect(update2).toEqual({ $inc: { quantity: 1 } });
  });
});

describe('createSalesReturn — the original Sale is never modified', () => {
  it('only reads the Sale (findById) — no updateOne/save/findByIdAndUpdate exists on the mock at all', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));
    await createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 2 }], idempotencyKey: 'k-immutable' });
    expect(saleMocks.findById).toHaveBeenCalled();
    // If the service ever tried Sale.updateOne(...) this test file's mock
    // (which only defines findById/aggregate) would throw "not a function".
  });
});

describe('createSalesReturn — duplicate submission / idempotency', () => {
  it('returns the ORIGINAL result on a retry with the same idempotencyKey, without touching stock or creating a new record', async () => {
    const existingReturn = { _id: 'return-existing', idempotencyKey: 'dup-key', totalReturnAmount: 200 };
    salesReturnMocks.findOne.mockReturnValue({ session: vi.fn(() => Promise.resolve(existingReturn)) });

    const result = await createSalesReturn({
      saleId: VALID_SALE_ID,
      items: [{ productId: 'p1', quantity: 2 }],
      idempotencyKey: 'dup-key',
    });

    expect(result).toBe(existingReturn);
    expect(saleMocks.findById).not.toHaveBeenCalled(); // short-circuited before even reading the sale
    expect(productMocks.updateOne).not.toHaveBeenCalled();
    expect(salesReturnMocks.create).not.toHaveBeenCalled();
  });

  it('recovers gracefully from a raced duplicate-key error at create() time (two concurrent requests, same key)', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));

    const dupErr = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    salesReturnMocks.create.mockRejectedValueOnce(dupErr);
    const racedRecord = { _id: 'return-raced', idempotencyKey: 'race-key' };
    salesReturnMocks.findOne
      .mockReturnValueOnce({ session: vi.fn(() => Promise.resolve(null)) }) // fast-path check: not found yet
      .mockReturnValueOnce({ session: vi.fn(() => Promise.resolve(racedRecord)) }); // after the race, it exists

    const result = await createSalesReturn({
      saleId: VALID_SALE_ID,
      items: [{ productId: 'p1', quantity: 2 }],
      idempotencyKey: 'race-key',
    });

    expect(result).toBe(racedRecord);
  });

  it('two DIFFERENT return actions (different idempotencyKeys) for the same product both succeed normally', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));

    salesReturnMocks.aggregate.mockReturnValueOnce(aggregateResult([])); // first return: nothing returned yet
    const first = await createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 1 }], idempotencyKey: 'key-a' });
    expect(first.items[0].returnedQuantity).toBe(1);

    salesReturnMocks.aggregate.mockReturnValueOnce(aggregateResult([{ _id: { toString: () => 'p1' }, qty: 1 }])); // second: 1 already returned
    const second = await createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 1 }], idempotencyKey: 'key-b' });
    expect(second.items[0].returnedQuantity).toBe(1);
  });
});

describe('createSalesReturn — side effects (activity + audit log)', () => {
  it('records an activity entry and an audit log entry with balanceBefore/balanceAfter', async () => {
    saleMocks.findById.mockReturnValue(findByIdQuery(SALE_DOC));
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 900, paid: 0 }]));

    await createSalesReturn({ saleId: VALID_SALE_ID, items: [{ productId: 'p1', quantity: 2 }], idempotencyKey: 'k-audit' });

    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sale' }),
      { session: SESSION_TOKEN },
    );
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sale.return.create',
        entityType: 'SalesReturn',
        values: expect.objectContaining({ totalReturnAmount: 200, balanceBefore: 900, balanceAfter: 700 }),
      }),
      { session: SESSION_TOKEN },
    );
  });
});

describe('getReturnableForSale', () => {
  it('rejects a missing/invalid saleId', async () => {
    await expect(getReturnableForSale('bad-id')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects when the sale does not exist', async () => {
    saleMocks.findById.mockResolvedValue(null);
    await expect(getReturnableForSale(VALID_SALE_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('computes availableToReturn = original - alreadyReturned per line', async () => {
    saleMocks.findById.mockResolvedValue(SALE_DOC);
    salesReturnMocks.aggregate.mockReturnValue(plainAggregate([{ _id: { toString: () => 'p1' }, qty: 2 }]));

    const result = await getReturnableForSale(VALID_SALE_ID);

    const p1 = result.items.find((i) => i.productId.toString() === 'p1');
    expect(p1.originalQuantity).toBe(5);
    expect(p1.alreadyReturnedQuantity).toBe(2);
    expect(p1.availableToReturn).toBe(3);

    const p2 = result.items.find((i) => i.productId.toString() === 'p2');
    expect(p2.originalQuantity).toBe(2);
    expect(p2.alreadyReturnedQuantity).toBe(0);
    expect(p2.availableToReturn).toBe(2);
  });

  it('never lets availableToReturn go below 0', async () => {
    saleMocks.findById.mockResolvedValue(SALE_DOC);
    // Pathological/defensive case: "already returned" somehow exceeds original.
    salesReturnMocks.aggregate.mockReturnValue(plainAggregate([{ _id: { toString: () => 'p1' }, qty: 99 }]));
    const result = await getReturnableForSale(VALID_SALE_ID);
    const p1 = result.items.find((i) => i.productId.toString() === 'p1');
    expect(p1.availableToReturn).toBe(0);
  });
});

describe('listSalesReturns', () => {
  it('requires either a customerId or a saleId', async () => {
    await expect(listSalesReturns({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it('lists returns for a customer, sorted newest first', async () => {
    salesReturnMocks.aggregate.mockReturnValue(
      plainAggregate([{ items: [{ _id: 'r1', totalReturnAmount: 200 }], totalCount: [{ count: 1 }] }]),
    );
    const result = await listSalesReturns({ customerId: VALID_SALE_ID, page: 1, limit: 20 });
    expect(result.items).toEqual([{ _id: 'r1', totalReturnAmount: 200 }]);
    const pipeline = salesReturnMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$sort).$sort).toEqual({ date: -1 });
  });
});
