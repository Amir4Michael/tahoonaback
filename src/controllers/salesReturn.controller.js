import { asyncHandler } from '../middleware/asyncHandler.js';
import * as salesReturnService from '../services/salesReturn.service.js';

export const list = asyncHandler(async (req, res) => {
  const { customerId, saleId, page, limit } = req.validatedQuery;
  const result = await salesReturnService.listSalesReturns({ customerId, saleId, page, limit });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const getReturnable = asyncHandler(async (req, res) => {
  const data = await salesReturnService.getReturnableForSale(req.params.saleId);
  res.json({ success: true, data });
});

export const create = asyncHandler(async (req, res) => {
  const { saleId, items, idempotencyKey } = req.body;
  const salesReturn = await salesReturnService.createSalesReturn({ saleId, items, idempotencyKey });
  res.status(201).json({ success: true, data: salesReturn });
});
