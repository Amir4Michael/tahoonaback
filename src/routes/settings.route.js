import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import * as controller from '../controllers/settings.controller.js';

const router = Router();

router.use(requireAuth);

// Deliberately no accessCode/password field here — see settings.service.js.
const updateSchema = z.object({
  shopName: z.string().trim().min(1).max(200).optional(),
  ownerName: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  invoiceFooter: z.string().trim().max(500).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
});

router.get('/', controller.get);
router.patch('/', validateBody(updateSchema), controller.update);

export default router;
