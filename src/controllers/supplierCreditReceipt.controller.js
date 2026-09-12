import { asyncHandler } from '../middleware/asyncHandler.js';
import * as supplierCreditReceiptService from '../services/supplierCreditReceipt.service.js';

export const list = asyncHandler(async (req, res) => {
  const { supplierId, page, limit } = req.validatedQuery;
  const result = await supplierCreditReceiptService.listSupplierCreditReceipts({ supplierId, page, limit });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const create = asyncHandler(async (req, res) => {
  const { supplierId, amount, note, idempotencyKey } = req.body;
  const receipt = await supplierCreditReceiptService.createSupplierCreditReceipt({ supplierId, amount, note, idempotencyKey });
  res.status(201).json({ success: true, data: receipt });
});

export const remove = asyncHandler(async (req, res) => {
  await supplierCreditReceiptService.deleteSupplierCreditReceipt(req.params.id);
  res.json({ success: true });
});