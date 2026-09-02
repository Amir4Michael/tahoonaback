import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/settings.service.js', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

const settingsService = await import('../../src/services/settings.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settings routes require authentication', () => {
  it('rejects GET/PATCH without a token', async () => {
    const app = createApp();
    expect((await request(app).get('/api/settings')).status).toBe(401);
    expect((await request(app).patch('/api/settings').send({})).status).toBe(401);
    expect(settingsService.getSettings).not.toHaveBeenCalled();
  });
});

describe('GET /api/settings', () => {
  it('returns the service result', async () => {
    settingsService.getSettings.mockResolvedValue({ shopName: 'محل النور', lowStockThreshold: 5 });
    const app = createApp();
    const res = await request(app).get('/api/settings').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.shopName).toBe('محل النور');
  });
});

describe('PATCH /api/settings', () => {
  it('accepts a partial update and forwards only what was sent', async () => {
    settingsService.updateSettings.mockResolvedValue({ shopName: 'اسم جديد' });
    const app = createApp();
    const res = await request(app).patch('/api/settings').set(authHeader()).send({ shopName: 'اسم جديد' });
    expect(res.status).toBe(200);
    expect(settingsService.updateSettings).toHaveBeenCalledWith({ shopName: 'اسم جديد' });
  });

  it('rejects an empty shopName (min length 1)', async () => {
    const app = createApp();
    const res = await request(app).patch('/api/settings').set(authHeader()).send({ shopName: '' });
    expect(res.status).toBe(400);
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('silently strips an accessCode/password field rather than accepting or erroring on it', async () => {
    settingsService.updateSettings.mockResolvedValue({ shopName: 'x' });
    const app = createApp();
    await request(app).patch('/api/settings').set(authHeader()).send({ shopName: 'x', accessCode: '123456' });
    const [sentBody] = settingsService.updateSettings.mock.calls[0];
    expect(sentBody.accessCode).toBeUndefined();
  });

  it('rejects a negative lowStockThreshold', async () => {
    const app = createApp();
    const res = await request(app).patch('/api/settings').set(authHeader()).send({ lowStockThreshold: -1 });
    expect(res.status).toBe(400);
  });
});
