import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import * as controller from '../controllers/cashbox.controller.js';

const router = Router();

router.use(requireAuth);

// Business-rule validation (amount vs current balance for a withdrawal)
// needs a database read and lives in cashbox.service.js.
const createSchema = z.object({
  type: z.enum(['in', 'out']),
  amount: z.coerce.number(),
  reason: z.string().trim().min(1, 'أدخل سبب العملية'),
  date: z.string().trim().optional(), // 'YYYY-MM-DD', pinned to noon that day if given
  notes: z.string().trim().max(500).optional().default(''),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  type: z.enum(['all', 'in', 'out']).optional().default('all'),
  search: z.string().trim().max(200).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

router.get('/', validateQuery(listQuerySchema), controller.list);
router.get('/summary', controller.summary);
router.post('/', validateBody(createSchema), controller.create);
router.delete('/:id', validateObjectIdParam(), controller.remove);

export default router;