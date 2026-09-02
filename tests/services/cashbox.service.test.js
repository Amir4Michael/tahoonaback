import { describe, it, expect, vi, beforeEach } from 'vitest';

const transactionMocks = vi.hoisted(() => ({ withTransaction: vi.fn() }));
vi.mock('../../src/utils/transactions.js', () => ({
  withTransaction: (...args) => transactionMocks.withTransaction(...args),
}));

const activityMocks = vi.hoisted(() => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/activityLog.service.js', () => ({
  recordActivity: (...args) => activityMocks.recordActivity(...args),
}));

const auditMocks = vi.hoisted(() => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/auditLog.service.js', () => ({
  recordAuditLog: (...args) => auditMocks.recordAuditLog(...args),
}));

const cashboxMocks = vi.hoisted(() => ({ aggregate: vi.fn(), create: vi.fn() }));
vi.mock('../../src/models/CashboxTransaction.js', () => ({
  default: {
    aggregate: (...args) => cashboxMocks.aggregate(...args),
    create: (...args) => cashboxMocks.create(...args),
  },
}));

import { getBalance, getSummary, listCashboxTransactions, createCashTransaction } from '../../src/services/cashbox.service.js';

const SESSION_TOKEN = { fake: 'session' };

function mockAggregate(result) {
  const agg = {
    session: vi.fn(() => agg),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return agg;
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionMocks.withTransaction.mockImplementation((fn) => fn(SESSION_TOKEN));
});

describe('getBalance', () => {
  it('returns 0 when there are no transactions at all', async () => {
    cashboxMocks.aggregate.mockReturnValue(mockAggregate([]));
    expect(await getBalance()).toBe(0);
  });

  it('returns the aggregated balance', async () => {
    cashboxMocks.aggregate.mockReturnValue(mockAggregate([{ balance: 750 }]));
    expect(await getBalance()).toBe(750);
  });

  it('sums "in" as positive and "out" as negative in the pipeline', async () => {
    cashboxMocks.aggregate.mockReturnValue(mockAggregate([{ balance: 0 }]));
    await getBalance();
    const pipeline = cashboxMocks.aggregate.mock.calls[0][0];
    const groupStage = pipeline.find((s) => s.$group);
    expect(groupStage.$group.balance.$sum.$cond[0]).toEqual({ $eq: ['$type', 'in'] });
  });

  it('forwards a transaction session when given one', async () => {
    const agg = mockAggregate([{ balance: 100 }]);
    cashboxMocks.aggregate.mockReturnValue(agg);
    await getBalance(SESSION_TOKEN);
    expect(agg.session).toHaveBeenCalledWith(SESSION_TOKEN);
  });

  it('does not call .session() when no session is given', async () => {
    const agg = mockAggregate([{ balance: 100 }]);
    cashboxMocks.aggregate.mockReturnValue(agg);
    await getBalance();
    expect(agg.session).not.toHaveBeenCalled();
  });
});

describe('getSummary', () => {
  it('combines the all-time balance with today\'s in/out totals', async () => {
    cashboxMocks.aggregate
      .mockReturnValueOnce(mockAggregate([{ balance: 500 }])) // getBalance()
      .mockReturnValueOnce(mockAggregate([{ todayIn: 200, todayOut: 50 }])); // today's totals
    const summary = await getSummary();
    expect(summary).toEqual({ balance: 500, todayIn: 200, todayOut: 50 });
  });

  it('defaults today totals to 0 when there is no activity today', async () => {
    cashboxMocks.aggregate
      .mockReturnValueOnce(mockAggregate([{ balance: 0 }]))
      .mockReturnValueOnce(mockAggregate([]));
    const summary = await getSummary();
    expect(summary.todayIn).toBe(0);
    expect(summary.todayOut).toBe(0);
  });
});

describe('listCashboxTransactions', () => {
  it('returns pagination metadata', async () => {
    cashboxMocks.aggregate.mockReturnValue(mockAggregate([{ items: [{ reason: 'x' }], totalCount: [{ count: 8 }] }]));
    const result = await listCashboxTransactions({ page: 1, limit: 5 });
    expect(result.pagination).toEqual({ page: 1, limit: 5, total: 8, totalPages: 2 });
  });

  it('filters by exact type when not "all"', async () => {
    cashboxMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listCashboxTransactions({ type: 'out' });
    const pipeline = cashboxMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match.type).toBe('out');
  });

  it('searches reason with a case-insensitive substring match', async () => {
    cashboxMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listCashboxTransactions({ search: 'إيجار' });
    const pipeline = cashboxMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match.reason).toBeInstanceOf(RegExp);
  });

  it('applies a date range using day boundaries', async () => {
    cashboxMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listCashboxTransactions({ from: '2026-01-01', to: '2026-01-31' });
    const pipeline = cashboxMocks.aggregate.mock.calls[0][0];
    const { date } = pipeline.find((s) => s.$match).$match;
    expect(date.$gte.toISOString()).toContain('2026-01-01T00:00:00');
    expect(date.$lte.toISOString()).toContain('2026-01-31T23:59:59');
  });
});

describe('createCashTransaction', () => {
  it('rejects a zero/negative amount', async () => {
    await expect(createCashTransaction({ type: 'in', amount: 0, reason: 'x' })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a missing reason', async () => {
    await expect(createCashTransaction({ type: 'in', amount: 100, reason: '  ' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('does not check balance for a deposit ("in")', async () => {
    cashboxMocks.create.mockResolvedValue([{ _id: 'tx-1', reason: 'إيداع' }]);
    await createCashTransaction({ type: 'in', amount: 1000000, reason: 'إيداع' });
    expect(cashboxMocks.aggregate).not.toHaveBeenCalled(); // getBalance() never called
  });

  it('checks balance for a withdrawal ("out") and rejects if insufficient', async () => {
    cashboxMocks.aggregate.mockReturnValue(mockAggregate([{ balance: 50 }]));
    await expect(
      createCashTransaction({ type: 'out', amount: 100, reason: 'سحب' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(cashboxMocks.create).not.toHaveBeenCalled();
  });

  it('allows a withdrawal within the available balance', async () => {
    cashboxMocks.aggregate.mockReturnValue(mockAggregate([{ balance: 500 }]));
    cashboxMocks.create.mockResolvedValue([{ _id: 'tx-1', reason: 'سحب' }]);
    const tx = await createCashTransaction({ type: 'out', amount: 300, reason: 'سحب' });
    expect(tx._id).toBe('tx-1');
  });

  it('records an activity entry within the same transaction session', async () => {
    cashboxMocks.create.mockResolvedValue([{ _id: 'tx-1', reason: 'إيداع' }]);
    await createCashTransaction({ type: 'in', amount: 100, reason: 'إيداع' });
    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cash' }),
      { session: SESSION_TOKEN },
    );
  });

  it('pins a supplied date to noon that day', async () => {
    cashboxMocks.create.mockImplementation(async (docs) => [{ ...docs[0], _id: 'tx-1' }]);
    const tx = await createCashTransaction({ type: 'in', amount: 100, reason: 'إيداع', date: '2026-03-10' });
    expect(tx.date.toISOString()).toContain('2026-03-10T12:00:00');
  });
});
