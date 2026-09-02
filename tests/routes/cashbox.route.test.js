import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/cashbox.service.js', () => ({
  listCashboxTransactions: vi.fn(),
  getSummary: vi.fn(),
  createCashTransaction: vi.fn(),
}));

const cashboxService = await import('../../src/services/cashbox.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cashbox routes require authentication', () => {
  it('rejects list/summary/create without a token', async () => {
    const app = createApp();
    expect((await request(app).get('/api/cashbox')).status).toBe(401);
    expect((await request(app).get('/api/cashbox/summary')).status).toBe(401);
    expect((await request(app).post('/api/cashbox').send({})).status).toBe(401);
    expect(cashboxService.createCashTransaction).not.toHaveBeenCalled();
  });
});

describe('GET /api/cashbox', () => {
  it('applies query defaults', async () => {
    cashboxService.listCashboxTransactions.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const app = createApp();
    const res = await request(app).get('/api/cashbox').set(authHeader());
    expect(res.status).toBe(200);
    expect(cashboxService.listCashboxTransactions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20, type: 'all' }));
  });

  it('rejects an invalid type', async () => {
    const app = createApp();
    const res = await request(app).get('/api/cashbox?type=sideways').set(authHeader());
    expect(res.status).toBe(400);
  });
});

describe('GET /api/cashbox/summary', () => {
  it('returns the service summary', async () => {
    cashboxService.getSummary.mockResolvedValue({ balance: 500, todayIn: 100, todayOut: 20 });
    const app = createApp();
    const res = await request(app).get('/api/cashbox/summary').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(500);
  });
});

describe('POST /api/cashbox', () => {
  it('rejects a missing type/amount/reason', async () => {
    const app = createApp();
    const res = await request(app).post('/api/cashbox').set(authHeader()).send({});
    expect(res.status).toBe(400);
    expect(cashboxService.createCashTransaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid type value', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/cashbox')
      .set(authHeader())
      .send({ type: 'sideways', amount: 100, reason: 'x' });
    expect(res.status).toBe(400);
  });

  it('delegates to the service and returns 201', async () => {
    cashboxService.createCashTransaction.mockResolvedValue({ _id: 'tx-1', type: 'in', amount: 100 });
    const app = createApp();
    const res = await request(app)
      .post('/api/cashbox')
      .set(authHeader())
      .send({ type: 'in', amount: 100, reason: 'إيداع' });
    expect(res.status).toBe(201);
    expect(res.body.data._id).toBe('tx-1');
  });

  it('propagates an insufficient-balance 400 from the service', async () => {
    const err = new Error('رصيد الصندوق غير كافٍ لهذا السحب');
    err.statusCode = 400;
    err.isOperational = true;
    cashboxService.createCashTransaction.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/cashbox')
      .set(authHeader())
      .send({ type: 'out', amount: 999999, reason: 'سحب' });
    expect(res.status).toBe(400);
  });
});
