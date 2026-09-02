import { asyncHandler } from '../middleware/asyncHandler.js';
import * as saleService from '../services/sale.service.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, search, customerId, paymentMethod, from, to } = req.validatedQuery;
  const result = await saleService.listSales({ page, limit, search, customerId, paymentMethod, from, to });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const getOne = asyncHandler(async (req, res) => {
  const sale = await saleService.getSale(req.params.id);
  res.json({ success: true, data: sale });
});

export const create = asyncHandler(async (req, res) => {
  const { customerId, items, paymentMethod, paid } = req.body;
  const sale = await saleService.createSale({ customerId: customerId || null, items, paymentMethod, paid });
  res.status(201).json({ success: true, data: sale });
});
