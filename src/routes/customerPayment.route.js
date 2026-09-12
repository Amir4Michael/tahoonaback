import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import * as controller from '../controllers/customerPayment.controller.js';

const router = Router();

router.use(requireAuth);

const objectId = (message) => z.string().refine((v) => mongoose.isValidObjectId(v), { message });

// Shape/sign check only — the real rule (amount <= customer's current
// remaining balance) needs a database read, so it's enforced in
// customerPayment.service.js, same pattern as sale/purchase discount.
const createPaymentSchema = z.object({
  customerId: objectId('معرّف عميل غير صالح'),
  amount: z.coerce.number().positive('قيمة السداد يجب أن تكون أكبر من صفر'),
  note: z.string().trim().max(500).optional().default(''),
  // Optional duplicate-submission guard — see customerPayment.service.js.
  // Optional (unlike sales-returns) for backward compatibility with any
  // caller that predates this field.
  idempotencyKey: z.string().trim().max(200).optional(),
});

const listPaymentsQuerySchema = z.object({
  customerId: objectId('معرّف عميل غير صالح'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

router.get('/', validateQuery(listPaymentsQuerySchema), controller.list);
router.post('/', validateBody(createPaymentSchema), controller.create);
router.delete('/:id', validateObjectIdParam(), controller.remove);

export default router;