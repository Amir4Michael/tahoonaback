import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';
import * as controller from '../controllers/auditLog.controller.js';

const router = Router();

router.use(requireAuth);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(50).optional(),
  actorDeviceId: z.string().trim().max(200).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

// GET only — entries are written internally by services as a side effect of
// a mutation, never through this API. An editable/deletable audit log isn't
// one; there is deliberately no POST/PATCH/DELETE here.
router.get('/', validateQuery(listQuerySchema), controller.list);

export default router;
