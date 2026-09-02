import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/upload.service.js', () => ({
  getUploadSignature: vi.fn(),
}));

const uploadService = await import('../../src/services/upload.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/uploads/signature requires authentication', () => {
  it('rejects without a token', async () => {
    const app = createApp();
    const res = await request(app).get('/api/uploads/signature');
    expect(res.status).toBe(401);
    expect(uploadService.getUploadSignature).not.toHaveBeenCalled();
  });
});

describe('GET /api/uploads/signature', () => {
  it('returns the signature payload for an authenticated request', async () => {
    uploadService.getUploadSignature.mockReturnValue({
      signature: 'sig', timestamp: 123, folder: 'system1/products', apiKey: 'key', cloudName: 'cloud',
    });
    const app = createApp();
    const res = await request(app).get('/api/uploads/signature').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ signature: 'sig', cloudName: 'cloud' });
  });

  it('propagates a 503 when Cloudinary is not configured', async () => {
    const err = new Error('رفع الصور غير مُفعّل حالياً على السيرفر');
    err.statusCode = 503;
    err.isOperational = true;
    uploadService.getUploadSignature.mockImplementation(() => { throw err; });
    const app = createApp();
    const res = await request(app).get('/api/uploads/signature').set(authHeader());
    expect(res.status).toBe(503);
  });
});

describe('uploads route has no write/upload endpoint', () => {
  it('POST is not allowed — image bytes never go through this backend', async () => {
    const app = createApp();
    const res = await request(app).post('/api/uploads/signature').set(authHeader());
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
  });
});
