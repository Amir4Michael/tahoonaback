import { describe, it, expect, vi } from 'vitest';
import { AppError, errorHandler } from '../src/middleware/errorHandler.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('AppError', () => {
  it('carries statusCode, details, and marks itself operational', () => {
    const err = new AppError('الكمية غير كافية', 400, { productId: 'p1' });
    expect(err.message).toBe('الكمية غير كافية');
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ productId: 'p1' });
    expect(err.isOperational).toBe(true);
  });
});

describe('errorHandler', () => {
  it('exposes the message and details for operational errors', () => {
    const err = new AppError('عنصر غير موجود', 404, { id: 'x1' });
    const req = { originalUrl: '/api/products/x1', method: 'GET' };
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.message).toBe('عنصر غير موجود');
    expect(body.error.details).toEqual({ id: 'x1' });
  });

  it('hides the real message for non-operational (unexpected) errors', () => {
    const err = new Error('TypeError: cannot read property of undefined');
    const req = { originalUrl: '/api/whatever', method: 'POST' };
    const res = mockRes();

    errorHandler(err, req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.message).not.toContain('TypeError');
  });
});
