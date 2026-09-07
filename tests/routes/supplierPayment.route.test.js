import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../../src/services/supplierPayment.service.js', () => ({
  listSupplierPayments: vi.fn(),
  createSupplierPayment: vi.fn(),
}));

const supplierPaymentService = await import('../../src/services/supplierPayment.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });
const validId = () => new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('supplier-payment routes require authentication', () => {
  it('rejects list/create without a token', async () => {
    const app = createApp();
    expect((await request(app).get(`/api/supplier-payments?supplierId=${validId()}`)).status).toBe(401);
    expect((await request(app).post('/api/supplier-payments').send({})).status).toBe(401);
    expect(supplierPaymentService.createSupplierPayment).not.toHaveBeenCalled();
  });
});

describe('GET /api/supplier-payments', () => {
  it('rejects a missing supplierId', async () => {
    const app = createApp();
    const res = await request(app).get('/api/supplier-payments').set(authHeader());
    expect(res.status).toBe(400);
    expect(supplierPaymentService.listSupplierPayments).not.toHaveBeenCalled();
  });

  it('rejects a malformed supplierId', async () => {
    const app = createApp();
    const res = await request(app).get('/api/supplier-payments?supplierId=bad-id').set(authHeader());
    expect(res.status).toBe(400);
  });

  it('applies query defaults and delegates to the service', async () => {
    supplierPaymentService.listSupplierPayments.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    const app = createApp();
    const id = validId();
    const res = await request(app).get(`/api/supplier-payments?supplierId=${id}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(supplierPaymentService.listSupplierPayments).toHaveBeenCalledWith(
      expect.objectContaining({ supplierId: id, page: 1, limit: 20 }),
    );
  });
});

describe('POST /api/supplier-payments', () => {
  it('rejects a missing supplierId with 400 before calling the service', async () => {
    const app = createApp();
    const res = await request(app).post('/api/supplier-payments').set(authHeader()).send({ amount: 1000 });
    expect(res.status).toBe(400);
    expect(supplierPaymentService.createSupplierPayment).not.toHaveBeenCalled();
  });

  it('rejects amount = 0 at the validation layer', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/supplier-payments')
      .set(authHeader())
      .send({ supplierId: validId(), amount: 0 });
    expect(res.status).toBe(400);
    expect(supplierPaymentService.createSupplierPayment).not.toHaveBeenCalled();
  });

  it('rejects a negative amount at the validation layer', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/supplier-payments')
      .set(authHeader())
      .send({ supplierId: validId(), amount: -50 });
    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric amount at the validation layer', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/supplier-payments')
      .set(authHeader())
      .send({ supplierId: validId(), amount: 'abc' });
    expect(res.status).toBe(400);
  });

  it('delegates a valid payment to the service and returns 201', async () => {
    supplierPaymentService.createSupplierPayment.mockResolvedValue({ _id: 'p1', amount: 1000, balanceAfter: 1000 });
    const app = createApp();
    const id = validId();
    const res = await request(app)
      .post('/api/supplier-payments')
      .set(authHeader())
      .send({ supplierId: id, amount: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.data.balanceAfter).toBe(1000);
    const [callArg] = supplierPaymentService.createSupplierPayment.mock.calls[0];
    expect(callArg).toEqual({ supplierId: id, amount: 1000, note: '' });
  });

  it('propagates a 400 from the service when the amount exceeds the remaining balance', async () => {
    const err = new Error('مبلغ السداد أكبر من المتبقي المستحق لهذا المورد');
    err.statusCode = 400;
    err.isOperational = true;
    supplierPaymentService.createSupplierPayment.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/supplier-payments')
      .set(authHeader())
      .send({ supplierId: validId(), amount: 999999 });
    expect(res.status).toBe(400);
  });

  it('propagates a 404 from the service when the supplier does not exist', async () => {
    const err = new Error('المورد غير موجود');
    err.statusCode = 404;
    err.isOperational = true;
    supplierPaymentService.createSupplierPayment.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/supplier-payments')
      .set(authHeader())
      .send({ supplierId: validId(), amount: 100 });
    expect(res.status).toBe(404);
  });
});
