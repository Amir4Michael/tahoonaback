import { asyncHandler } from '../middleware/asyncHandler.js';
import * as purchaseService from '../services/purchase.service.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, search, supplierId, paymentMethod, from, to } = req.validatedQuery;
  const result = await purchaseService.listPurchases({ page, limit, search, supplierId, paymentMethod, from, to });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const getOne = asyncHandler(async (req, res) => {
  const purchase = await purchaseService.getPurchase(req.params.id);
  res.json({ success: true, data: purchase });
});

export const create = asyncHandler(async (req, res) => {
  const { supplierId, items, paymentMethod, paid, date, notes } = req.body;
  const purchase = await purchaseService.createPurchase({ supplierId, items, paymentMethod, paid, date, notes });
  res.status(201).json({ success: true, data: purchase });
});
