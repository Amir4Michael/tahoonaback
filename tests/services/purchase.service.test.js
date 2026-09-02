import { describe, it, expect, vi, beforeEach } from 'vitest';

const transactionMocks = vi.hoisted(() => ({ withTransaction: vi.fn() }));
vi.mock('../../src/utils/transactions.js', () => ({
  withTransaction: (...args) => transactionMocks.withTransaction(...args),
}));

const productMocks = vi.hoisted(() => ({ findById: vi.fn(), updateOne: vi.fn() }));
vi.mock('../../src/models/Product.js', () => ({
  default: {
    findById: (...args) => productMocks.findById(...args),
    updateOne: (...args) => productMocks.updateOne(...args),
  },
}));

const purchaseMocks = vi.hoisted(() => ({ create: vi.fn(), aggregate: vi.fn(), findById: vi.fn() }));
vi.mock('../../src/models/Purchase.js', () => ({
  default: {
    create: (...args) => purchaseMocks.create(...args),
    aggregate: (...args) => purchaseMocks.aggregate(...args),
    findById: (...args) => purchaseMocks.findById(...args),
  },
}));

const cashboxMocks = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue([{ _id: 'tx-1' }]) }));
vi.mock('../../src/models/CashboxTransaction.js', () => ({
  default: { create: (...args) => cashboxMocks.create(...args) },
}));

vi.mock('../../src/models/Supplier.js', () => ({ default: { collection: { name: 'suppliers' } } }));

const sequenceMocks = vi.hoisted(() => ({ nextSequence: vi.fn().mockResolvedValue('PUR-1001') }));
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

import { createPurchase } from '../../src/services/purchase.service.js';

const SESSION_TOKEN = { fake: 'session' };

function findByIdQuery(result) {
  return { session: vi.fn(() => Promise.resolve(result)) };
}

function makeProduct(overrides = {}) {
  return {
    _id: overrides.id || 'product-1',
    name: overrides.name || 'فلتر زيت',
    code: overrides.code || 'P-1001',
    quantity: 6,
    purchasePrice: 10,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionMocks.withTransaction.mockImplementation((fn) => fn(SESSION_TOKEN));
  productMocks.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  purchaseMocks.create.mockImplementation(async (docs) => [
    { ...docs[0], _id: 'purchase-1' },
  ]);
  sequenceMocks.nextSequence.mockResolvedValue('PUR-1001');
});

describe('createPurchase — validation before touching the database', () => {
  it('rejects a missing supplier without starting a transaction', async () => {
    await expect(
      createPurchase({ items: [{ productId: 'p1', quantity: 1, price: 10 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects an empty items array without starting a transaction', async () => {
    await expect(
      createPurchase({ supplierId: 's1', items: [], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });
});

describe('createPurchase — per-line validation', () => {
  it('rejects when the product does not exist', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(null));
    await expect(
      createPurchase({ supplierId: 's1', items: [{ productId: 'ghost', quantity: 1, price: 10 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a zero/negative quantity with the product name in the message', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ name: 'بوجيه' })));
    await expect(
      createPurchase({ supplierId: 's1', items: [{ productId: 'p1', quantity: 0, price: 10 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('بوجيه') });
  });

  it('rejects a negative price with the product name in the message', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ name: 'بوجيه' })));
    await expect(
      createPurchase({ supplierId: 's1', items: [{ productId: 'p1', quantity: 1, price: -5 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('بوجيه') });
  });

  it('has no upper-bound quantity check (unlike sales — purchases add stock, no "available" ceiling)', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ quantity: 2 })));
    const purchase = await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 10000, price: 5 }],
      paymentMethod: 'cash',
    });
    expect(purchase.items[0].quantity).toBe(10000);
  });
});

describe('createPurchase — payment amount', () => {
  it('cash payment forces paid = total regardless of any paid input', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    const purchase = await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 2, price: 15 }],
      paymentMethod: 'cash',
      paid: 1,
    });
    expect(purchase.total).toBe(30);
    expect(purchase.paid).toBe(30);
    expect(purchase.remaining).toBe(0);
  });

  it('credit payment uses the given paid amount, computing remaining', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    const purchase = await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 2, price: 15 }],
      paymentMethod: 'credit',
      paid: 10,
    });
    expect(purchase.total).toBe(30);
    expect(purchase.paid).toBe(10);
    expect(purchase.remaining).toBe(20);
  });

  it('rejects paid greater than total', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    await expect(
      createPurchase({
        supplierId: 's1',
        items: [{ productId: 'p1', quantity: 1, price: 10 }],
        paymentMethod: 'credit',
        paid: 500,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('createPurchase — weighted-average cost update', () => {
  it('sends an atomic aggregation-pipeline update computing the weighted average from the current document state', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct({ id: 'p1' })));
    await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 6, price: 15 }],
      paymentMethod: 'cash',
    });

    expect(productMocks.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = productMocks.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'p1' });
    expect(Array.isArray(update)).toBe(true); // pipeline-style update, not a plain $set object
    expect(options).toEqual({ session: SESSION_TOKEN });

    const setStage = update[0].$set;
    expect(setStage.quantity).toEqual({ $add: ['$quantity', 6] });
    // Formula uses $quantity/$purchasePrice (the doc's CURRENT values at
    // write time) and this line's price*quantity — matches
    // (oldQty*oldCost + newQty*newCost) / (oldQty+newQty).
    expect(setStage.purchasePrice.$let.in.$cond[1].$round[0].$divide[0]).toEqual({
      $add: [{ $multiply: ['$quantity', '$purchasePrice'] }, 90], // 6 * 15
    });
  });

  it('rejects with 404 when the pipeline update matches no document (product deleted mid-transaction)', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    productMocks.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
      createPurchase({ supplierId: 's1', items: [{ productId: 'p1', quantity: 6, price: 15 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('calls the pipeline update once per line for multiple products', async () => {
    productMocks.findById.mockImplementation((id) => findByIdQuery(makeProduct({ id })));
    await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 2, price: 10 }, { productId: 'p2', quantity: 3, price: 20 }],
      paymentMethod: 'cash',
    });
    expect(productMocks.updateOne).toHaveBeenCalledTimes(2);
    expect(productMocks.updateOne.mock.calls[0][0]).toEqual({ _id: 'p1' });
    expect(productMocks.updateOne.mock.calls[1][0]).toEqual({ _id: 'p2' });
  });
});

describe('createPurchase — dates, notes, and side effects', () => {
  it('pins a supplied date (YYYY-MM-DD) to noon that day (backdating)', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    const purchase = await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      paymentMethod: 'cash',
      date: '2026-01-15',
    });
    expect(purchase.date.toISOString()).toContain('2026-01-15T12:00:00');
  });

  it('defaults date to now when omitted', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    const purchase = await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      paymentMethod: 'cash',
    });
    expect(purchase.date).toBeInstanceOf(Date);
  });

  it('defaults notes to an empty string when omitted', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    const purchase = await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      paymentMethod: 'cash',
    });
    expect(purchase.notes).toBe('');
  });

  it('creates a cashbox "out" transaction linked to the purchase when something was paid', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      paymentMethod: 'cash',
    });
    expect(cashboxMocks.create).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'out', amount: 10, refType: 'purchase', refId: 'purchase-1' })],
      { session: SESSION_TOKEN },
    );
  });

  it('skips the cashbox transaction when nothing was paid (credit purchase with paid=0)', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      paymentMethod: 'credit',
      paid: 0,
    });
    expect(cashboxMocks.create).not.toHaveBeenCalled();
  });

  it('records an activity entry inside the same transaction session', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      paymentMethod: 'cash',
    });
    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'purchase' }),
      { session: SESSION_TOKEN },
    );
  });

  it('uses an atomically generated purchase number, participating in the same session', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      paymentMethod: 'cash',
    });
    expect(sequenceMocks.nextSequence).toHaveBeenCalledWith('purchaseNumber', 'PUR', SESSION_TOKEN);
  });

  it('records an audit log entry with the key financial fields, inside the same transaction session', async () => {
    productMocks.findById.mockReturnValue(findByIdQuery(makeProduct()));
    await createPurchase({
      supplierId: 's1',
      items: [{ productId: 'p1', quantity: 6, price: 15 }],
      paymentMethod: 'cash',
    });
    expect(auditMocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'purchase.create',
        entityType: 'Purchase',
        entityId: 'purchase-1',
        values: expect.objectContaining({ total: 90, supplierId: 's1', paymentMethod: 'cash', itemCount: 1 }),
      }),
      { session: SESSION_TOKEN },
    );
  });
});
