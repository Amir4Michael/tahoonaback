import { asyncHandler } from '../middleware/asyncHandler.js';
import * as purchaseReturnService from '../services/purchaseReturn.service.js';

export const list = asyncHandler(async (req, res) => {
  const { supplierId, purchaseId, page, limit } = req.validatedQuery;
  const result = await purchaseReturnService.listPurchaseReturns({ supplierId, purchaseId, page, limit });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const getReturnable = asyncHandler(async (req, res) => {
  const data = await purchaseReturnService.getReturnableForPurchase(req.params.purchaseId);
  res.json({ success: true, data });
});

export const create = asyncHandler(async (req, res) => {
  const { purchaseId, items, idempotencyKey } = req.body;
  const purchaseReturn = await purchaseReturnService.createPurchaseReturn({ purchaseId, items, idempotencyKey });
  res.status(201).json({ success: true, data: purchaseReturn });
});
