import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

describe('app-level mounting of /api/customers and /api/suppliers', () => {
  it('both require authentication, confirming they are mounted with the real requireAuth-protected router', async () => {
    const app = createApp();
    expect((await request(app).get('/api/customers')).status).toBe(401);
    expect((await request(app).get('/api/suppliers')).status).toBe(401);
  });

  it('an unknown sub-path under either still 401s (auth runs before 404) — confirms router mount order', async () => {
    const app = createApp();
    expect((await request(app).get('/api/customers/whatever/nested')).status).toBe(401);
  });
});
