import { asyncHandler } from '../middleware/asyncHandler.js';
import * as supplierPaymentService from '../services/supplierPayment.service.js';

export const list = asyncHandler(async (req, res) => {
  const { supplierId, page, limit } = req.validatedQuery;
  const result = await supplierPaymentService.listSupplierPayments({ supplierId, page, limit });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const create = asyncHandler(async (req, res) => {
  const { supplierId, amount, note, idempotencyKey } = req.body;
  const payment = await supplierPaymentService.createSupplierPayment({ supplierId, amount, note, idempotencyKey });
  res.status(201).json({ success: true, data: payment });
});

export const remove = asyncHandler(async (req, res) => {
  await supplierPaymentService.deleteSupplierPayment(req.params.id);
  res.json({ success: true });
});