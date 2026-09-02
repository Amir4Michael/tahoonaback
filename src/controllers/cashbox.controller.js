import { asyncHandler } from '../middleware/asyncHandler.js';
import * as cashboxService from '../services/cashbox.service.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, type, search, from, to } = req.validatedQuery;
  const result = await cashboxService.listCashboxTransactions({ page, limit, type, search, from, to });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const summary = asyncHandler(async (req, res) => {
  const result = await cashboxService.getSummary();
  res.json({ success: true, data: result });
});

export const create = asyncHandler(async (req, res) => {
  const { type, amount, reason, date, notes } = req.body;
  const tx = await cashboxService.createCashTransaction({ type, amount, reason, date, notes });
  res.status(201).json({ success: true, data: tx });
});
