import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../../src/services/customerPayment.service.js', () => ({
  listCustomerPayments: vi.fn(),
  createCustomerPayment: vi.fn(),
}));

const customerPaymentService = await import('../../src/services/customerPayment.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });
const validId = () => new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('customer-payment routes require authentication', () => {
  it('rejects list/create without a token', async () => {
    const app = createApp();
    expect((await request(app).get(`/api/customer-payments?customerId=${validId()}`)).status).toBe(401);
    expect((await request(app).post('/api/customer-payments').send({})).status).toBe(401);
    expect(customerPaymentService.createCustomerPayment).not.toHaveBeenCalled();
  });
});

describe('GET /api/customer-payments', () => {
  it('rejects a missing customerId', async () => {
    const app = createApp();
    const res = await request(app).get('/api/customer-payments').set(authHeader());
    expect(res.status).toBe(400);
    expect(customerPaymentService.listCustomerPayments).not.toHaveBeenCalled();
  });

  it('rejects a malformed customerId', async () => {
    const app = createApp();
    const res = await request(app).get('/api/customer-payments?customerId=bad-id').set(authHeader());
    expect(res.status).toBe(400);
  });

  it('applies query defaults and delegates to the service', async () => {
    customerPaymentService.listCustomerPayments.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    const app = createApp();
    const id = validId();
    const res = await request(app).get(`/api/customer-payments?customerId=${id}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(customerPaymentService.listCustomerPayments).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: id, page: 1, limit: 20 }),
    );
  });
});

describe('POST /api/customer-payments', () => {
  it('rejects a missing customerId with 400 before calling the service', async () => {
    const app = createApp();
    const res = await request(app).post('/api/customer-payments').set(authHeader()).send({ amount: 100 });
    expect(res.status).toBe(400);
    expect(customerPaymentService.createCustomerPayment).not.toHaveBeenCalled();
  });

  it('rejects amount = 0 at the validation layer', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/customer-payments')
      .set(authHeader())
      .send({ customerId: validId(), amount: 0 });
    expect(res.status).toBe(400);
    expect(customerPaymentService.createCustomerPayment).not.toHaveBeenCalled();
  });

  it('rejects a negative amount at the validation layer', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/customer-payments')
      .set(authHeader())
      .send({ customerId: validId(), amount: -50 });
    expect(res.status).toBe(400);
    expect(customerPaymentService.createCustomerPayment).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric amount at the validation layer', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/customer-payments')
      .set(authHeader())
      .send({ customerId: validId(), amount: 'abc' });
    expect(res.status).toBe(400);
  });

  it('delegates a valid payment to the service and returns 201', async () => {
    customerPaymentService.createCustomerPayment.mockResolvedValue({ _id: 'p1', amount: 250, balanceAfter: 150 });
    const app = createApp();
    const id = validId();
    const res = await request(app)
      .post('/api/customer-payments')
      .set(authHeader())
      .send({ customerId: id, amount: 250 });
    expect(res.status).toBe(201);
    expect(res.body.data.balanceAfter).toBe(150);
    const [callArg] = customerPaymentService.createCustomerPayment.mock.calls[0];
    expect(callArg).toEqual({ customerId: id, amount: 250, note: '' });
  });

  it('propagates a 400 from the service when the amount exceeds the remaining balance', async () => {
    const err = new Error('مبلغ السداد أكبر من المتبقي على العميل');
    err.statusCode = 400;
    err.isOperational = true;
    customerPaymentService.createCustomerPayment.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/customer-payments')
      .set(authHeader())
      .send({ customerId: validId(), amount: 999999 });
    expect(res.status).toBe(400);
  });

  it('propagates a 404 from the service when the customer does not exist', async () => {
    const err = new Error('العميل غير موجود');
    err.statusCode = 404;
    err.isOperational = true;
    customerPaymentService.createCustomerPayment.mockRejectedValue(err);
    const app = createApp();
    const res = await request(app)
      .post('/api/customer-payments')
      .set(authHeader())
      .send({ customerId: validId(), amount: 100 });
    expect(res.status).toBe(404);
  });
});
