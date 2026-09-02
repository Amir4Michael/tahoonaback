import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/auditLog.service.js', () => ({
  listAuditLogs: vi.fn(),
}));

const auditLogService = await import('../../src/services/auditLog.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/audit-log requires authentication', () => {
  it('rejects without a token', async () => {
    const app = createApp();
    const res = await request(app).get('/api/audit-log');
    expect(res.status).toBe(401);
    expect(auditLogService.listAuditLogs).not.toHaveBeenCalled();
  });
});

describe('GET /api/audit-log', () => {
  it('applies query defaults', async () => {
    auditLogService.listAuditLogs.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const app = createApp();
    const res = await request(app).get('/api/audit-log').set(authHeader());
    expect(res.status).toBe(200);
    expect(auditLogService.listAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
  });

  it('passes through action/entityType/actorDeviceId/date filters', async () => {
    auditLogService.listAuditLogs.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const app = createApp();
    await request(app)
      .get('/api/audit-log?action=sale.create&entityType=Sale&actorDeviceId=d1&from=2026-01-01&to=2026-01-31')
      .set(authHeader());
    expect(auditLogService.listAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sale.create', entityType: 'Sale', actorDeviceId: 'd1', from: '2026-01-01', to: '2026-01-31',
      }),
    );
  });

  it('rejects a limit above the max', async () => {
    const app = createApp();
    const res = await request(app).get('/api/audit-log?limit=999').set(authHeader());
    expect(res.status).toBe(400);
    expect(auditLogService.listAuditLogs).not.toHaveBeenCalled();
  });

  it('returns the service result with pagination', async () => {
    auditLogService.listAuditLogs.mockResolvedValue({
      items: [{ action: 'product.delete', entityType: 'Product' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    const app = createApp();
    const res = await request(app).get('/api/audit-log').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
  });
});

describe('audit log has no write endpoints', () => {
  it('POST is not allowed (entries are only ever written internally by services)', async () => {
    const app = createApp();
    const res = await request(app).post('/api/audit-log').set(authHeader()).send({ action: 'x' });
    // Either 404 (no route matched) or 401 if auth runs first is acceptable —
    // what matters is it's never a successful write.
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
  });
});
