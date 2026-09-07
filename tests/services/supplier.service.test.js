import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/activityLog.service.js', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));

const purchaseMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Purchase.js', () => ({
  default: { aggregate: (...args) => purchaseMocks.aggregate(...args), collection: { name: 'purchases' } },
}));

const supplierPaymentMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/SupplierPayment.js', () => ({
  default: { aggregate: (...args) => supplierPaymentMocks.aggregate(...args), collection: { name: 'supplierpayments' } },
}));

const purchaseReturnMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/PurchaseReturn.js', () => ({
  default: { aggregate: (...args) => purchaseReturnMocks.aggregate(...args), collection: { name: 'purchasereturns' } },
}));

function mockAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

import { supplierService } from '../../src/services/supplier.service.js';

describe('supplierService wiring', () => {
  it('exposes the full person-service API', () => {
    expect(supplierService.list).toBeInstanceOf(Function);
    expect(supplierService.getOne).toBeInstanceOf(Function);
    expect(supplierService.create).toBeInstanceOf(Function);
    expect(supplierService.update).toBeInstanceOf(Function);
    expect(supplierService.remove).toBeInstanceOf(Function);
    expect(supplierService.getTotals).toBeInstanceOf(Function);
  });

  it('rolls up totals from Purchase, matched by supplierId (not e.g. customerId/Sale)', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ total: 500, paid: 300, count: 2, lastPurchase: null }]));
    supplierPaymentMocks.aggregate.mockReturnValue(mockAggregate([]));
    purchaseReturnMocks.aggregate.mockReturnValue(mockAggregate([]));
    await supplierService.getTotals('507f1f77bcf86cd799439011');
    const pipeline = purchaseMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match).toHaveProperty('supplierId');
  });

  it('folds standalone SupplierPayment settlements into paid/remaining, on top of Purchase totals', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ total: 5000, paid: 3000, count: 1, lastPurchase: null }]));
    supplierPaymentMocks.aggregate.mockReturnValue(mockAggregate([{ paid: 1000 }]));
    purchaseReturnMocks.aggregate.mockReturnValue(mockAggregate([]));
    const totals = await supplierService.getTotals('507f1f77bcf86cd799439011');
    // Purchase-time paid (3000) + later settlement (1000) = 4000; remaining 5000-4000=1000.
    expect(totals).toEqual({ total: 5000, paid: 4000, remaining: 1000, count: 1, lastPurchase: null, returned: 0 });
  });

  it('folds standalone PurchaseReturn amounts into remaining (never paid), on top of Purchase totals', async () => {
    purchaseMocks.aggregate.mockReturnValue(mockAggregate([{ total: 1000, paid: 400, count: 1, lastPurchase: null }]));
    supplierPaymentMocks.aggregate.mockReturnValue(mockAggregate([]));
    purchaseReturnMocks.aggregate.mockReturnValue(mockAggregate([{ returned: 300 }]));
    const totals = await supplierService.getTotals('507f1f77bcf86cd799439011');
    // total/paid untouched by the return; remaining = 1000 - 400 - 300 = 300.
    expect(totals).toEqual({ total: 1000, paid: 400, remaining: 300, count: 1, lastPurchase: null, returned: 300 });
  });
});
