import { describe, it, expect, vi, beforeEach } from 'vitest';

const transactionMocks = vi.hoisted(() => ({ withTransaction: vi.fn() }));
vi.mock('../../src/utils/transactions.js', () => ({
  withTransaction: (...args) => transactionMocks.withTransaction(...args),
}));

const SESSION_TOKEN = { fake: 'session' };

const customerMocks = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../src/models/Customer.js', () => ({
  default: { findById: (...args) => customerMocks.findById(...args) },
}));

const saleMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Sale.js', () => ({
  default: { aggregate: (...args) => saleMocks.aggregate(...args) },
}));

const paymentMocks = vi.hoisted(() => ({ create: vi.fn(), aggregate: vi.fn(), findOne: vi.fn() }));
vi.mock('../../src/models/CustomerPayment.js', () => ({
  default: {
    create: (...args) => paymentMocks.create(...args),
    aggregate: (...args) => paymentMocks.aggregate(...args),
    findOne: (...args) => paymentMocks.findOne(...args),
  },
}));

const salesReturnMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/SalesReturn.js', () => ({
  default: { aggregate: (...args) => salesReturnMocks.aggregate(...args) },
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

import { createCustomerPayment, listCustomerPayments } from '../../src/services/customerPayment.service.js';

function aggregateResult(result) {
  return { session: () => ({ then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }) };
}

function makeCustomer(overrides = {}) {
  return { _id: overrides.id || 'cust-1', name: overrides.name || 'أحمد محمد', ...overrides };
}

const VALID_ID = '507f1f77bcf86cd799439011';

beforeEach(() => {
  vi.clearAllMocks();
  transactionMocks.withTransaction.mockImplementation((fn) => fn(SESSION_TOKEN));
  paymentMocks.create.mockImplementation(async (docs) => [
    { ...docs[0], _id: 'payment-1', date: new Date('2026-01-15T10:00:00.000Z') },
  ]);
  paymentMocks.findOne.mockReturnValue({ session: vi.fn(() => Promise.resolve(null)) });
  // Default: no prior returns on file — individual tests override this when
  // they specifically care about returns interacting with payments.
  salesReturnMocks.aggregate.mockReturnValue(aggregateResult([]));
});

describe('createCustomerPayment — validation before touching the database', () => {
  it('rejects a missing/invalid customerId without starting a transaction', async () => {
    await expect(createCustomerPayment({ customerId: 'not-an-id', amount: 100 })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects an amount of exactly 0', async () => {
    await expect(createCustomerPayment({ customerId: VALID_ID, amount: 0 })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a negative amount', async () => {
    await expect(createCustomerPayment({ customerId: VALID_ID, amount: -50 })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric amount', async () => {
    await expect(createCustomerPayment({ customerId: VALID_ID, amount: 'abc' })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });
});

describe('createCustomerPayment — customer existence', () => {
  it('rejects when the customer does not exist', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(null) });
    await expect(createCustomerPayment({ customerId: VALID_ID, amount: 100 })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('createCustomerPayment — the 1000/600/400 then 250 scenario from the spec', () => {
  it('records a partial payment and computes the new balance correctly (400 - 250 = 150)', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([])); // no prior payments yet

    const payment = await createCustomerPayment({ customerId: VALID_ID, amount: 250 });

    expect(payment.amount).toBe(250);
    expect(payment.balanceAfter).toBe(150);
    expect(payment.customerId).toBe('cust-1');
  });

  it('accepts a full payment that brings the balance exactly to 0', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([])); // remaining = 400

    const payment = await createCustomerPayment({ customerId: VALID_ID, amount: 400 });

    expect(payment.balanceAfter).toBe(0);
  });

  it('accounts for prior payments already on file when computing the current remaining balance', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }])); // sales-side remaining = 400
    paymentMocks.aggregate.mockReturnValue(aggregateResult([{ paid: 250 }])); // already paid 250 -> remaining = 150

    const payment = await createCustomerPayment({ customerId: VALID_ID, amount: 100 });

    expect(payment.balanceAfter).toBe(50); // 150 - 100
  });

  it('also accounts for a prior sales return when computing the current remaining balance', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }])); // remaining before return = 400
    salesReturnMocks.aggregate.mockReturnValue(aggregateResult([{ returned: 200 }])); // a return already reduced it by 200 -> 200
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    const payment = await createCustomerPayment({ customerId: VALID_ID, amount: 150 });

    expect(payment.balanceAfter).toBe(50); // 200 - 150
  });
});

describe('createCustomerPayment — rejecting overpayment (no credit-balance concept in this system)', () => {
  it('rejects a payment greater than the current remaining balance', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }])); // remaining = 400
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await expect(
      createCustomerPayment({ customerId: VALID_ID, amount: 500 }),
    ).rejects.toMatchObject({ statusCode: 400, details: expect.objectContaining({ code: 'EXCEEDS_REMAINING' }) });
    expect(paymentMocks.create).not.toHaveBeenCalled();
    expect(cashboxMocks.create).not.toHaveBeenCalled();
  });

  it('rejects any payment at all when the customer already owes nothing', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 1000 }])); // remaining = 0
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await expect(
      createCustomerPayment({ customerId: VALID_ID, amount: 1 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts a payment exactly equal to the remaining balance (boundary, not "greater than")', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }])); // remaining = 400
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    const payment = await createCustomerPayment({ customerId: VALID_ID, amount: 400 });
    expect(payment.balanceAfter).toBe(0);
  });
});

describe('createCustomerPayment — side effects', () => {
  it('creates a cashbox "in" transaction linked to the payment', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer({ name: 'سارة علي' })) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 500, paid: 0 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await createCustomerPayment({ customerId: VALID_ID, amount: 200 });

    expect(cashboxMocks.create).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'in', amount: 200, refType: 'customer_payment', refId: 'payment-1' })],
      { session: SESSION_TOKEN },
    );
  });

  it('records an activity entry and an audit log entry with balanceBefore/balanceAfter', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await createCustomerPayment({ customerId: VALID_ID, amount: 250 });

    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'customer' }),
      { session: SESSION_TOKEN },
    );
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'customer.payment.create',
        entityType: 'CustomerPayment',
        values: expect.objectContaining({ amount: 250, balanceBefore: 400, balanceAfter: 150 }),
      }),
      { session: SESSION_TOKEN },
    );
  });

  it('never modifies the original Sale documents — only reads them via aggregate', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await createCustomerPayment({ customerId: VALID_ID, amount: 250 });

    // Sale is only ever touched through `.aggregate` in this service — no
    // updateOne/save/findByIdAndUpdate exists on the mock at all, so any
    // attempt to mutate a Sale would throw "is not a function".
    expect(saleMocks.aggregate).toHaveBeenCalled();
  });

  it('supports more than one payment for the same customer, each reducing the balance further', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }])); // remaining = 400

    paymentMocks.aggregate.mockReturnValueOnce(aggregateResult([])); // first payment: no prior payments
    const first = await createCustomerPayment({ customerId: VALID_ID, amount: 250 });
    expect(first.balanceAfter).toBe(150);

    paymentMocks.aggregate.mockReturnValueOnce(aggregateResult([{ paid: 250 }])); // second payment: 250 already paid
    const second = await createCustomerPayment({ customerId: VALID_ID, amount: 150 });
    expect(second.balanceAfter).toBe(0);
  });
});

describe('createCustomerPayment — duplicate submission / idempotency (added during the full regression audit)', () => {
  it('has no idempotency protection at all when no key is sent (backward compatible)', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    await createCustomerPayment({ customerId: VALID_ID, amount: 250 });
    expect(paymentMocks.findOne).not.toHaveBeenCalled();
  });

  it('returns the ORIGINAL result on a retry with the same idempotencyKey, without creating a second payment or cashbox entry', async () => {
    const existingPayment = { _id: 'payment-existing', idempotencyKey: 'dup-key', amount: 250, balanceAfter: 150 };
    paymentMocks.findOne.mockReturnValue({ session: vi.fn(() => Promise.resolve(existingPayment)) });

    const result = await createCustomerPayment({ customerId: VALID_ID, amount: 250, idempotencyKey: 'dup-key' });

    expect(result).toBe(existingPayment);
    expect(customerMocks.findById).not.toHaveBeenCalled(); // short-circuited before even reading the customer
    expect(paymentMocks.create).not.toHaveBeenCalled();
    expect(cashboxMocks.create).not.toHaveBeenCalled();
  });

  it('recovers gracefully from a raced duplicate-key error at create() time (two concurrent requests, same key)', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }]));
    paymentMocks.aggregate.mockReturnValue(aggregateResult([]));

    const dupErr = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    paymentMocks.create.mockRejectedValueOnce(dupErr);
    const racedRecord = { _id: 'payment-raced', idempotencyKey: 'race-key' };
    paymentMocks.findOne
      .mockReturnValueOnce({ session: vi.fn(() => Promise.resolve(null)) })
      .mockReturnValueOnce({ session: vi.fn(() => Promise.resolve(racedRecord)) });

    const result = await createCustomerPayment({ customerId: VALID_ID, amount: 250, idempotencyKey: 'race-key' });
    expect(result).toBe(racedRecord);
  });

  it('two DIFFERENT payments (different idempotencyKeys) both succeed normally', async () => {
    customerMocks.findById.mockReturnValue({ session: () => Promise.resolve(makeCustomer()) });
    saleMocks.aggregate.mockReturnValue(aggregateResult([{ total: 1000, paid: 600 }])); // remaining = 400

    paymentMocks.aggregate.mockReturnValueOnce(aggregateResult([]));
    const first = await createCustomerPayment({ customerId: VALID_ID, amount: 100, idempotencyKey: 'key-a' });
    expect(first.balanceAfter).toBe(300);

    paymentMocks.aggregate.mockReturnValueOnce(aggregateResult([{ paid: 100 }]));
    const second = await createCustomerPayment({ customerId: VALID_ID, amount: 100, idempotencyKey: 'key-b' });
    expect(second.balanceAfter).toBe(200);
  });
});

describe('listCustomerPayments', () => {
  it('rejects a missing/invalid customerId', async () => {
    await expect(listCustomerPayments({ customerId: 'bad-id' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns paginated payments sorted newest first for the given customer', async () => {
    paymentMocks.aggregate.mockReturnValue(
      Promise.resolve([{ items: [{ _id: 'p1', amount: 250 }], totalCount: [{ count: 1 }] }]),
    );
    const result = await listCustomerPayments({ customerId: VALID_ID, page: 1, limit: 20 });
    expect(result.items).toEqual([{ _id: 'p1', amount: 250 }]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });

    const pipeline = paymentMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match).toHaveProperty('customerId');
    const sortStage = pipeline.find((s) => s.$sort);
    expect(sortStage.$sort).toEqual({ date: -1 });
  });
});
