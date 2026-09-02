import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/activityLog.service.js', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));

const purchaseMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Purchase.js', () => ({
  default: { aggregate: (...args) => purchaseMocks.aggregate(...args), collection: { name: 'purchases' } },
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
    await supplierService.getTotals('507f1f77bcf86cd799439011');
    const pipeline = purchaseMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match).toHaveProperty('supplierId');
  });
});
