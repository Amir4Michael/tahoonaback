import { asyncHandler } from '../middleware/asyncHandler.js';
import * as settingsService from '../services/settings.service.js';

export const get = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();
  res.json({ success: true, data: settings });
});

export const update = asyncHandler(async (req, res) => {
  const settings = await settingsService.updateSettings(req.body);
  res.json({ success: true, data: settings });
});
