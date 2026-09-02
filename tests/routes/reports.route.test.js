import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/services/reports.service.js', () => ({
  getSalesReport: vi.fn(),
  getPurchasesReport: vi.fn(),
  getProfitReport: vi.fn(),
  getInventoryReport: vi.fn(),
  getCustomersReport: vi.fn(),
  getSuppliersReport: vi.fn(),
}));

const reportsService = await import('../../src/services/reports.service.js');
const { createApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/config/jwt.js');

const authHeader = () => ({ Authorization: `Bearer ${signAccessToken({ deviceId: 'd1' })}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('report routes require authentication', () => {
  it('rejects every report route without a token', async () => {
    const app = createApp();
    expect((await request(app).get('/api/reports/sales')).status).toBe(401);
    expect((await request(app).get('/api/reports/purchases')).status).toBe(401);
    expect((await request(app).get('/api/reports/profit')).status).toBe(401);
    expect((await request(app).get('/api/reports/inventory')).status).toBe(401);
    expect((await request(app).get('/api/reports/customers')).status).toBe(401);
    expect((await request(app).get('/api/reports/suppliers')).status).toBe(401);
    expect(reportsService.getSalesReport).not.toHaveBeenCalled();
  });
});

describe('GET /api/reports/sales', () => {
  it('passes the date range through to the service', async () => {
    reportsService.getSalesReport.mockResolvedValue({ revenue: 1000 });
    const app = createApp();
    const res = await request(app).get('/api/reports/sales?from=2026-01-01&to=2026-01-31').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.revenue).toBe(1000);
    expect(reportsService.getSalesReport).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('works with no date range at all (all-time)', async () => {
    reportsService.getSalesReport.mockResolvedValue({ revenue: 5000 });
    const app = createApp();
    const res = await request(app).get('/api/reports/sales').set(authHeader());
    expect(res.status).toBe(200);
  });
});

describe('GET /api/reports/purchases', () => {
  it('delegates to the service', async () => {
    reportsService.getPurchasesReport.mockResolvedValue({ total: 2000, supplierBalances: [] });
    const app = createApp();
    const res = await request(app).get('/api/reports/purchases').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2000);
  });
});

describe('GET /api/reports/profit', () => {
  it('delegates to the service', async () => {
    reportsService.getProfitReport.mockResolvedValue({ net: 500 });
    const app = createApp();
    const res = await request(app).get('/api/reports/profit').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.net).toBe(500);
  });
});

describe('GET /api/reports/inventory', () => {
  it('ignores any query params and just returns the current snapshot', async () => {
    reportsService.getInventoryReport.mockResolvedValue({ productsCount: 10 });
    const app = createApp();
    const res = await request(app).get('/api/reports/inventory?from=2026-01-01').set(authHeader());
    expect(res.status).toBe(200);
    expect(reportsService.getInventoryReport).toHaveBeenCalledWith();
  });
});

describe('GET /api/reports/customers', () => {
  it('defaults limit to 8', async () => {
    reportsService.getCustomersReport.mockResolvedValue({ count: 5, topCustomers: [] });
    const app = createApp();
    await request(app).get('/api/reports/customers').set(authHeader());
    expect(reportsService.getCustomersReport).toHaveBeenCalledWith({ limit: 8 });
  });

  it('rejects a limit above the max', async () => {
    const app = createApp();
    const res = await request(app).get('/api/reports/customers?limit=999').set(authHeader());
    expect(res.status).toBe(400);
  });
});

describe('GET /api/reports/suppliers', () => {
  it('respects a custom limit', async () => {
    reportsService.getSuppliersReport.mockResolvedValue({ count: 2, topSuppliers: [] });
    const app = createApp();
    await request(app).get('/api/reports/suppliers?limit=3').set(authHeader());
    expect(reportsService.getSuppliersReport).toHaveBeenCalledWith({ limit: 3 });
  });
});
