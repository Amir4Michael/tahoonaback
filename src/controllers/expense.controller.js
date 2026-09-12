import { asyncHandler } from '../middleware/asyncHandler.js';
import * as expenseService from '../services/expense.service.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, reason, from, to } = req.validatedQuery;
  const result = await expenseService.listExpenses({ page, limit, reason, from, to });
  res.json({ success: true, data: result.items, pagination: result.pagination, totalAmount: result.totalAmount });
});

export const summary = asyncHandler(async (req, res) => {
  const result = await expenseService.getSummary();
  res.json({ success: true, data: result });
});

export const reasons = asyncHandler(async (req, res) => {
  const result = await expenseService.getDistinctReasons();
  res.json({ success: true, data: result });
});

export const create = asyncHandler(async (req, res) => {
  const { reason, amount, date, notes } = req.body;
  const expense = await expenseService.createExpense({ reason, amount, date, notes });
  res.status(201).json({ success: true, data: expense });
});

export const remove = asyncHandler(async (req, res) => {
  await expenseService.deleteExpense(req.params.id);
  res.json({ success: true });
});