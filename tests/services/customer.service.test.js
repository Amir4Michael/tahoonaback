import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/activityLog.service.js', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));

const saleMocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock('../../src/models/Sale.js', () => ({
  default: { aggregate: (...args) => saleMocks.aggregate(...args), collection: { name: 'sales' } },
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
    await customerService.getTotals('507f1f77bcf86cd799439011');
    const pipeline = saleMocks.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match).toHaveProperty('customerId');
  });
});
