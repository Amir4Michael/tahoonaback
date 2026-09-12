import { asyncHandler } from '../middleware/asyncHandler.js';
import * as customerCreditPayoutService from '../services/customerCreditPayout.service.js';

export const list = asyncHandler(async (req, res) => {
  const { customerId, page, limit } = req.validatedQuery;
  const result = await customerCreditPayoutService.listCustomerCreditPayouts({ customerId, page, limit });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const create = asyncHandler(async (req, res) => {
  const { customerId, amount, note, idempotencyKey } = req.body;
  const payout = await customerCreditPayoutService.createCustomerCreditPayout({ customerId, amount, note, idempotencyKey });
  res.status(201).json({ success: true, data: payout });
});

export const remove = asyncHandler(async (req, res) => {
  await customerCreditPayoutService.deleteCustomerCreditPayout(req.params.id);
  res.json({ success: true });
});