import { describe, it, expect, vi, beforeEach } from 'vitest';

const activityLogMocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue([{ _id: 'a1' }]),
  aggregate: vi.fn(),
}));
vi.mock('../../src/models/ActivityLog.js', () => ({
  default: {
    create: (...args) => activityLogMocks.create(...args),
    aggregate: (...args) => activityLogMocks.aggregate(...args),
  },
}));

import { recordActivity, listActivity } from '../../src/services/activityLog.service.js';

function mockAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordActivity', () => {
  it('creates an entry with the given fields, defaulting amount/refId', async () => {
    await recordActivity({ type: 'product', description: 'وصف' });
    expect(activityLogMocks.create).toHaveBeenCalledWith(
      [{ type: 'product', description: 'وصف', amount: 0, refId: null }],
      { session: undefined },
    );
  });

  it('passes through amount/refId when provided', async () => {
    await recordActivity({ type: 'sale', description: 'وصف', amount: 500, refId: 'sale-1' });
    expect(activityLogMocks.create).toHaveBeenCalledWith(
      [{ type: 'sale', description: 'وصف', amount: 500, refId: 'sale-1' }],
      { session: undefined },
    );
  });

  it('forwards a transaction session when given one, so the entry only commits with the rest of the transaction', async () => {
    const fakeSession = { id: 'fake-session' };
    await recordActivity({ type: 'sale', description: 'وصف' }, { session: fakeSession });
    expect(activityLogMocks.create).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'sale' })],
      { session: fakeSession },
    );
  });
});

describe('listActivity', () => {
  it('returns pagination metadata', async () => {
    activityLogMocks.aggregate.mockReturnValue(
      mockAggregate([{ items: [{ type: 'sale', description: 'x' }], totalCount: [{ count: 15 }] }]),
    );
    const result = await listActivity({ page: 1, limit: 5 });
    expect(result.pagination).toEqual({ page: 1, limit: 5, total: 15, totalPages: 3 });
  });

  it('filters by exact type when not "all"', async () => {
    activityLogMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listActivity({ type: 'sale' });
    const pipeline = activityLogMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match).toEqual({ type: 'sale' });
  });

  it('ignores type="all"', async () => {
    activityLogMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listActivity({ type: 'all' });
    const pipeline = activityLogMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match).toEqual({});
  });

  it('applies a date range using day boundaries on the "date" field', async () => {
    activityLogMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listActivity({ from: '2026-01-01', to: '2026-01-31' });
    const pipeline = activityLogMocks.aggregate.mock.calls[0][0];
    const { date } = pipeline.find((s) => s.$match).$match;
    expect(date.$gte.toISOString()).toContain('2026-01-01T00:00:00');
    expect(date.$lte.toISOString()).toContain('2026-01-31T23:59:59');
  });

  it('sorts newest-first', async () => {
    activityLogMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listActivity({});
    const pipeline = activityLogMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$sort)).toEqual({ $sort: { date: -1 } });
  });

  it('defaults total to 0 when there is no activity at all', async () => {
    activityLogMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    const result = await listActivity({});
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(1);
  });
});
