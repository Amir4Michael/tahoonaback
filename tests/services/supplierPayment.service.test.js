import { describe, it, expect, vi, beforeEach } from 'vitest';

const transactionMocks = vi.hoisted(() => ({ withTransaction: vi.fn() }));
vi.mock('../../src/utils/transactions.js', () => ({
  withTransaction: (...args) => transactionMocks.withTransaction(...args),
}));

const SESSION_TOKEN = { fake: 'session' };

const supplierMocks = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../src/models/Supplier.js', () => ({
  default: { findById: (...args) => supplierMocks.findById(...args) },
}));

const purchaseMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Purchase.js', () => ({
  default: { aggregate: (...args) => purchaseMocks.aggregate(...args) },
}));

const paymentMocks = vi.hoisted(() => ({ create: vi.fn(), aggregate: vi.fn(), findOne: vi.fn() }));
vi.mock('../../src/models/SupplierPayment.js', () => ({
  default: {
    create: (...args) => paymentMocks.create(...args),
    aggregate: (...args) => paymentMocks.aggregate(...args),
    findOne: (...args) => paymentMocks.findOne(...args),
  },
}));

const purchaseReturnMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/PurchaseReturn.js', () => ({
  default: { aggregate: (...args) => purchaseReturnMocks.aggregate(...args) },
}));

const cashboxMocks = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue([{ _id: 'tx-1' }]) }));
vi.mock('../../src/models/CashboxTransaction.js', () => ({
  default: { create: (...args) => cashboxMocks.create(...args) },
}));

const activityMocks = vi.hoisted(() => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/activityLog.service.js', () => ({
  recordActivity: (...args) => activityMocks.recordActivity(...args),
}));

const auditMocks = vi.hoisted(() => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/auditLog.service.js', () => ({
  recordAuditLog: (...args) => auditMocks.recordAuditLog(...args),
}));

import { createSupplierPayment, listSupplierPayments } from '../../src/services/supplierPayment.service.js';

function aggregateResult(result) {
  const obj = { session: () => obj, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
  return obj;
}

function makeSupplier(overrides = {}) {
  return { _id: overrides.id || 'sup-1', name: overrides.name || 'شركة التوريد الحديثة', ...overrides };
}

const VALID_ID = '507f1f77bcf86cd799439011';

beforeEach(() => {
  vi.clearAllMocks();
  transactionMocks.withTransaction.mockImplementation((fn) => fn(SESSION_TOKEN));
  paymentMocks.create.mockImplementation(async (docs) => [
    { ...docs[0], _id: 'payment-1', date: new Date('2026-01-15T10:00:00.000Z') },
  ]);
  paymentMocks.findOne.mockReturnValue({ session: vi.fn(() => Promise.resolve(null)) });
  purchaseReturnMocks.aggregate.mockReturnValue(aggregateResult([]));
});

describe('createSupplierPayment — validation before touching the database', () => {
  it('rejects a missing/invalid supplierId without starting a transaction', async () => {
    await expect(createSupplierPayment({ supplierId: 'not-an-id', amount: 100 })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects an amount of exactly 0', async () => {
    await expect(createSupplierPayment({ supplierId: VALID_ID, amount: 0 })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a negative amount', async () => {
    await expect(createSupplierPayment({ supplierId: VALID_ID, amount: -50 })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric amount', async () => {
    await expect(createSupplierPayment({ supplierId: VALID_ID, amount: 'abc' })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });
});

describe('createSupplierPayment — supplier existence', () => {
  it('rejects when the supplier does not exist', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(null) });
    await expect(createSupplierPayment({ supplierId: VALID_ID, amount: 100 })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('createSupplierPayment — the 5000/3000/2000 then 1000 scenario from the spec', () => {
  it('records a partial payment and computes the new balance correctly (2000 - 1000 = 1000)', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 3000 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([])); // no prior payments yet

    const payment = await createSupplierPayment({ supplierId: VALID_ID, amount: 1000 });

    expect(payment.amount).toBe(1000);
    expect(payment.balanceAfter).toBe(1000);
    expect(payment.supplierId).toBe('sup-1');
  });

  it('accepts a full payment that brings the balance exactly to 0', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 3000 }])); // remaining = 2000
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    const payment = await createSupplierPayment({ supplierId: VALID_ID, amount: 2000 });
    expect(payment.balanceAfter).toBe(0);
  });

  it('accounts for prior payments already on file when computing the current remaining balance', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 3000 }])); // 2000
    paymentMocks.aggregate.mockReturnValue(aggregateResult([{ paid: 1000 }])); // already paid 1000 -> 1000

    const payment = await createSupplierPayment({ supplierId: VALID_ID, amount: 500 });
    expect(payment.balanceAfter).toBe(500); // 1000 - 500
  });

  it('also accounts for a prior purchase return when computing the current remaining balance', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 3000 }])); // 2000
    purchaseReturnMocks.aggregate.mockReturnValue(aggregateResult([{ returned: 500 }])); // -> 1500
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    const payment = await createSupplierPayment({ supplierId: VALID_ID, amount: 1000 });
    expect(payment.balanceAfter).toBe(500); // 1500 - 1000
  });
});

describe('createSupplierPayment — rejecting overpayment (no credit-balance concept in this system)', () => {
  it('rejects a payment greater than the current remaining balance', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 3000 }])); // remaining = 2000
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await expect(
      createSupplierPayment({ supplierId: VALID_ID, amount: 2500 }),
    ).rejects.toMatchObject({ statusCode: 400, details: expect.objectContaining({ code: 'EXCEEDS_REMAINING' }) });
    expect(paymentMocks.create).not.toHaveBeenCalled();
    expect(cashboxMocks.create).not.toHaveBeenCalled();
  });

  it('rejects any payment at all when we already owe this supplier nothing', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 5000 }])); // remaining = 0
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await expect(
      createSupplierPayment({ supplierId: VALID_ID, amount: 1 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts a payment exactly equal to the remaining balance (boundary)', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 3000 }])); // remaining = 2000
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    const payment = await createSupplierPayment({ supplierId: VALID_ID, amount: 2000 });
    expect(payment.balanceAfter).toBe(0);
  });
});

describe('createSupplierPayment — side effects', () => {
  it('creates a cashbox "out" transaction linked to the payment (cash leaving the register, unlike a customer payment)', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier({ name: 'مؤسسة النور' })) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 0 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await createSupplierPayment({ supplierId: VALID_ID, amount: 1000 });

    expect(cashboxMocks.create).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'out', amount: 1000, refType: 'supplier_payment', refId: 'payment-1' })],
      { session: SESSION_TOKEN },
    );
  });

  it('records an activity entry and an audit log entry with balanceBefore/balanceAfter', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 3000 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await createSupplierPayment({ supplierId: VALID_ID, amount: 1000 });

    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'supplier' }),
      { session: SESSION_TOKEN },
    );
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'supplier.payment.create',
        entityType: 'SupplierPayment',
        values: expect.objectContaining({ amount: 1000, balanceBefore: 2000, balanceAfter: 1000 }),
      }),
      { session: SESSION_TOKEN },
    );
  });

  it('never modifies the original Purchase documents — only reads them via aggregate', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 3000 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await createSupplierPayment({ supplierId: VALID_ID, amount: 1000 });
    expect(purchaseMocks.aggregate).toHaveBeenCalled();
  });

  it('supports more than one payment for the same supplier, each reducing the balance further', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 3000 }])); // remaining = 2000

    paymentMocks.aggregate.mockReturnValueOnce(aggregateResult([]));
    const first = await createSupplierPayment({ supplierId: VALID_ID, amount: 1000 });
    expect(first.balanceAfter).toBe(1000);

    paymentMocks.aggregate.mockReturnValueOnce(aggregateResult([{ paid: 1000 }]));
    const second = await createSupplierPayment({ supplierId: VALID_ID, amount: 1000 });
    expect(second.balanceAfter).toBe(0);
  });
});

describe('createSupplierPayment — duplicate submission / idempotency (added during the full regression audit)', () => {
  it('returns the ORIGINAL result on a retry with the same idempotencyKey, without creating a second payment or cashbox entry', async () => {
    const existingPayment = { _id: 'payment-existing', idempotencyKey: 'dup-key', amount: 1000, balanceAfter: 1000 };
    paymentMocks.findOne.mockReturnValue({ session: vi.fn(() => Promise.resolve(existingPayment)) });

    const result = await createSupplierPayment({ supplierId: VALID_ID, amount: 1000, idempotencyKey: 'dup-key' });

    expect(result).toBe(existingPayment);
    expect(supplierMocks.findById).not.toHaveBeenCalled();
    expect(paymentMocks.create).not.toHaveBeenCalled();
    expect(cashboxMocks.create).not.toHaveBeenCalled();
  });

  it('recovers gracefully from a raced duplicate-key error at create() time', async () => {
    supplierMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeSupplier()) });
    purchaseMocks.aggregate.mockReturnValue(aggregateResult([{ total: 5000, paid: 3000 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    const dupErr = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    paymentMocks.create.mockRejectedValueOnce(dupErr);
    const racedRecord = { _id: 'payment-raced', idempotencyKey: 'race-key' };
    paymentMocks.findOne
      .mockReturnValueOnce({ session: vi.fn(() => Promise.resolve(null)) })
      .mockReturnValueOnce({ session: vi.fn(() => Promise.resolve(racedRecord)) });

    const result = await createSupplierPayment({ supplierId: VALID_ID, amount: 1000, idempotencyKey: 'race-key' });
    expect(result).toBe(racedRecord);
  });
});

describe('listSupplierPayments', () => {
  it('rejects a missing/invalid supplierId', async () => {
    await expect(listSupplierPayments({ supplierId: 'bad-id' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns paginated payments sorted newest first for the given supplier', async () => {
    paymentMocks.aggregate.mockReturnValue(
      Promise.resolve([{ items: [{ _id: 'p1', amount: 1000 }], totalCount: [{ count: 1 }] }]),
    );
    const result = await listSupplierPayments({ supplierId: VALID_ID, page: 1, limit: 20 });
    expect(result.items).toEqual([{ _id: 'p1', amount: 1000 }]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });

    const pipeline = paymentMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match).toHaveProperty('supplierId');
    const sortStage = pipeline.find((s) => s.$sort);
    expect(sortStage.$sort).toEqual({ date: -1 });
  });
});
