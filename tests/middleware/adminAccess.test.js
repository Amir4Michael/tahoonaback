import { describe, it, expect, vi, afterEach } from 'vitest';

const ORIGINAL_KEY = process.env.ADMIN_READONLY_KEY;

function mockReq(headers = {}) {
  return { headers, originalUrl: '/api/admin/products', ip: '127.0.0.1' };
}

describe('requireAdminReadKey', () => {
  afterEach(() => {
    vi.resetModules();
    process.env.ADMIN_READONLY_KEY = ORIGINAL_KEY;
  });

  it('rejects with 503 when ADMIN_READONLY_KEY is not configured', async () => {
    process.env.ADMIN_READONLY_KEY = '';
    vi.resetModules();
    const { requireAdminReadKey } = await import('../../src/middleware/adminAccess.js');

    const next = vi.fn();
    requireAdminReadKey(mockReq({}), {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(503);
  });

  it('rejects a missing X-Admin-Key header', async () => {
    process.env.ADMIN_READONLY_KEY = 'the-real-key';
    vi.resetModules();
    const { requireAdminReadKey } = await import('../../src/middleware/adminAccess.js');

    const next = vi.fn();
    requireAdminReadKey(mockReq({}), {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('rejects an incorrect key', async () => {
    process.env.ADMIN_READONLY_KEY = 'the-real-key';
    vi.resetModules();
    const { requireAdminReadKey } = await import('../../src/middleware/adminAccess.js');

    const next = vi.fn();
    requireAdminReadKey(mockReq({ 'x-admin-key': 'wrong-key' }), {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('rejects a key of a different length without throwing', async () => {
    process.env.ADMIN_READONLY_KEY = 'the-real-key';
    vi.resetModules();
    const { requireAdminReadKey } = await import('../../src/middleware/adminAccess.js');

    const next = vi.fn();
    expect(() => requireAdminReadKey(mockReq({ 'x-admin-key': 'short' }), {}, next)).not.toThrow();

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('calls next() with no error and flags the request for a correct key', async () => {
    process.env.ADMIN_READONLY_KEY = 'the-real-key';
    vi.resetModules();
    const { requireAdminReadKey } = await import('../../src/middleware/adminAccess.js');

    const req = mockReq({ 'x-admin-key': 'the-real-key' });
    const next = vi.fn();
    requireAdminReadKey(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.isAdminReadOnly).toBe(true);
  });
});
