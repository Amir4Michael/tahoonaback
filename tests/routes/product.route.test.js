import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

vi.mock('../../src/services/product.service.js', () => ({
  listProducts: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));

const productService = await import('../../src/services/product.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });
const validId = () => new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('product routes require authentication', () => {
  it('rejects every route without a token', async () => {
    const app = createApp();
    const id = validId();

    expect((await request(app).get('/api/products')).status).toBe(401);
    expect((await request(app).get(`/api/products/${id}`)).status).toBe(401);
    expect((await request(app).post('/api/products').send({ name: 'x', code: 'y' })).status).toBe(401);
    expect((await request(app).patch(`/api/products/${id}`).send({ name: 'x' })).status).toBe(401);
    expect((await request(app).delete(`/api/products/${id}`)).status).toBe(401);

    expect(productService.listProducts).not.toHaveBeenCalled();
  });
});

describe('GET /api/products', () => {
  it('applies query defaults and returns items + pagination', async () => {
    productService.listProducts.mockResolvedValue({
      items: [{ name: 'فلتر زيت' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const app = createApp();
    const res = await request(app).get('/api/products').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, filter: 'all', sort: 'name' }),
    );
  });

  it('rejects an invalid filter value with 400', async () => {
    const app = createApp();
    const res = await request(app).get('/api/products?filter=bogus').set(authHeader());
    expect(res.status).toBe(400);
    expect(productService.listProducts).not.toHaveBeenCalled();
  });

  it('rejects a limit above the max with 400', async () => {
    const app = createApp();
    const res = await request(app).get('/api/products?limit=999').set(authHeader());
    expect(res.status).toBe(400);
  });

  it('passes through a valid search/filter/sort combination', async () => {
    productService.listProducts.mockResolvedValue({ items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } });
    const app = createApp();
    await request(app).get('/api/products?search=زيت&filter=low&sort=profit&limit=10').set(authHeader());
    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'زيت', filter: 'low', sort: 'profit', limit: 10 }),
    );
  });
});

describe('GET /api/products/:id', () => {
  it('rejects a malformed id with 400 before calling the service', async () => {
    const app = createApp();
    const res = await request(app).get('/api/products/not-an-id').set(authHeader());
    expect(res.status).toBe(400);
    expect(productService.getProduct).not.toHaveBeenCalled();
  });

  it('returns 404 when the service reports the product missing', async () => {
    const err = new Error('المنتج غير موجود');
    err.statusCode = 404;
    err.isOperational = true;
    productService.getProduct.mockRejectedValue(err);

    const app = createApp();
    const res = await request(app).get(`/api/products/${validId()}`).set(authHeader());
    expect(res.status).toBe(404);
  });

  it('returns the product on success', async () => {
    productService.getProduct.mockResolvedValue({ name: 'فلتر زيت' });
    const app = createApp();
    const res = await request(app).get(`/api/products/${validId()}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('فلتر زيت');
  });
});

describe('POST /api/products', () => {
  it('rejects a missing name/code with 400', async () => {
    const app = createApp();
    const res = await request(app).post('/api/products').set(authHeader()).send({});
    expect(res.status).toBe(400);
    expect(productService.createProduct).not.toHaveBeenCalled();
  });

  it('applies zod defaults for omitted numeric/text fields on create', async () => {
    productService.createProduct.mockResolvedValue({ name: 'فلتر', code: 'P-1' });
    const app = createApp();
    const res = await request(app).post('/api/products').set(authHeader()).send({ name: 'فلتر', code: 'P-1' });

    expect(res.status).toBe(201);
    expect(productService.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ purchasePrice: 0, salePrice: 0, quantity: 0, minQuantity: 0, notes: '', image: '' }),
    );
  });

  it('propagates a 409 duplicate-code error from the service', async () => {
    const err = new Error('كود المنتج مستخدم من قبل');
    err.statusCode = 409;
    err.isOperational = true;
    err.details = { code: 'DUPLICATE_CODE' };
    productService.createProduct.mockRejectedValue(err);

    const app = createApp();
    const res = await request(app).post('/api/products').set(authHeader()).send({ name: 'x', code: 'DUP' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('DUPLICATE_CODE');
  });
});

describe('PATCH /api/products/:id', () => {
  it('rejects a malformed id before validating the body', async () => {
    const app = createApp();
    const res = await request(app).patch('/api/products/bad-id').set(authHeader()).send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(productService.updateProduct).not.toHaveBeenCalled();
  });

  it('does NOT inject defaults for omitted fields (true partial update at the HTTP layer too)', async () => {
    productService.updateProduct.mockResolvedValue({ name: 'اسم جديد' });
    const app = createApp();
    const id = validId();
    const res = await request(app).patch(`/api/products/${id}`).set(authHeader()).send({ name: 'اسم جديد' });

    expect(res.status).toBe(200);
    const [, sentBody] = productService.updateProduct.mock.calls[0];
    expect(sentBody).toEqual({ name: 'اسم جديد' });
    expect(sentBody.purchasePrice).toBeUndefined();
  });

  it('rejects an invalid value (negative price) with 400', async () => {
    const app = createApp();
    const res = await request(app).patch(`/api/products/${validId()}`).set(authHeader()).send({ salePrice: -5 });
    expect(res.status).toBe(400);
    expect(productService.updateProduct).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/products/:id', () => {
  it('rejects a malformed id', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/products/bad-id').set(authHeader());
    expect(res.status).toBe(400);
  });

  it('deletes successfully on a valid id', async () => {
    productService.deleteProduct.mockResolvedValue({ success: true });
    const app = createApp();
    const id = validId();
    const res = await request(app).delete(`/api/products/${id}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(productService.deleteProduct).toHaveBeenCalledWith(id);
  });
});
