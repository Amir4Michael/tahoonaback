import { asyncHandler } from '../middleware/asyncHandler.js';
import * as uploadService from '../services/upload.service.js';

export const getSignature = asyncHandler(async (req, res) => {
  const data = uploadService.getUploadSignature();
  res.json({ success: true, data });
});
