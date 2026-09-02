import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/activityLog.service.js', () => ({
  listActivity: vi.fn(),
  recordActivity: vi.fn(),
}));

const activityLogService = await import('../../src/services/activityLog.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/activity requires authentication', () => {
  it('rejects without a token', async () => {
    const app = createApp();
    const res = await request(app).get('/api/activity');
    expect(res.status).toBe(401);
    expect(activityLogService.listActivity).not.toHaveBeenCalled();
  });
});

describe('GET /api/activity', () => {
  it('applies query defaults', async () => {
    activityLogService.listActivity.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const app = createApp();
    const res = await request(app).get('/api/activity').set(authHeader());
    expect(res.status).toBe(200);
    expect(activityLogService.listActivity).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20, type: 'all' }));
  });

  it('passes through a valid type filter', async () => {
    activityLogService.listActivity.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const app = createApp();
    await request(app).get('/api/activity?type=sale').set(authHeader());
    expect(activityLogService.listActivity).toHaveBeenCalledWith(expect.objectContaining({ type: 'sale' }));
  });

  it('passes through a from/to date range', async () => {
    activityLogService.listActivity.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const app = createApp();
    await request(app).get('/api/activity?from=2026-01-01&to=2026-01-31').set(authHeader());
    expect(activityLogService.listActivity).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-01-01', to: '2026-01-31' }),
    );
  });

  it('rejects an invalid type', async () => {
    const app = createApp();
    const res = await request(app).get('/api/activity?type=bogus').set(authHeader());
    expect(res.status).toBe(400);
    expect(activityLogService.listActivity).not.toHaveBeenCalled();
  });

  it('rejects a limit above the max', async () => {
    const app = createApp();
    const res = await request(app).get('/api/activity?limit=999').set(authHeader());
    expect(res.status).toBe(400);
  });

  it('returns the service result with pagination', async () => {
    activityLogService.listActivity.mockResolvedValue({
      items: [{ type: 'sale', description: 'تم إنشاء فاتورة بيع رقم INV-1' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    const app = createApp();
    const res = await request(app).get('/api/activity').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('activity feed has no write endpoints', () => {
  it('POST is not allowed (entries are only ever written internally via recordActivity)', async () => {
    const app = createApp();
    const res = await request(app).post('/api/activity').set(authHeader()).send({ type: 'sale' });
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
  });
});
