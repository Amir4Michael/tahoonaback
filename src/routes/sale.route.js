import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import * as controller from '../controllers/sale.controller.js';

const router = Router();

router.use(requireAuth);

const objectId = (message) => z.string().refine((v) => mongoose.isValidObjectId(v), { message });

// Business-rule validation (stock availability, per-product price checks) is
// intentionally NOT duplicated here — it needs a database read and specific
// per-product Arabic messages matching the frontend exactly, so it lives in
// sale.service.js. This schema only validates shape/type, plus the one
// cross-field rule (credit needs a customer) that's cheap to check early.
const saleItemSchema = z.object({
  productId: objectId('معرّف منتج غير صالح'),
  quantity: z.coerce.number(),
  // '' / null / undefined must all mean "no custom price" (use the
  // product's current sale price) — NOT coerce to 0, which would be
  // silently misread downstream as an explicit price of zero.
  price: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.coerce.number().optional(),
  ),
});

const createSaleSchema = z
  .object({
    customerId: objectId('معرّف عميل غير صالح').optional().nullable(),
    items: z.array(saleItemSchema).min(1, 'الفاتورة فارغة، أضف منتجات أولاً'),
    paymentMethod: z.enum(['cash', 'credit']),
    paid: z.coerce.number().optional(),
    // Flat (fixed-amount) invoice-level discount. Shape/sign check only —
    // the real rule (discount <= subtotal) needs the priced lines, which
    // only exist after the service reads each product, so it's enforced
    // there (see sale.service.js).
    discount: z.coerce.number().min(0, 'قيمة الخصم غير صحيحة').optional(),
  })
  .refine((data) => !(data.paymentMethod === 'credit' && !data.customerId), {
    message: 'اختر عميلاً لإتمام البيع بالآجل',
    path: ['customerId'],
  });

const listSalesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().trim().max(200).optional(),
  customerId: z.string().trim().optional(),
  paymentMethod: z.enum(['all', 'cash', 'credit']).optional().default('all'),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

router.get('/', validateQuery(listSalesQuerySchema), controller.list);
router.get('/:id', validateObjectIdParam(), controller.getOne);
router.post('/', validateBody(createSaleSchema), controller.create);

export default router;
