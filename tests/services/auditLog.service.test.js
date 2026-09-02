import { describe, it, expect, vi, beforeEach } from 'vitest';

const contextMocks = vi.hoisted(() => ({ getRequestContext: vi.fn() }));
vi.mock('../../src/utils/requestContext.js', () => ({
  getRequestContext: (...args) => contextMocks.getRequestContext(...args),
}));

const auditLogMocks = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue([{ _id: 'a1' }]), aggregate: vi.fn() }));
vi.mock('../../src/models/AuditLog.js', () => ({
  default: {
    create: (...args) => auditLogMocks.create(...args),
    aggregate: (...args) => auditLogMocks.aggregate(...args),
  },
}));

import { recordAuditLog, listAuditLogs } from '../../src/services/auditLog.service.js';

function mockAggregate(result) {
  return { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordAuditLog', () => {
  it('uses the deviceId from the request context when actorDeviceId is not explicitly given', async () => {
    contextMocks.getRequestContext.mockReturnValue({ deviceId: 'ctx-device' });
    await recordAuditLog({ action: 'product.create', entityType: 'Product' });
    expect(auditLogMocks.create).toHaveBeenCalledWith(
      [expect.objectContaining({ actorDeviceId: 'ctx-device' })],
      { session: undefined },
    );
  });

  it('prefers an explicitly given actorDeviceId over the context (e.g. login, which runs before context exists)', async () => {
    contextMocks.getRequestContext.mockReturnValue({ deviceId: 'ctx-device' });
    await recordAuditLog({ action: 'auth.login.success', entityType: 'DeviceSession', actorDeviceId: 'explicit-device' });
    expect(auditLogMocks.create).toHaveBeenCalledWith(
      [expect.objectContaining({ actorDeviceId: 'explicit-device' })],
      { session: undefined },
    );
  });

  it('falls back to null when there is no context and no explicit actorDeviceId', async () => {
    contextMocks.getRequestContext.mockReturnValue(undefined);
    await recordAuditLog({ action: 'a', entityType: 'b' });
    expect(auditLogMocks.create).toHaveBeenCalledWith(
      [expect.objectContaining({ actorDeviceId: null })],
      { session: undefined },
    );
  });

  it('defaults entityId to null and values to an empty object', async () => {
    contextMocks.getRequestContext.mockReturnValue(undefined);
    await recordAuditLog({ action: 'a', entityType: 'b' });
    expect(auditLogMocks.create).toHaveBeenCalledWith(
      [expect.objectContaining({ entityId: null, values: {} })],
      { session: undefined },
    );
  });

  it('forwards a transaction session when given one', async () => {
    contextMocks.getRequestContext.mockReturnValue(undefined);
    const fakeSession = { id: 'fake' };
    await recordAuditLog({ action: 'a', entityType: 'b' }, { session: fakeSession });
    expect(auditLogMocks.create).toHaveBeenCalledWith(expect.anything(), { session: fakeSession });
  });
});

describe('listAuditLogs', () => {
  it('returns pagination metadata', async () => {
    auditLogMocks.aggregate.mockReturnValue(mockAggregate([{ items: [{ action: 'sale.create' }], totalCount: [{ count: 9 }] }]));
    const result = await listAuditLogs({ page: 1, limit: 5 });
    expect(result.pagination).toEqual({ page: 1, limit: 5, total: 9, totalPages: 2 });
  });

  it('filters by exact action/entityType/actorDeviceId when provided', async () => {
    auditLogMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listAuditLogs({ action: 'sale.create', entityType: 'Sale', actorDeviceId: 'd1' });
    const pipeline = auditLogMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$match).$match).toEqual({ action: 'sale.create', entityType: 'Sale', actorDeviceId: 'd1' });
  });

  it('applies a date range using day boundaries on the "at" field', async () => {
    auditLogMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listAuditLogs({ from: '2026-01-01', to: '2026-01-31' });
    const pipeline = auditLogMocks.aggregate.mock.calls[0][0];
    const { at } = pipeline.find((s) => s.$match).$match;
    expect(at.$gte.toISOString()).toContain('2026-01-01T00:00:00');
    expect(at.$lte.toISOString()).toContain('2026-01-31T23:59:59');
  });

  it('sorts newest-first', async () => {
    auditLogMocks.aggregate.mockReturnValue(mockAggregate([{ items: [], totalCount: [] }]));
    await listAuditLogs({});
    const pipeline = auditLogMocks.aggregate.mock.calls[0][0];
    expect(pipeline.find((s) => s.$sort)).toEqual({ $sort: { at: -1 } });
  });
});
