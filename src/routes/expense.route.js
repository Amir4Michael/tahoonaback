import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import * as controller from '../controllers/expense.controller.js';

const router = Router();

router.use(requireAuth);

const createSchema = z.object({
  reason: z.string().trim().min(1, 'أدخل سبب المصروف'),
  amount: z.coerce.number(),
  date: z.string().trim().optional(),
  notes: z.string().trim().max(1000).optional().default(''),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  reason: z.string().trim().max(200).optional().default('all'),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

router.get('/', validateQuery(listQuerySchema), controller.list);
router.get('/summary', controller.summary);
router.post('/', validateBody(createSchema), controller.create);
router.delete('/:id', validateObjectIdParam(), controller.remove);

export default router;
