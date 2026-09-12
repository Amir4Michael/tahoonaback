import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import * as controller from '../controllers/product.controller.js';

const router = Router();

// All product routes require the shop login — there is no read-only role in
// this system (the future System 5 read-only master is a separate system
// with its own access, not a role within this one).
router.use(requireAuth);

// Two separate schemas (not create.partial()) — a partial derived from a
// schema with .default(...) would inject defaults for OMITTED fields on
// update too (e.g. a PATCH that doesn't mention purchasePrice would silently
// reset it to 0). Keeping them separate means an update only ever touches
// the fields the client actually sent.
const productCreateSchema = z.object({
  name: z.string().trim().min(1, 'أدخل اسم المنتج').max(200),
  code: z.string().trim().min(1, 'أدخل كود المنتج').max(100),
  purchasePrice: z.coerce.number().min(0).default(0),
  salePrice: z.coerce.number().min(0).default(0),
  quantity: z.coerce.number().min(0).default(0),
  minQuantity: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(1000).default(''),
  image: z.string().trim().max(2000).default(''),
});

const productUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  code: z.string().trim().min(1).max(100).optional(),
  purchasePrice: z.coerce.number().min(0).optional(),
  salePrice: z.coerce.number().min(0).optional(),
  quantity: z.coerce.number().min(0).optional(),
  minQuantity: z.coerce.number().min(0).optional(),
  notes: z.string().trim().max(1000).optional(),
  image: z.string().trim().max(2000).optional(),
});

const productListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().trim().max(200).optional(),
  filter: z.enum(['all', 'low', 'out', 'available', 'hidden']).optional().default('all'),
  sort: z.enum(['name', 'qtyAsc', 'qtyDesc', 'profit']).optional().default('name'),
});

router.get('/', validateQuery(productListQuerySchema), controller.list);
router.get('/:id', validateObjectIdParam(), controller.getOne);
router.post('/', validateBody(productCreateSchema), controller.create);
router.patch('/:id', validateObjectIdParam(), validateBody(productUpdateSchema), controller.update);
router.delete('/:id', validateObjectIdParam(), controller.remove);
router.post('/:id/restore', validateObjectIdParam(), controller.restore);

export default router;