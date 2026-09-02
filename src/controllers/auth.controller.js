import { asyncHandler } from '../middleware/asyncHandler.js';
import * as authService from '../services/auth.service.js';

export const login = asyncHandler(async (req, res) => {
  const { password, deviceId, deviceLabel } = req.body;
  const result = await authService.login({
    password,
    deviceId,
    deviceLabel,
    userAgent: req.headers['user-agent'] || '',
    ip: req.ip,
  });
  res.json({ success: true, data: result });
});

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken, deviceId } = req.body;
  const result = await authService.refresh({ refreshToken, deviceId });
  res.json({ success: true, data: result });
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout({ deviceId: req.auth.deviceId });
  res.json({ success: true });
});

export const listDevices = asyncHandler(async (req, res) => {
  const devices = await authService.listDevices({ currentDeviceId: req.auth.deviceId });
  res.json({ success: true, data: devices });
});

export const revokeDevice = asyncHandler(async (req, res) => {
  await authService.revokeDevice({ id: req.params.id });
  res.json({ success: true });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword({ currentPassword, newPassword, currentDeviceId: req.auth.deviceId });
  res.json({ success: true });
});
