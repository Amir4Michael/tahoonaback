import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateBody, validateQuery } from '../../src/middleware/validate.js';

const schema = z.object({
  name: z.string().trim().min(1),
  age: z.coerce.number().int().positive(),
});

describe('validateBody', () => {
  it('replaces req.body with the parsed/trimmed result and calls next() with no error', () => {
    const req = { body: { name: '  Ali  ', age: '30' } };
    const next = vi.fn();

    validateBody(schema)(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ name: 'Ali', age: 30 });
  });

  it('rejects a missing required field with a 400 AppError', () => {
    const req = { body: { age: 30 } };
    const next = vi.fn();

    validateBody(schema)(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
    expect(err.details.name).toBeDefined();
  });

  it('rejects a field failing its constraint', () => {
    const req = { body: { name: 'Ali', age: -5 } };
    const next = vi.fn();

    validateBody(schema)(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
    expect(err.details.age).toBeDefined();
  });
});

describe('validateQuery', () => {
  it('stores the parsed/coerced result on req.validatedQuery, never touching req.query', () => {
    const req = { query: { name: '  Sara ', age: '25' } };
    const next = vi.fn();

    validateQuery(schema)(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedQuery).toEqual({ name: 'Sara', age: 25 });
    expect(req.query).toEqual({ name: '  Sara ', age: '25' }); // untouched
  });

  it('rejects invalid query params with a 400 AppError', () => {
    const req = { query: { age: 'not-a-number' } };
    const next = vi.fn();

    validateQuery(schema)(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
  });
});
