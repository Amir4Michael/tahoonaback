import { describe, it, expect, vi } from 'vitest';
import { requireAuth } from '../../src/middleware/auth.js';
import { signAccessToken } from '../../src/config/jwt.js';
import { getRequestContext } from '../../src/utils/requestContext.js';

function mockReq(headers = {}) {
  return { headers };
}

describe('requireAuth', () => {
  it('attaches req.auth.deviceId for a valid Bearer token and calls next() with no error', () => {
    const token = signAccessToken({ deviceId: 'device-1' });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const next = vi.fn();

    requireAuth(req, {}, next);

    expect(next).toHaveBeenCalledWith(); // called with no arguments = success
    expect(req.auth).toEqual({ deviceId: 'device-1' });
  });

  it('runs next() inside a request context carrying the deviceId, for downstream audit logging', () => {
    const token = signAccessToken({ deviceId: 'device-1' });
    const req = mockReq({ authorization: `Bearer ${token}` });
    let contextSeenDownstream;

    requireAuth(req, {}, () => {
      contextSeenDownstream = getRequestContext();
    });

    expect(contextSeenDownstream).toEqual({ deviceId: 'device-1' });
    expect(getRequestContext()).toBeUndefined(); // doesn't leak past the call
  });

  it('rejects a missing Authorization header', () => {
    const req = mockReq({});
    const next = vi.fn();

    requireAuth(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('rejects a non-Bearer scheme', () => {
    const req = mockReq({ authorization: 'Basic dXNlcjpwYXNz' });
    const next = vi.fn();

    requireAuth(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('rejects a malformed/invalid token', () => {
    const req = mockReq({ authorization: 'Bearer not-a-real-token' });
    const next = vi.fn();

    requireAuth(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });
});
