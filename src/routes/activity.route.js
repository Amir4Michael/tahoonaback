import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import { ACTIVITY_TYPES } from '../models/constants.js';
import * as controller from '../controllers/activity.controller.js';

const router = Router();

router.use(requireAuth);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  type: z.enum(['all', ...ACTIVITY_TYPES]).optional().default('all'),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

// GET only — entries are written internally by recordActivity() as a side
// effect of other operations (product/sale/purchase/... mutations), never
// through this API directly.
router.get('/', validateQuery(listQuerySchema), controller.list);

export default router;
