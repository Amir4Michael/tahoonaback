import { asyncHandler } from '../middleware/asyncHandler.js';
import * as customerPaymentService from '../services/customerPayment.service.js';

export const list = asyncHandler(async (req, res) => {
  const { customerId, page, limit } = req.validatedQuery;
  const result = await customerPaymentService.listCustomerPayments({ customerId, page, limit });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const create = asyncHandler(async (req, res) => {
  const { customerId, amount, note, idempotencyKey } = req.body;
  const payment = await customerPaymentService.createCustomerPayment({ customerId, amount, note, idempotencyKey });
  res.status(201).json({ success: true, data: payment });
});
