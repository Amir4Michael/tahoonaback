import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../../src/services/purchase.service.js', () => ({
  listPurchases: vi.fn(),
  getPurchase: vi.fn(),
  createPurchase: vi.fn(),
}));

const purchaseService = await import('../../src/services/purchase.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });
const validId = () => new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('purchase routes require authentication', () => {
  it('rejects list/get/create without a token', async () => {
    const app = createApp();
    expect((await request(app).get('/api/purchases')).status).toBe(401);
    expect((await request(app).get(`/api/purchases/${validId()}`)).status).toBe(401);
    expect((await request(app).post('/api/purchases').send({})).status).toBe(401);
    expect(purchaseService.createPurchase).not.toHaveBeenCalled();
  });
});

describe('GET /api/purchases', () => {
  it('applies query defaults', async () => {
    purchaseService.listPurchases.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const app = createApp();
    const res = await request(app).get('/api/purchases').set(authHeader());
    expect(res.status).toBe(200);
    expect(purchaseService.listPurchases).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20, paymentMethod: 'all' }));
  });

  it('rejects an invalid paymentMethod', async () => {
    const app = createApp();
    const res = await request(app).get('/api/purchases?paymentMethod=bogus').set(authHeader());
    expect(res.status).toBe(400);
  });
});

describe('GET /api/purchases/:id', () => {
  it('rejects a malformed id', async () => {
    const app = createApp();
    const res = await request(app).get('/api/purchases/bad-id').set(authHeader());
    expect(res.status).toBe(400);
    expect(purchaseService.getPurchase).not.toHaveBeenCalled();
  });

  it('returns the purchase on success', async () => {
    purchaseService.getPurchase.mockResolvedValue({ purchaseNumber: 'PUR-1' });
    const app = createApp();
    const res = await request(app).get(`/api/purchases/${validId()}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.purchaseNumber).toBe('PUR-1');
  });
});

describe('POST /api/purchases', () => {
  it('rejects a missing supplierId with 400 before calling the service', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/purchases')
      .set(authHeader())
      .send({ items: [{ productId: validId(), quantity: 1, price: 10 }], paymentMethod: 'cash' });
    expect(res.status).toBe(400);
    expect(purchaseService.createPurchase).not.toHaveBeenCalled();
  });

  it('rejects an empty items array', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/purchases')
      .set(authHeader())
      .send({ supplierId: validId(), items: [], paymentMethod: 'cash' });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed productId inside an item', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/purchases')
      .set(authHeader())
      .send({ supplierId: validId(), items: [{ productId: 'bad', quantity: 1, price: 10 }], paymentMethod: 'cash' });
    expect(res.status).toBe(400);
  });

  it('defaults notes to an empty string', async () => {
    purchaseService.createPurchase.mockResolvedValue({ purchaseNumber: 'PUR-1' });
    const app = createApp();
    await request(app)
      .post('/api/purchases')
      .set(authHeader())
      .send({ supplierId: validId(), items: [{ productId: validId(), quantity: 1, price: 10 }], paymentMethod: 'cash' });
    const [callArg] = purchaseService.createPurchase.mock.calls[0];
    expect(callArg.notes).toBe('');
  });

  it('delegates to the service and returns 201 on success', async () => {
    purchaseService.createPurchase.mockResolvedValue({ purchaseNumber: 'PUR-1001', total: 90 });
    const app = createApp();
    const res = await request(app)
      .post('/api/purchases')
      .set(authHeader())
      .send({ supplierId: validId(), items: [{ productId: validId(), quantity: 6, price: 15 }], paymentMethod: 'cash' });
    expect(res.status).toBe(201);
    expect(res.body.data.purchaseNumber).toBe('PUR-1001');
  });

  it('rejects a negative discount at the validation layer, before calling the service', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/purchases')
      .set(authHeader())
      .send({
        supplierId: validId(),
        items: [{ productId: validId(), quantity: 1, price: 10 }],
        paymentMethod: 'cash',
        discount: -5,
      });
    expect(res.status).toBe(400);
    expect(purchaseService.createPurchase).not.toHaveBeenCalled();
  });

  it('passes a valid discount through to the service', async () => {
    purchaseService.createPurchase.mockResolvedValue({ purchaseNumber: 'PUR-2', total: 25, discount: 5 });
    const app = createApp();
    const res = await request(app)
      .post('/api/purchases')
      .set(authHeader())
      .send({
        supplierId: validId(),
        items: [{ productId: validId(), quantity: 2, price: 15 }],
        paymentMethod: 'cash',
        discount: 5,
      });
    expect(res.status).toBe(201);
    const [callArg] = purchaseService.createPurchase.mock.calls[0];
    expect(callArg.discount).toBe(5);
  });

  it('propagates a 400 from the service when the discount exceeds the subtotal', async () => {
    const err = new Error('الخصم أكبر من إجمالي العملية');
    err.statusCode = 400;
    err.isOperational = true;
    purchaseService.createPurchase.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/purchases')
      .set(authHeader())
      .send({
        supplierId: validId(),
        items: [{ productId: validId(), quantity: 1, price: 10 }],
        paymentMethod: 'cash',
        discount: 999999,
      });
    expect(res.status).toBe(400);
  });

  it('propagates a service error (e.g. product not found) with its status code', async () => {
    const err = new Error('منتج غير موجود');
    err.statusCode = 404;
    err.isOperational = true;
    purchaseService.createPurchase.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/purchases')
      .set(authHeader())
      .send({ supplierId: validId(), items: [{ productId: validId(), quantity: 1, price: 10 }], paymentMethod: 'cash' });
    expect(res.status).toBe(404);
  });
});
