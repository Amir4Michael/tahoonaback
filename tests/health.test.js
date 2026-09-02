import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('GET /api/health', () => {
  it('returns liveness status without requiring a database connection', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'ok' });
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });
});

describe('GET /api/health/db', () => {
  it('reports the current DB connection state without throwing', async () => {
    const res = await request(app).get('/api/health/db');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(['disconnected', 'connected', 'connecting', 'disconnecting']).toContain(res.body.db);
  });
});

describe('unknown routes', () => {
  it('returns a consistent 404 JSON error shape', async () => {
    const res = await request(app).get('/api/this-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('this-does-not-exist');
  });
});

describe('CORS', () => {
  it('allows requests with no Origin header (server-to-server / health checks)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});
