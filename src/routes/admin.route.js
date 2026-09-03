import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAdminReadKey } from '../middleware/adminAccess.js';
import { validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import { ACTIVITY_TYPES } from '../models/constants.js';

import * as productController from '../controllers/product.controller.js';
import * as saleController from '../controllers/sale.controller.js';
import * as purchaseController from '../controllers/purchase.controller.js';
import * as cashboxController from '../controllers/cashbox.controller.js';
import * as expenseController from '../controllers/expense.controller.js';
import * as reportsController from '../controllers/reports.controller.js';
import * as activityController from '../controllers/activity.controller.js';
import * as auditLogController from '../controllers/auditLog.controller.js';
import * as settingsController from '../controllers/settings.controller.js';
import { customerService } from '../services/customer.service.js';
import { supplierService } from '../services/supplier.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * Read-only mirror of every entity in the system, for the future System 5
 * (a separate, central, cross-shop reporting application — not a role
 * within this one). Every handler here is a direct import of the SAME
 * controller function the normal authenticated routes use — nothing about
 * how the data is fetched, shaped, or paginated is reimplemented, so this
 * file cannot drift from the real business logic. What's different is only:
 *   1. The gate — `requireAdminReadKey` instead of `requireAuth` (see
 *      middleware/adminAccess.js for why those are kept separate).
 *   2. The verbs — this router registers ONLY `router.get(...)` calls.
 *      There is no POST/PATCH/PUT/DELETE anywhere below, and none should
 *      ever be added — that is what makes "read-only" a structural
 *      property of this file rather than a permission that could be
 *      accidentally left off one route.
 *
 * Customer/Supplier don't have shared controller exports (personRoutes.js
 * inlines its handlers), so those two call `personService` directly instead
 * — still the exact same service functions the authenticated routes use.
 */

const router = Router();

// Stricter than the app-wide limiter (see app.js) — this key is long-lived
// and meant for one server-to-server caller (System 5), so far fewer
// requests are ever legitimate, and a tighter cap slows down key-guessing.
router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

router.use(requireAdminReadKey);

const paginationSchema = {
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
};
const dateRange = {
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
};

// ── Products / Inventory ────────────────────────────────────────────────
const productListQuerySchema = z.object({
  ...paginationSchema,
  search: z.string().trim().max(200).optional(),
  filter: z.enum(['all', 'low', 'out', 'available']).optional().default('all'),
  sort: z.enum(['name', 'qtyAsc', 'qtyDesc', 'profit']).optional().default('name'),
});
router.get('/products', validateQuery(productListQuerySchema), productController.list);
router.get('/products/:id', validateObjectIdParam(), productController.getOne);

// ── Customers ────────────────────────────────────────────────────────────
const personListQuerySchema = z.object({
  ...paginationSchema,
  search: z.string().trim().max(200).optional(),
});
router.get(
  '/customers',
  validateQuery(personListQuerySchema),
  asyncHandler(async (req, res) => {
    const { page, limit, search } = req.validatedQuery;
    const result = await customerService.list({ page, limit, search });
    res.json({ success: true, data: result.items, pagination: result.pagination });
  }),
);
router.get(
  '/customers/:id',
  validateObjectIdParam(),
  asyncHandler(async (req, res) => {
    const customer = await customerService.getOne(req.params.id);
    res.json({ success: true, data: customer });
  }),
);

// ── Suppliers ────────────────────────────────────────────────────────────
router.get(
  '/suppliers',
  validateQuery(personListQuerySchema),
  asyncHandler(async (req, res) => {
    const { page, limit, search } = req.validatedQuery;
    const result = await supplierService.list({ page, limit, search });
    res.json({ success: true, data: result.items, pagination: result.pagination });
  }),
);
router.get(
  '/suppliers/:id',
  validateObjectIdParam(),
  asyncHandler(async (req, res) => {
    const supplier = await supplierService.getOne(req.params.id);
    res.json({ success: true, data: supplier });
  }),
);

// ── Sales ────────────────────────────────────────────────────────────────
const listSalesQuerySchema = z.object({
  ...paginationSchema,
  search: z.string().trim().max(200).optional(),
  customerId: z.string().trim().optional(),
  paymentMethod: z.enum(['all', 'cash', 'credit']).optional().default('all'),
  ...dateRange,
});
router.get('/sales', validateQuery(listSalesQuerySchema), saleController.list);
router.get('/sales/:id', validateObjectIdParam(), saleController.getOne);

// ── Purchases ────────────────────────────────────────────────────────────
const listPurchasesQuerySchema = z.object({
  ...paginationSchema,
  search: z.string().trim().max(200).optional(),
  supplierId: z.string().trim().optional(),
  paymentMethod: z.enum(['all', 'cash', 'credit']).optional().default('all'),
  ...dateRange,
});
router.get('/purchases', validateQuery(listPurchasesQuerySchema), purchaseController.list);
router.get('/purchases/:id', validateObjectIdParam(), purchaseController.getOne);

// ── Cashbox ──────────────────────────────────────────────────────────────
const cashboxListQuerySchema = z.object({
  ...paginationSchema,
  type: z.enum(['all', 'in', 'out']).optional().default('all'),
  search: z.string().trim().max(200).optional(),
  ...dateRange,
});
router.get('/cashbox', validateQuery(cashboxListQuerySchema), cashboxController.list);
router.get('/cashbox/summary', cashboxController.summary);

// ── Expenses ─────────────────────────────────────────────────────────────
const expenseListQuerySchema = z.object({
  ...paginationSchema,
  reason: z.string().trim().max(200).optional().default('all'),
  ...dateRange,
});
router.get('/expenses', validateQuery(expenseListQuerySchema), expenseController.list);
router.get('/expenses/summary', expenseController.summary);

// ── Activity log & Audit log (history) ──────────────────────────────────
const activityListQuerySchema = z.object({
  ...paginationSchema,
  type: z.enum(['all', ...ACTIVITY_TYPES]).optional().default('all'),
  ...dateRange,
});
router.get('/activity', validateQuery(activityListQuerySchema), activityController.list);

const auditLogListQuerySchema = z.object({
  ...paginationSchema,
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(50).optional(),
  actorDeviceId: z.string().trim().max(200).optional(),
  ...dateRange,
});
router.get('/audit-log', validateQuery(auditLogListQuerySchema), auditLogController.list);

// ── Settings (shop name/branding/contact info — read-only here) ─────────
router.get('/settings', settingsController.get);

// ── Reports & statistics (same aggregate endpoints System 1's own
//    dashboard uses) ──────────────────────────────────────────────────────
const reportsDateRangeSchema = z.object(dateRange);
const topListSchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(8),
});
router.get('/reports/sales', validateQuery(reportsDateRangeSchema), reportsController.sales);
router.get('/reports/purchases', validateQuery(reportsDateRangeSchema), reportsController.purchases);
router.get('/reports/profit', validateQuery(reportsDateRangeSchema), reportsController.profit);
router.get('/reports/inventory', reportsController.inventory);
router.get('/reports/customers', validateQuery(topListSchema), reportsController.customers);
router.get('/reports/suppliers', validateQuery(topListSchema), reportsController.suppliers);

export default router;
