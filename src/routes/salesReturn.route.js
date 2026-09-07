import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import * as controller from '../controllers/salesReturn.controller.js';

const router = Router();

router.use(requireAuth);

const objectId = (message) => z.string().refine((v) => mongoose.isValidObjectId(v), { message });

// Shape/sign check only — the real rules (product actually on this sale,
// quantity <= available-to-return, value <= customer's current remaining
// balance) all need database reads, so they're enforced in
// salesReturn.service.js, same pattern as sale/purchase discount.
const returnItemSchema = z.object({
  productId: objectId('معرّف منتج غير صالح'),
  quantity: z.coerce.number(),
});

const createReturnSchema = z.object({
  saleId: objectId('معرّف الفاتورة غير صالح'),
  items: z.array(returnItemSchema).min(1, 'اختر منتجًا واحدًا على الأقل للإرجاع'),
  // Required — generated once by the client per confirm action and reused
  // on retry, so the same accidental double-submit can never create two
  // return documents (unique index on SalesReturn.idempotencyKey).
  idempotencyKey: z.string().trim().min(1, 'طلب غير صالح').max(200),
});

const listQuerySchema = z.object({
  customerId: z.string().trim().optional(),
  saleId: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

router.get('/', validateQuery(listQuerySchema), controller.list);
router.get('/returnable/:saleId', validateObjectIdParam('saleId'), controller.getReturnable);
router.post('/', validateBody(createReturnSchema), controller.create);

export default router;
