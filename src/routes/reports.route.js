import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import * as controller from '../controllers/reports.controller.js';

const router = Router();

router.use(requireAuth);

// 'from'/'to' are plain optional date-range filters (YYYY-MM-DD) — same
// shape as every other list endpoint's date range (Sales/Purchases/
// Cashbox). The frontend's "today/week/month" period buttons are a pure UI
// convenience that resolves to concrete from/to dates before calling the
// API, not a concept the backend needs to know about.
const dateRangeSchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

const topListSchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(8),
});

router.get('/sales', validateQuery(dateRangeSchema), controller.sales);
router.get('/purchases', validateQuery(dateRangeSchema), controller.purchases);
router.get('/profit', validateQuery(dateRangeSchema), controller.profit);
router.get('/inventory', controller.inventory); // always a snapshot of now — no query params
router.get('/customers', validateQuery(topListSchema), controller.customers);
router.get('/suppliers', validateQuery(topListSchema), controller.suppliers);

export default router;
