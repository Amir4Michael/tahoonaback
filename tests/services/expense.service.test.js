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

const balanceMocks = vi.hoisted(() => ({ getBalance: vi.fn() }));
vi.mock('../../src/services/cashbox.service.js', () => ({
  getBalance: (...args) => balanceMocks.getBalance(...args),
}));

const cashboxMocks = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue([{ _id: 'tx-1' }]), deleteMany: vi.fn() }));
vi.mock('../../src/models/CashboxTransaction.js', () => ({
  default: {
    create: (...args) => cashboxMocks.create(...args),
    deleteMany: (...args) => cashboxMocks.deleteMany(...args),
  },
}));

const expenseMocks = vi.hoisted(() => ({ create: vi.fn(), aggregate: vi.fn(), findById: vi.fn(), deleteOne: vi.fn() }));
vi.mock('../../src/models/Expense.js', () => ({
  default: {
    create: (...args) => expenseMocks.create(...args),
    aggregate: (...args) => expenseMocks.aggregate(...args),
    findById: (...args) => expenseMocks.findById(...args),
    deleteOne: (...args) => expenseMocks.deleteOne(...args),
  },
}));

import { listExpenses, getSummary, createExpense, deleteExpense } from '../../src/services/expense.service.js';

const SESSION_TOKEN = { fake: 'session' };

function mockAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionMocks.withTransaction.mockImplementation((fn) => fn(SESSION_TOKEN));
  balanceMocks.getBalance.mockResolvedValue(10000);
});

describe('listExpenses', () => {
  it('returns pagination metadata and the total amount over all matching rows', async () => {
    expenseMocks.aggregate.mockReturnValue(
      mockAggregate([{ items: [{ reason: 'إيجار' }], totalCount: [{ count: 4 }], totalAmountAgg: [{ sum: 5000 }] }]),
    );
    const result = await listExpenses({ page: 1, limit: 2 });
    expect(result.pagination).toEqual({ page: 1, limit: 2, total: 4, totalPages: 2 });
    expect(result.totalAmount).toBe(5000);
  });

  it('defaults totalAmount to 0 when nothing matches', async () => {
    expenseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [], totalAmountAgg: [] }]));
    const result = await listExpenses({});
    expect(result.totalAmount).toBe(0);
  });

  it('filters by exact reason when not "all"', async () => {
    expenseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [], totalAmountAgg: [] }]));
    await listExpenses({ reason: 'إيجار' });
    const pipeline = expenseMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match.reason).toBe('إيجار');
  });

  it('ignores reason="all"', async () => {
    expenseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [], totalAmountAgg: [] }]));
    await listExpenses({ reason: 'all' });
    const pipeline = expenseMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match.reason).toBeUndefined();
  });

  it('applies a date range using day boundaries', async () => {
    expenseMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [], totalAmountAgg: [] }]));
    await listExpenses({ from: '2026-01-01', to: '2026-01-31' });
    const pipeline = expenseMocks.aggregate.mock.calls[0][0];
    const { date } = pipeline.find((s) => s.$match).$match;
    expect(date.$gte.toISOString()).toContain('2026-01-01T00:00:00');
    expect(date.$lte.toISOString()).toContain('2026-01-31T23:59:59');
  });
});

describe('getSummary', () => {
  it('returns today and month totals', async () => {
    expenseMocks.aggregate
      .mockReturnValueOnce(mockAggregate([{ sum: 300 }]))
      .mockReturnValueOnce(mockAggregate([{ sum: 4500 }]));
    const summary = await getSummary();
    expect(summary).toEqual({ todayTotal: 300, monthTotal: 4500 });
  });

  it('defaults to 0 when there is no matching activity', async () => {
    expenseMocks.aggregate.mockReturnValueOnce(mockAggregate([])).mockReturnValueOnce(mockAggregate([]));
    const summary = await getSummary();
    expect(summary).toEqual({ todayTotal: 0, monthTotal: 0 });
  });
});

describe('createExpense', () => {
  it('rejects a missing reason', async () => {
    await expect(createExpense({ amount: 100 })).rejects.toMatchObject({ statusCode: 400 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a zero/negative amount', async () => {
    await expect(createExpense({ reason: 'إيجار', amount: 0 })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects when the amount exceeds the current balance', async () => {
    balanceMocks.getBalance.mockResolvedValue(50);
    await expect(createExpense({ reason: 'إيجار', amount: 100 })).rejects.toMatchObject({ statusCode: 400 });
    expect(expenseMocks.create).not.toHaveBeenCalled();
  });

  it('checks the balance WITHIN the transaction session (race-safety)', async () => {
    expenseMocks.create.mockResolvedValue([{ _id: 'e1', reason: 'إيجار', amount: 100, notes: '', date: new Date() }]);
    await createExpense({ reason: 'إيجار', amount: 100 });
    expect(balanceMocks.getBalance).toHaveBeenCalledWith(SESSION_TOKEN);
  });

  it('creates the expense and a linked cashbox "out" transaction together', async () => {
    expenseMocks.create.mockResolvedValue([{ _id: 'e1', reason: 'إيجار', amount: 3000, notes: '', date: new Date('2026-01-01') }]);
    await createExpense({ reason: 'إيجار', amount: 3000 });

    expect(cashboxMocks.create).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'out', amount: 3000, refType: 'expense', refId: 'e1' })],
      { session: SESSION_TOKEN },
    );
  });

  it('records an activity entry within the same transaction session', async () => {
    expenseMocks.create.mockResolvedValue([{ _id: 'e1', reason: 'إيجار', amount: 100, notes: '', date: new Date() }]);
    await createExpense({ reason: 'إيجار', amount: 100 });
    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'expense' }),
      { session: SESSION_TOKEN },
    );
  });
});

describe('deleteExpense', () => {
  it('throws 404 when the expense does not exist', async () => {
    expenseMocks.findById.mockResolvedValue(null);
    await expect(deleteExpense('missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(transactionMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('deletes both the expense and its linked cashbox transaction(s)', async () => {
    expenseMocks.findById.mockResolvedValue({ _id: 'e1', reason: 'إيجار', amount: 3000 });
    await deleteExpense('e1');

    expect(expenseMocks.deleteOne).toHaveBeenCalledWith({ _id: 'e1' }, { session: SESSION_TOKEN });
    expect(cashboxMocks.deleteMany).toHaveBeenCalledWith(
      { refType: 'expense', refId: 'e1' },
      { session: SESSION_TOKEN },
    );
  });

  it('records an activity entry for the deletion', async () => {
    expenseMocks.findById.mockResolvedValue({ _id: 'e1', reason: 'إيجار', amount: 3000 });
    await deleteExpense('e1');
    expect(activityMocks.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'expense', description: expect.stringContaining('حذف') }),
      { session: SESSION_TOKEN },
    );
  });
});
