import { asyncHandler } from '../middleware/asyncHandler.js';
import * as auditLogService from '../services/auditLog.service.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, action, entityType, actorDeviceId, from, to } = req.validatedQuery;
  const result = await auditLogService.listAuditLogs({ page, limit, action, entityType, actorDeviceId, from, to });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});
