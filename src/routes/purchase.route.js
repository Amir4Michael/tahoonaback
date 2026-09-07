import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import * as controller from '../controllers/purchase.controller.js';

const router = Router();

router.use(requireAuth);

const objectId = (message) => z.string().refine((v) => mongoose.isValidObjectId(v), { message });

// As with sales: business-rule validation (product existence, price/quantity
// checks with per-product Arabic messages) needs a database read and lives
// in purchase.service.js. This schema only validates shape/type.
const purchaseItemSchema = z.object({
  productId: objectId('معرّف منتج غير صالح'),
  quantity: z.coerce.number(),
  price: z.coerce.number(),
});

const createPurchaseSchema = z.object({
  supplierId: objectId('معرّف مورد غير صالح'),
  items: z.array(purchaseItemSchema).min(1, 'أضف منتجات لعملية الشراء'),
  paymentMethod: z.enum(['cash', 'credit']),
  paid: z.coerce.number().optional(),
  date: z.string().trim().optional(), // 'YYYY-MM-DD', backdating — service defaults to now if omitted
  notes: z.string().trim().max(1000).optional().default(''),
  // Flat (fixed-amount) purchase-level discount. Shape/sign check only —
  // the real rule (discount <= subtotal) needs the priced lines, which only
  // exist after the service reads each product, so it's enforced there
  // (see purchase.service.js).
  discount: z.coerce.number().min(0, 'قيمة الخصم غير صحيحة').optional(),
});

const listPurchasesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().trim().max(200).optional(),
  supplierId: z.string().trim().optional(),
  paymentMethod: z.enum(['all', 'cash', 'credit']).optional().default('all'),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

router.get('/', validateQuery(listPurchasesQuerySchema), controller.list);
router.get('/:id', validateObjectIdParam(), controller.getOne);
router.post('/', validateBody(createPurchaseSchema), controller.create);

export default router;
