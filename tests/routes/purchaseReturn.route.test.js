import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../../src/services/purchaseReturn.service.js', () => ({
  listPurchaseReturns: vi.fn(),
  getReturnableForPurchase: vi.fn(),
  createPurchaseReturn: vi.fn(),
}));

const purchaseReturnService = await import('../../src/services/purchaseReturn.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });
const validId = () => new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('purchase-return routes require authentication', () => {
  it('rejects list/getReturnable/create without a token', async () => {
    const app = createApp();
    expect((await request(app).get(`/api/purchase-returns?supplierId=${validId()}`)).status).toBe(401);
    expect((await request(app).get(`/api/purchase-returns/returnable/${validId()}`)).status).toBe(401);
    expect((await request(app).post('/api/purchase-returns').send({})).status).toBe(401);
    expect(purchaseReturnService.createPurchaseReturn).not.toHaveBeenCalled();
  });
});

describe('GET /api/purchase-returns', () => {
  it('rejects a request with neither supplierId nor purchaseId', async () => {
    purchaseReturnService.listPurchaseReturns.mockRejectedValue(
      Object.assign(new Error('حدد موردًا أو عملية شراء'), { statusCode: 400, isOperational: true }),
    );
    const app = createApp();
    const res = await request(app).get('/api/purchase-returns').set(authHeader());
    expect(res.status).toBe(400);
  });

  it('delegates to the service with the given supplierId', async () => {
    purchaseReturnService.listPurchaseReturns.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    const app = createApp();
    const id = validId();
    const res = await request(app).get(`/api/purchase-returns?supplierId=${id}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(purchaseReturnService.listPurchaseReturns).toHaveBeenCalledWith(expect.objectContaining({ supplierId: id, page: 1, limit: 20 }));
  });
});

describe('GET /api/purchase-returns/returnable/:purchaseId', () => {
  it('rejects a malformed purchaseId', async () => {
    const app = createApp();
    const res = await request(app).get('/api/purchase-returns/returnable/bad-id').set(authHeader());
    expect(res.status).toBe(400);
    expect(purchaseReturnService.getReturnableForPurchase).not.toHaveBeenCalled();
  });

  it('returns the returnable breakdown on success', async () => {
    purchaseReturnService.getReturnableForPurchase.mockResolvedValue({
      purchaseId: 'purchase-1',
      items: [{ productId: 'p1', originalQuantity: 10, alreadyReturnedQuantity: 3, availableToReturn: 7 }],
    });
    const app = createApp();
    const res = await request(app).get(`/api/purchase-returns/returnable/${validId()}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].availableToReturn).toBe(7);
  });
});

describe('POST /api/purchase-returns', () => {
  it('rejects a missing purchaseId', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/purchase-returns')
      .set(authHeader())
      .send({ items: [{ productId: validId(), quantity: 1 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(400);
    expect(purchaseReturnService.createPurchaseReturn).not.toHaveBeenCalled();
  });

  it('rejects an empty items array', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/purchase-returns')
      .set(authHeader())
      .send({ purchaseId: validId(), items: [], idempotencyKey: 'k1' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing idempotencyKey', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/purchase-returns')
      .set(authHeader())
      .send({ purchaseId: validId(), items: [{ productId: validId(), quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(purchaseReturnService.createPurchaseReturn).not.toHaveBeenCalled();
  });

  it('rejects a malformed productId inside an item', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/purchase-returns')
      .set(authHeader())
      .send({ purchaseId: validId(), items: [{ productId: 'bad', quantity: 1 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(400);
  });

  it('delegates a valid return to the service and returns 201', async () => {
    purchaseReturnService.createPurchaseReturn.mockResolvedValue({ _id: 'r1', totalReturnAmount: 300 });
    const app = createApp();
    const res = await request(app)
      .post('/api/purchase-returns')
      .set(authHeader())
      .send({ purchaseId: validId(), items: [{ productId: validId(), quantity: 3 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(201);
    expect(res.body.data.totalReturnAmount).toBe(300);
  });

  it('propagates a 409 from the service when physical stock is insufficient to send back', async () => {
    const err = new Error('الكمية المطلوب إرجاعها لم تعد متاحة في المخزون');
    err.statusCode = 409;
    err.isOperational = true;
    purchaseReturnService.createPurchaseReturn.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/purchase-returns')
      .set(authHeader())
      .send({ purchaseId: validId(), items: [{ productId: validId(), quantity: 3 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(409);
  });

  it('propagates a 400 from the service when the return exceeds the supplier balance (EXCEEDS_REMAINING)', async () => {
    const err = new Error('قيمة المرتجع أكبر من المتبقي المستحق لهذا المورد');
    err.statusCode = 400;
    err.isOperational = true;
    err.details = { code: 'EXCEEDS_REMAINING' };
    purchaseReturnService.createPurchaseReturn.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/purchase-returns')
      .set(authHeader())
      .send({ purchaseId: validId(), items: [{ productId: validId(), quantity: 1 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(400);
  });

  it('propagates a 404 from the service when the purchase does not exist', async () => {
    const err = new Error('عملية الشراء غير موجودة');
    err.statusCode = 404;
    err.isOperational = true;
    purchaseReturnService.createPurchaseReturn.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/purchase-returns')
      .set(authHeader())
      .send({ purchaseId: validId(), items: [{ productId: validId(), quantity: 1 }], idempotencyKey: 'k1' });
    expect(res.status).toBe(404);
  });
});
