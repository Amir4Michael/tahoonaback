import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import * as controller from '../controllers/supplierPayment.controller.js';

const router = Router();

router.use(requireAuth);

const objectId = (message) => z.string().refine((v) => mongoose.isValidObjectId(v), { message });

// Shape/sign check only — the real rule (amount <= what we currently owe
// this supplier) needs a database read, so it's enforced in
// supplierPayment.service.js, same pattern as customer payments.
const createPaymentSchema = z.object({
  supplierId: objectId('معرّف مورد غير صالح'),
  amount: z.coerce.number().positive('قيمة السداد يجب أن تكون أكبر من صفر'),
  note: z.string().trim().max(500).optional().default(''),
  // Optional duplicate-submission guard — see supplierPayment.service.js.
  idempotencyKey: z.string().trim().max(200).optional(),
});

const listPaymentsQuerySchema = z.object({
  supplierId: objectId('معرّف مورد غير صالح'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

router.get('/', validateQuery(listPaymentsQuerySchema), controller.list);
router.post('/', validateBody(createPaymentSchema), controller.create);

export default router;
