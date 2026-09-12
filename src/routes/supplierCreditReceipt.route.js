import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import * as controller from '../controllers/supplierCreditReceipt.controller.js';

const router = Router();

router.use(requireAuth);

const objectId = (message) => z.string().refine((v) => mongoose.isValidObjectId(v), { message });

// Shape/sign check only — the real rule (amount <= supplier's current
// creditOwed) needs a database read, so it's enforced in
// supplierCreditReceipt.service.js.
const createReceiptSchema = z.object({
  supplierId: objectId('معرّف مورد غير صالح'),
  amount: z.coerce.number().positive('قيمة الاستلام يجب أن تكون أكبر من صفر'),
  note: z.string().trim().max(500).optional().default(''),
  idempotencyKey: z.string().trim().max(200).optional(),
});

const listReceiptsQuerySchema = z.object({
  supplierId: objectId('معرّف مورد غير صالح'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

router.get('/', validateQuery(listReceiptsQuerySchema), controller.list);
router.post('/', validateBody(createReceiptSchema), controller.create);
router.delete('/:id', validateObjectIdParam(), controller.remove);

export default router;