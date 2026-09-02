import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { validateObjectIdParam } from '../middleware/validateObjectId.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

// Two separate schemas (not create.partial()) for the same reason as
// Products: a partial derived from a schema with .default(...) would inject
// defaults for fields the client didn't send on a PATCH.
const createSchema = z.object({
  name: z.string().trim().min(1, 'أدخل الاسم').max(200),
  phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(300).default(''),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().trim().max(200).optional(),
});

/**
 * Customer and Supplier expose the exact same route shape over a
 * `personService` instance (see src/services/personService.js) — this
 * factory is the route-layer half of that shared-structure decision, so the
 * HTTP wiring (auth, validation, status codes) isn't duplicated either.
 */
export function createPersonRouter(service) {
  const router = Router();

  router.use(requireAuth);

  router.get('/', validateQuery(listQuerySchema), asyncHandler(async (req, res) => {
    const { page, limit, search } = req.validatedQuery;
    const result = await service.list({ page, limit, search });
    res.json({ success: true, data: result.items, pagination: result.pagination });
  }));

  router.get('/:id', validateObjectIdParam(), asyncHandler(async (req, res) => {
    const person = await service.getOne(req.params.id);
    res.json({ success: true, data: person });
  }));

  router.post('/', validateBody(createSchema), asyncHandler(async (req, res) => {
    const person = await service.create(req.body);
    res.status(201).json({ success: true, data: person });
  }));

  router.patch('/:id', validateObjectIdParam(), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const person = await service.update(req.params.id, req.body);
    res.json({ success: true, data: person });
  }));

  router.delete('/:id', validateObjectIdParam(), asyncHandler(async (req, res) => {
    await service.remove(req.params.id);
    res.json({ success: true });
  }));

  return router;
}

export default createPersonRouter;
