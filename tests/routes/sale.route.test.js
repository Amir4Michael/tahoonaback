import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../../src/services/sale.service.js', () => ({
  listSales: vi.fn(),
  getSale: vi.fn(),
  createSale: vi.fn(),
}));

const saleService = await import('../../src/services/sale.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });
const validId = () => new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sale routes require authentication', () => {
  it('rejects list/get/create without a token', async () => {
    const app = createApp();
    expect((await request(app).get('/api/sales')).status).toBe(401);
    expect((await request(app).get(`/api/sales/${validId()}`)).status).toBe(401);
    expect((await request(app).post('/api/sales').send({})).status).toBe(401);
    expect(saleService.createSale).not.toHaveBeenCalled();
  });
});

describe('GET /api/sales', () => {
  it('applies query defaults', async () => {
    saleService.listSales.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const app = createApp();
    const res = await request(app).get('/api/sales').set(authHeader());
    expect(res.status).toBe(200);
    expect(saleService.listSales).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20, paymentMethod: 'all' }));
  });

  it('rejects an invalid paymentMethod', async () => {
    const app = createApp();
    const res = await request(app).get('/api/sales?paymentMethod=bogus').set(authHeader());
    expect(res.status).toBe(400);
  });
});

describe('GET /api/sales/:id', () => {
  it('rejects a malformed id', async () => {
    const app = createApp();
    const res = await request(app).get('/api/sales/bad-id').set(authHeader());
    expect(res.status).toBe(400);
    expect(saleService.getSale).not.toHaveBeenCalled();
  });

  it('returns the sale on success', async () => {
    saleService.getSale.mockResolvedValue({ invoiceNumber: 'INV-1' });
    const app = createApp();
    const res = await request(app).get(`/api/sales/${validId()}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.invoiceNumber).toBe('INV-1');
  });
});

describe('POST /api/sales', () => {
  it('rejects an empty items array with 400 before calling the service', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/sales')
      .set(authHeader())
      .send({ items: [], paymentMethod: 'cash' });
    expect(res.status).toBe(400);
    expect(saleService.createSale).not.toHaveBeenCalled();
  });

  it('rejects a malformed productId inside an item', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/sales')
      .set(authHeader())
      .send({ items: [{ productId: 'not-an-id', quantity: 1 }], paymentMethod: 'cash' });
    expect(res.status).toBe(400);
  });

  it('rejects credit payment without a customerId at the validation layer', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/sales')
      .set(authHeader())
      .send({ items: [{ productId: validId(), quantity: 1 }], paymentMethod: 'credit' });
    expect(res.status).toBe(400);
    expect(saleService.createSale).not.toHaveBeenCalled();
  });

  it('normalizes an empty-string price to "no override" (undefined), not 0, before reaching the service', async () => {
    saleService.createSale.mockResolvedValue({ invoiceNumber: 'INV-1' });
    const app = createApp();
    const pid = validId();
    await request(app)
      .post('/api/sales')
      .set(authHeader())
      .send({ items: [{ productId: pid, quantity: 1, price: '' }], paymentMethod: 'cash' });

    const [callArg] = saleService.createSale.mock.calls[0];
    expect(callArg.items[0].price).toBeUndefined();
  });

  it('delegates to the service and returns 201 on success', async () => {
    saleService.createSale.mockResolvedValue({ invoiceNumber: 'INV-1001', total: 200 });
    const app = createApp();
    const res = await request(app)
      .post('/api/sales')
      .set(authHeader())
      .send({ items: [{ productId: validId(), quantity: 2 }], paymentMethod: 'cash' });
    expect(res.status).toBe(201);
    expect(res.body.data.invoiceNumber).toBe('INV-1001');
  });

  it('rejects a negative discount at the validation layer, before calling the service', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/sales')
      .set(authHeader())
      .send({ items: [{ productId: validId(), quantity: 1 }], paymentMethod: 'cash', discount: -10 });
    expect(res.status).toBe(400);
    expect(saleService.createSale).not.toHaveBeenCalled();
  });

  it('passes a valid discount through to the service', async () => {
    saleService.createSale.mockResolvedValue({ invoiceNumber: 'INV-2', total: 90, discount: 10 });
    const app = createApp();
    const res = await request(app)
      .post('/api/sales')
      .set(authHeader())
      .send({ items: [{ productId: validId(), quantity: 1 }], paymentMethod: 'cash', discount: 10 });
    expect(res.status).toBe(201);
    const [callArg] = saleService.createSale.mock.calls[0];
    expect(callArg.discount).toBe(10);
  });

  it('propagates a 400 from the service when the discount exceeds the subtotal', async () => {
    const err = new Error('الخصم أكبر من إجمالي الفاتورة');
    err.statusCode = 400;
    err.isOperational = true;
    saleService.createSale.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/sales')
      .set(authHeader())
      .send({ items: [{ productId: validId(), quantity: 1 }], paymentMethod: 'cash', discount: 999999 });
    expect(res.status).toBe(400);
  });

  it('propagates a 409 stock-race error from the service', async () => {
    const err = new Error('الكمية المطلوبة لم تعد متاحة');
    err.statusCode = 409;
    err.isOperational = true;
    saleService.createSale.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/sales')
      .set(authHeader())
      .send({ items: [{ productId: validId(), quantity: 1 }], paymentMethod: 'cash' });
    expect(res.status).toBe(409);
  });
});
