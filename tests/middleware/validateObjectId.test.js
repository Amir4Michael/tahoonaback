import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { validateObjectIdParam } from '../../src/middleware/validateObjectId.js';

describe('validateObjectIdParam', () => {
  it('calls next() with no error for a valid ObjectId', () => {
    const validId = new mongoose.Types.ObjectId().toString();
    const req = { params: { id: validId } };
    const next = vi.fn();

    validateObjectIdParam('id')(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a malformed id with a 400 AppError', () => {
    const req = { params: { id: 'not-an-object-id' } };
    const next = vi.fn();

    validateObjectIdParam('id')(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
  });

  it('defaults to the "id" param name', () => {
    const req = { params: { id: 'still-not-valid' } };
    const next = vi.fn();

    validateObjectIdParam()(req, {}, next);

    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });

  it('validates a differently-named param when given one', () => {
    const validId = new mongoose.Types.ObjectId().toString();
    const req = { params: { productId: validId } };
    const next = vi.fn();

    validateObjectIdParam('productId')(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });
});
