import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../../src/services/expense.service.js', () => ({
  listExpenses: vi.fn(),
  getSummary: vi.fn(),
  createExpense: vi.fn(),
  deleteExpense: vi.fn(),
}));

const expenseService = await import('../../src/services/expense.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });
const validId = () => new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('expense routes require authentication', () => {
  it('rejects list/summary/create/delete without a token', async () => {
    const app = createApp();
    expect((await request(app).get('/api/expenses')).status).toBe(401);
    expect((await request(app).get('/api/expenses/summary')).status).toBe(401);
    expect((await request(app).post('/api/expenses').send({})).status).toBe(401);
    expect((await request(app).delete(`/api/expenses/${validId()}`)).status).toBe(401);
    expect(expenseService.createExpense).not.toHaveBeenCalled();
  });
});

describe('GET /api/expenses', () => {
  it('applies query defaults, defaulting reason to "all"', async () => {
    expenseService.listExpenses.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 }, totalAmount: 0 });
    const app = createApp();
    const res = await request(app).get('/api/expenses').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.totalAmount).toBe(0);
    expect(expenseService.listExpenses).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20, reason: 'all' }));
  });
});

describe('GET /api/expenses/summary', () => {
  it('returns the service summary', async () => {
    expenseService.getSummary.mockResolvedValue({ todayTotal: 300, monthTotal: 4500 });
    const app = createApp();
    const res = await request(app).get('/api/expenses/summary').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.monthTotal).toBe(4500);
  });
});

describe('POST /api/expenses', () => {
  it('rejects a missing reason/amount', async () => {
    const app = createApp();
    const res = await request(app).post('/api/expenses').set(authHeader()).send({});
    expect(res.status).toBe(400);
    expect(expenseService.createExpense).not.toHaveBeenCalled();
  });

  it('defaults notes to an empty string', async () => {
    expenseService.createExpense.mockResolvedValue({ _id: 'e1', reason: 'إيجار', amount: 3000 });
    const app = createApp();
    await request(app).post('/api/expenses').set(authHeader()).send({ reason: 'إيجار', amount: 3000 });
    const [callArg] = expenseService.createExpense.mock.calls[0];
    expect(callArg.notes).toBe('');
  });

  it('delegates to the service and returns 201', async () => {
    expenseService.createExpense.mockResolvedValue({ _id: 'e1', reason: 'إيجار', amount: 3000 });
    const app = createApp();
    const res = await request(app).post('/api/expenses').set(authHeader()).send({ reason: 'إيجار', amount: 3000 });
    expect(res.status).toBe(201);
    expect(res.body.data._id).toBe('e1');
  });

  it('propagates an insufficient-balance 400 from the service', async () => {
    const err = new Error('رصيد الصندوق غير كافٍ لهذا المصروف');
    err.statusCode = 400;
    err.isOperational = true;
    expenseService.createExpense.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app).post('/api/expenses').set(authHeader()).send({ reason: 'إيجار', amount: 999999 });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/expenses/:id', () => {
  it('rejects a malformed id', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/expenses/bad-id').set(authHeader());
    expect(res.status).toBe(400);
    expect(expenseService.deleteExpense).not.toHaveBeenCalled();
  });

  it('deletes successfully on a valid id', async () => {
    expenseService.deleteExpense.mockResolvedValue({ success: true });
    const app = createApp();
    const id = validId();
    const res = await request(app).delete(`/api/expenses/${id}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(expenseService.deleteExpense).toHaveBeenCalledWith(id);
  });

  it('propagates a 404 from the service', async () => {
    const err = new Error('المصروف غير موجود');
    err.statusCode = 404;
    err.isOperational = true;
    expenseService.deleteExpense.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app).delete(`/api/expenses/${validId()}`).set(authHeader());
    expect(res.status).toBe(404);
  });
});
