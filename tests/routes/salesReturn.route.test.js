import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../../src/services/salesReturn.service.js', () => ({
  listSalesReturns: vi.fn(),
  getReturnableForSale: vi.fn(),
  createSalesReturn: vi.fn(),
}));

const salesReturnService = await import('../../src/services/salesReturn.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });
const validId = () => new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sales-return routes require authentication', () => {
  it('rejects list/getReturnable/create without a token', async () => {
    const app = createApp();
    expect((await request(app).get(`/api/sales-returns?customerId=${validId()}`)).status).toBe(401);
    expect((await request(app).get(`/api/sales-returns/returnable/${validId()}`)).status).toBe(401);
    expect((await request(app).post('/api/sales-returns').send({})).status).toBe(401);
    expect(salesReturnService.createSalesReturn).not.toHaveBeenCalled();
  });
});

describe('GET /api/sales-returns', () => {
  it('rejects a request with neither customerId nor saleId', async () => {
    salesReturnService.listSalesReturns.mockRejectedValue(Object.assign(new Error('حدد عميلاً أو فاتورة'), { statusCode: 400, isOperational: true }));
    const app = createApp();
    const res = await request(app).get('/api/sales-returns').set(authHeader());
    expect(res.status).toBe(400);
  });

  it('delegates to the service with the given customerId', async () => {
    salesReturnService.listSalesReturns.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const app = createApp();
    const id = validId();
    const res = await request(app).get(`/api/sales-returns?customerId=${id}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(salesReturnService.listSalesReturns).toHaveBeenCalledWith(expect.objectContaining({ customerId: id, page: 1, limit: 20 }));
  });
});

describe('GET /api/sales-returns/returnable/:saleId', () => {
  it('rejects a malformed saleId', async () => {
    const app = createApp();
    const res = await request(app).get('/api/sales-returns/returnable/bad-id').set(authHeader());
    expect(res.status).toBe(400);
    expect(salesReturnService.getReturnableForSale).not.toHaveBeenCalled();
  });

  it('returns the returnable breakdown on success', async () => {
    salesReturnService.getReturnableForSale.mockResolvedValue({
      saleId: 'sale-1',
      items: [{ productId: 'p1', originalQuantity: 5, alreadyReturnedQuantity: 2, availableToReturn: 3 }],
    });
    const app = createApp();
    const res = await request(app).get(`/api/sales-returns/returnable/${validId()}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].availableToReturn).toBe(3);
  });
});

describe('POST /api/sales-returns', () => {
  it('rejects a missing saleId', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/sales-returns')
      .set(authHeader())
      .send({ items: [{ productId: validId(), quantity: 1 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(400);
    expect(salesReturnService.createSalesReturn).not.toHaveBeenCalled();
  });

  it('rejects an empty items array', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/sales-returns')
      .set(authHeader())
      .send({ saleId: validId(), items: [], idempotencyKey: 'k1' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing idempotencyKey', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/sales-returns')
      .set(authHeader())
      .send({ saleId: validId(), items: [{ productId: validId(), quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(salesReturnService.createSalesReturn).not.toHaveBeenCalled();
  });

  it('rejects a malformed productId inside an item', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/sales-returns')
      .set(authHeader())
      .send({ saleId: validId(), items: [{ productId: 'bad', quantity: 1 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(400);
  });

  it('delegates a valid return to the service and returns 201', async () => {
    salesReturnService.createSalesReturn.mockResolvedValue({ _id: 'r1', totalReturnAmount: 200 });
    const app = createApp();
    const res = await request(app)
      .post('/api/sales-returns')
      .set(authHeader())
      .send({ saleId: validId(), items: [{ productId: validId(), quantity: 2 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(201);
    expect(res.body.data.totalReturnAmount).toBe(200);
  });

  it('propagates a 400 from the service when the return exceeds available quantity', async () => {
    const err = new Error('الكمية المطلوب إرجاعها أكبر من المتاح للإرجاع');
    err.statusCode = 400;
    err.isOperational = true;
    salesReturnService.createSalesReturn.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/sales-returns')
      .set(authHeader())
      .send({ saleId: validId(), items: [{ productId: validId(), quantity: 100 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(400);
  });

  it('propagates a 400 from the service when the return exceeds the customer balance (EXCEEDS_REMAINING)', async () => {
    const err = new Error('قيمة المرتجع أكبر من المتبقي المستحق على العميل');
    err.statusCode = 400;
    err.isOperational = true;
    err.details = { code: 'EXCEEDS_REMAINING' };
    salesReturnService.createSalesReturn.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/sales-returns')
      .set(authHeader())
      .send({ saleId: validId(), items: [{ productId: validId(), quantity: 1 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(400);
  });

  it('propagates a 404 from the service when the sale does not exist', async () => {
    const err = new Error('الفاتورة غير موجودة');
    err.statusCode = 404;
    err.isOperational = true;
    salesReturnService.createSalesReturn.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/sales-returns')
      .set(authHeader())
      .send({ saleId: validId(), items: [{ productId: validId(), quantity: 1 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(404);
  });
});
