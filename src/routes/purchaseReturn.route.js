import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import * as controller from '../controllers/purchaseReturn.controller.js';

const router = Router();

router.use(requireAuth);

const objectId = (message) => z.string().refine((v) => mongoose.isValidObjectId(v), { message });

// Shape/sign check only — the real rules (product actually on this
// purchase, quantity <= available-to-return, quantity <= current stock,
// value <= what we currently owe the supplier) all need database reads, so
// they're enforced in purchaseReturn.service.js, same pattern as
// salesReturn.route.js.
const returnItemSchema = z.object({
  productId: objectId('معرّف منتج غير صالح'),
  quantity: z.coerce.number(),
});

const createReturnSchema = z.object({
  purchaseId: objectId('معرّف عملية الشراء غير صالح'),
  items: z.array(returnItemSchema).min(1, 'اختر منتجًا واحدًا على الأقل للإرجاع'),
  // Required — generated once by the client per confirm action and reused
  // on retry, so the same accidental double-submit can never create two
  // return documents (unique index on PurchaseReturn.idempotencyKey).
  idempotencyKey: z.string().trim().min(1, 'طلب غير صالح').max(200),
});

const listQuerySchema = z.object({
  supplierId: z.string().trim().optional(),
  purchaseId: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

router.get('/', validateQuery(listQuerySchema), controller.list);
router.get('/returnable/:purchaseId', validateObjectIdParam('purchaseId'), controller.getReturnable);
router.post('/', validateBody(createReturnSchema), controller.create);

export default router;
