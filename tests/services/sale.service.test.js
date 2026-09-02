import { describe, it, expect, vi, beforeEach } from 'vitest';

const transactionMocks = vi.hoisted(() => ({ withTransaction: vi.fn() }));
vi.mock('../../src/utils/transactions.js', () => ({
  withTransaction: (...args) => transactionMocks.withTransaction(...args),
}));

const SESSION_TOKEN = { fake: 'session' };

const productMocks = vi.hoisted(() => ({ findById: vi.fn(), updateOne: vi.fn() }));
vi.mock('../../src/models/Product.js', () => ({
  default: {
    findById: (...args) => productMocks.findById(...args),
    updateOne: (...args) => productMocks.updateOne(...args),
  },
}));

const saleMocks = vi.hoisted(() => ({ create: vi.fn(), aggregate: vi.fn(), findById: vi.fn() }));
vi.mock('../../src/models/Sale.js', () => ({
  default: {
    create: (...args) => saleMocks.create(...args),
    aggregate: (...args) => saleMocks.aggregate(...args),
    findById: (...args) => saleMocks.findById(...args),
  },
}));

const cashboxMocks = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue([{ _id: 'tx-1' }]) }));
vi.mock('../../src/models/CashboxTransaction.js', () => ({
  default: { create: (...args) => cashboxMocks.create(...args) },
}));

vi.mock('../../src/models/Customer.js', () => ({ default: { collection: { name: 'customers' } } }));

const sequenceMocks = vi.hoisted(() => ({ nextSequence: vi.fn().mockResolvedValue('INV-1001') }));
vi.mock('../../src/services/sequence.service.js', () => ({
  nextSequence: (...args) => sequenceMocks.nextSequence(...args),
}));

const activityMocks = vi.hoisted(() => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/activityLog.service.js', () => ({
  recordActivity: (...args) => activityMocks.recordActivity(...args),
}));

const auditMocks = vi.hoisted(() => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/auditLog.service.js', () => ({
  recordAuditLog: (...args) => auditMocks.recordAuditLog(...args),
}));

import { createSale } from '../../src/services/sale.service.js';

function findByIdQuery(result) {
  return { session: vi.fn(() => Promise.resolve(result)) };
}

function makeProduct(overrides = {}) {
  return {
    _id: overrides.id || 'product-1',
    name: overrides.name || 'فلتر زيت',
    code: overrides.code || 'P-1001',
    salePrice: 120,
    purchasePrice: 80,
    quantity: 10,
    ...overrides,
  };
}

let session;

beforeEach(() => {
  vi.clearAllMocks();
  session = SESSION_TOKEN;
  transactionMocks.withTransaction.mockImplementation((fn) => fn(session));
  productMocks.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  saleMocks.create.mockImplementation(async (docs) => [
    { ...docs[0], _id: 'sale-1', date: new Date('2026-01-01T00:00:00.000Z') },
  ]);
  sequenceMocks.nextSequence.mockResolvedValue('INV-1001');
});

describe('createSale — validation before touching the database', () => {
  it('rejects an empty cart without starting a transaction', async () => {
    await expect(createSale({ items: [], paymentMethod: 'cash' })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects credit payment without a customer, without starting a transaction', async () => {
    await expect(
      createSale({ items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'credit', customerId: null }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });
});

describe('createSale — per-line validation (inside the transaction)', () => {
  it('rejects when the product does not exist', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(null));
    await expect(
      createSale({ items: [{ productId: 'ghost', quantity: 1 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a zero/negative quantity with the product name in the message', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ name: 'بوجيه' })));
    await expect(
      createSale({ items: [{ productId: 'p1', quantity: 0 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('بوجيه') });
  });

  it('rejects a quantity greater than available stock', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ quantity: 3 })));
    await expect(
      createSale({ items: [{ productId: 'p1', quantity: 5 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('3') });
    expect(productMocks.updateOne).not.toHaveBeenCalled(); // never attempted the decrement
  });

  it('rejects a negative custom price', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    await expect(
      createSale({ items: [{ productId: 'p1', quantity: 1, price: -5 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('createSale — custom pricing', () => {
  it('uses the product salePrice when no custom price is given', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 120 })));
    const sale = await createSale({ items: [{ productId: 'p1', quantity: 2 }], paymentMethod: 'cash' });
    expect(sale.items[0].price).toBe(120);
    expect(sale.total).toBe(240);
  });

  it('uses a provided custom price instead, without touching the product', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 120 })));
    const sale = await createSale({ items: [{ productId: 'p1', quantity: 2, price: 99 }], paymentMethod: 'cash' });
    expect(sale.items[0].price).toBe(99);
    expect(sale.total).toBe(198);
  });

  it('treats an empty-string price as "no override", not zero', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 120 })));
    const sale = await createSale({ items: [{ productId: 'p1', quantity: 1, price: '' }], paymentMethod: 'cash' });
    expect(sale.items[0].price).toBe(120);
  });

  it('snapshots cost from the product purchasePrice at the moment of sale', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 120, purchasePrice: 80 })));
    const sale = await createSale({ items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'cash' });
    expect(sale.items[0].cost).toBe(80);
    expect(sale.profit).toBe(40);
  });
});

describe('createSale — payment amount', () => {
  it('cash payment forces paid = total regardless of any paid input', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 100 })));
    const sale = await createSale({ items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'cash', paid: 1 });
    expect(sale.paid).toBe(100);
    expect(sale.remaining).toBe(0);
  });

  it('credit payment uses the given paid amount, computing remaining', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 100 })));
    const sale = await createSale({
      items: [{ productId: 'p1', quantity: 2 }],
      paymentMethod: 'credit',
      customerId: 'cust-1',
      paid: 50,
    });
    expect(sale.total).toBe(200);
    expect(sale.paid).toBe(50);
    expect(sale.remaining).toBe(150);
  });

  it('rejects paid greater than total', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 100 })));
    await expect(
      createSale({ items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'credit', customerId: 'c1', paid: 500 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a non-numeric paid amount', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    await expect(
      createSale({ items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'credit', customerId: 'c1', paid: 'abc' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('createSale — stock and side effects', () => {
  it('decrements stock atomically with a $gte guard matching the line quantity', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ id: 'p1', quantity: 10 })));
    await createSale({ items: [{ productId: 'p1', quantity: 4 }], paymentMethod: 'cash' });
    expect(productMocks.updateOne).toHaveBeenCalledWith(
      { _id: 'p1', quantity: { $gte: 4 } },
      { $inc: { quantity: -4 } },
      { session },
    );
  });

  it('rejects with 409 when the guarded decrement finds no match (lost a stock race)', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ quantity: 10 })));
    productMocks.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
      createSale({ items: [{ productId: 'p1', quantity: 4 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('creates a cashbox "in" transaction linked to the sale when something was paid', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 100 })));
    await createSale({ items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'cash' });
    expect(cashboxMocks.create).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'in', amount: 100, refType: 'sale', refId: 'sale-1' })],
      { session },
    );
  });

  it('skips the cashbox transaction when nothing was paid (credit sale with paid=0)', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 100 })));
    await createSale({ items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'credit', customerId: 'c1', paid: 0 });
    expect(cashboxMocks.create).not.toHaveBeenCalled();
  });

  it('records an activity entry inside the same transaction session', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 100 })));
    await createSale({ items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'cash' });
    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sale' }),
      { session },
    );
  });

  it('uses an atomically generated invoice number from nextSequence, participating in the same session', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    await createSale({ items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'cash' });
    expect(sequenceMocks.nextSequence).toHaveBeenCalledWith('invoiceNumber', 'INV', session);
  });

  it('sums total/profit correctly across multiple lines', async () => {
    productMocks.findById.mockImplementation((id) => {
      if (id === 'p1') return findByIdQuery(makeProduct({ id: 'p1', salePrice: 100, purchasePrice: 60, quantity: 10 }));
      return findByIdQuery(makeProduct({ id: 'p2', salePrice: 50, purchasePrice: 30, quantity: 10 }));
    });
    const sale = await createSale({
      items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 3 }],
      paymentMethod: 'cash',
    });
    // p1: 2*100=200 revenue, 2*40=80 profit. p2: 3*50=150 revenue, 3*20=60 profit.
    expect(sale.total).toBe(350);
    expect(sale.profit).toBe(140);
  });

  it('records an audit log entry with the key financial fields, inside the same transaction session', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ salePrice: 100 })));
    await createSale({ items: [{ productId: 'p1', quantity: 2 }], paymentMethod: 'cash' });
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sale.create',
        entityType: 'Sale',
        entityId: 'sale-1',
        values: expect.objectContaining({ total: 200, paymentMethod: 'cash', itemCount: 1 }),
      }),
      { session: SESSION_TOKEN },
    );
  });
});
