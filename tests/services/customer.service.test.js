import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/activityLog.service.js', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));

const saleMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Sale.js', () => ({
  default: { aggregate: (...args) => saleMocks.aggregate(...args), collection: { name: 'sales' } },
}));

const customerPaymentMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/CustomerPayment.js', () => ({
  default: { aggregate: (...args) => customerPaymentMocks.aggregate(...args), collection: { name: 'customerpayments' } },
}));

const salesReturnMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/SalesReturn.js', () => ({
  default: { aggregate: (...args) => salesReturnMocks.aggregate(...args), collection: { name: 'salesreturns' } },
}));

function mockAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

import { customerService } from '../../src/services/customer.service.js';

describe('customerService wiring', () => {
  it('exposes the full person-service API', () => {
    expect(customerService.list).toBeInstanceOf(Function);
    expect(customerService.getOne).toBeInstanceOf(Function);
    expect(customerService.create).toBeInstanceOf(Function);
    expect(customerService.update).toBeInstanceOf(Function);
    expect(customerService.remove).toBeInstanceOf(Function);
    expect(customerService.getTotals).toBeInstanceOf(Function);
  });

  it('rolls up totals from Sale, matched by customerId (not e.g. supplierId/Purchase)', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ total: 100, paid: 100, count: 1, lastPurchase: null }]));
    customerPaymentMocks.aggregate.mockReturnValue(mockAggregate([]));
    salesReturnMocks.aggregate.mockReturnValue(mockAggregate([]));
    await customerService.getTotals('507f1f77bcf86cd799439011');
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match).toHaveProperty('customerId');
  });

  it('folds standalone CustomerPayment settlements into paid/remaining, on top of Sale totals', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ total: 1000, paid: 600, count: 1, lastPurchase: null }]));
    customerPaymentMocks.aggregate.mockReturnValue(mockAggregate([{ paid: 250 }]));
    salesReturnMocks.aggregate.mockReturnValue(mockAggregate([]));
    const totals = await customerService.getTotals('507f1f77bcf86cd799439011');
    // Sale-time paid (600) + later settlement (250) = 850; remaining 1000-850=150.
    expect(totals).toEqual({ total: 1000, paid: 850, remaining: 150, count: 1, lastPurchase: null, returned: 0 });
  });

  it('folds standalone SalesReturn amounts into remaining (never paid), on top of Sale totals', async () => {
    saleMocks.aggregate.mockReturnValue(mockAggregate([{ total: 900, paid: 500, count: 1, lastPurchase: null }]));
    customerPaymentMocks.aggregate.mockReturnValue(mockAggregate([]));
    salesReturnMocks.aggregate.mockReturnValue(mockAggregate([{ returned: 200 }]));
    const totals = await customerService.getTotals('507f1f77bcf86cd799439011');
    // total/paid untouched by the return; remaining = 900 - 500 - 200 = 200.
    expect(totals).toEqual({ total: 900, paid: 500, remaining: 200, count: 1, lastPurchase: null, returned: 200 });
  });
});
