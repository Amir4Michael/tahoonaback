import { asyncHandler } from '../middleware/asyncHandler.js';
import * as activityLogService from '../services/activityLog.service.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, type, from, to } = req.validatedQuery;
  const result = await activityLogService.listActivity({ page, limit, type, from, to });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});
