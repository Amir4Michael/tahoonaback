import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { createPersonRouter } from '../../src/routes/personRoutes.js';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler.js';
import { signAccessToken } from '../../src/config/jwt.js';

function fakeService() {
  return {
    list: vi.fn(),
    getOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
}

function appWith(service) {
  const app = express();
  app.use(express.json());
  app.use('/api/people', createPersonRouter(service));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });
const validId = () => new mongoose.Types.ObjectId().toString();

let service;
beforeEach(() => {
  vi.clearAllMocks();
  service = fakeService();
});

describe('createPersonRouter — auth', () => {
  it('rejects every route without a token', async () => {
    const app = appWith(service);
    const id = validId();

    expect((await request(app).get('/api/people')).status).toBe(401);
    expect((await request(app).get(`/api/people/${id}`)).status).toBe(401);
    expect((await request(app).post('/api/people').send({ name: 'x' })).status).toBe(401);
    expect((await request(app).patch(`/api/people/${id}`).send({ name: 'x' })).status).toBe(401);
    expect((await request(app).delete(`/api/people/${id}`)).status).toBe(401);

    expect(service.list).not.toHaveBeenCalled();
  });
});

describe('GET /', () => {
  it('applies query defaults and returns items + pagination', async () => {
    service.list.mockResolvedValue({ items: [{ name: 'أحمد' }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    const app = appWith(service);
    const res = await request(app).get('/api/people').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
  });

  it('rejects a limit above the max with 400', async () => {
    const app = appWith(service);
    const res = await request(app).get('/api/people?limit=999').set(authHeader());
    expect(res.status).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
  });
});

describe('GET /:id', () => {
  it('rejects a malformed id before calling the service', async () => {
    const app = appWith(service);
    const res = await request(app).get('/api/people/bad-id').set(authHeader());
    expect(res.status).toBe(400);
    expect(service.getOne).not.toHaveBeenCalled();
  });

  it('propagates a 404 from the service', async () => {
    const err = new Error('غير موجود');
    err.statusCode = 404;
    err.isOperational = true;
    service.getOne.mockRejectedValue(err);
    const app = appWith(service);
    const res = await request(app).get(`/api/people/${validId()}`).set(authHeader());
    expect(res.status).toBe(404);
  });
});

describe('POST /', () => {
  it('rejects a missing name with 400', async () => {
    const app = appWith(service);
    const res = await request(app).post('/api/people').set(authHeader()).send({});
    expect(res.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('defaults phone/address to empty strings and returns 201', async () => {
    service.create.mockResolvedValue({ name: 'أحمد' });
    const app = appWith(service);
    const res = await request(app).post('/api/people').set(authHeader()).send({ name: 'أحمد' });
    expect(res.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith({ name: 'أحمد', phone: '', address: '' });
  });

  it('propagates a 409 delete-blocked-style error from the service on create too (e.g. any AppError)', async () => {
    const err = new Error('تعارض');
    err.statusCode = 409;
    err.isOperational = true;
    service.create.mockRejectedValue(err);
    const app = appWith(service);
    const res = await request(app).post('/api/people').set(authHeader()).send({ name: 'أحمد' });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /:id', () => {
  it('does not inject defaults for omitted fields', async () => {
    service.update.mockResolvedValue({ name: 'اسم جديد' });
    const app = appWith(service);
    const id = validId();
    await request(app).patch(`/api/people/${id}`).set(authHeader()).send({ name: 'اسم جديد' });
    const [, sentBody] = service.update.mock.calls[0];
    expect(sentBody).toEqual({ name: 'اسم جديد' });
  });

  it('rejects a malformed id before validating the body', async () => {
    const app = appWith(service);
    const res = await request(app).patch('/api/people/bad-id').set(authHeader()).send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /:id', () => {
  it('rejects a malformed id', async () => {
    const app = appWith(service);
    const res = await request(app).delete('/api/people/bad-id').set(authHeader());
    expect(res.status).toBe(400);
  });

  it('propagates the delete-blocked 409 from the service', async () => {
    const err = new Error('لا يمكن حذف عميل له فواتير مسجلة');
    err.statusCode = 409;
    err.isOperational = true;
    err.details = { code: 'HAS_TRANSACTIONS' };
    service.remove.mockRejectedValue(err);
    const app = appWith(service);
    const res = await request(app).delete(`/api/people/${validId()}`).set(authHeader());
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe('HAS_TRANSACTIONS');
  });

  it('deletes successfully on a valid id', async () => {
    service.remove.mockResolvedValue({ success: true });
    const app = appWith(service);
    const id = validId();
    const res = await request(app).delete(`/api/people/${id}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(service.remove).toHaveBeenCalledWith(id);
  });
});
