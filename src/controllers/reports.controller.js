import { asyncHandler } from '../middleware/asyncHandler.js';
import * as reportsService from '../services/reports.service.js';

export const sales = asyncHandler(async (req, res) => {
  const data = await reportsService.getSalesReport(req.validatedQuery);
  res.json({ success: true, data });
});

export const purchases = asyncHandler(async (req, res) => {
  const data = await reportsService.getPurchasesReport(req.validatedQuery);
  res.json({ success: true, data });
});

export const profit = asyncHandler(async (req, res) => {
  const data = await reportsService.getProfitReport(req.validatedQuery);
  res.json({ success: true, data });
});

export const inventory = asyncHandler(async (req, res) => {
  const data = await reportsService.getInventoryReport();
  res.json({ success: true, data });
});

export const customers = asyncHandler(async (req, res) => {
  const data = await reportsService.getCustomersReport(req.validatedQuery);
  res.json({ success: true, data });
});

export const suppliers = asyncHandler(async (req, res) => {
  const data = await reportsService.getSuppliersReport(req.validatedQuery);
  res.json({ success: true, data });
});
