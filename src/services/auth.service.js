import ShopAuth from '../models/ShopAuth.js';
import DeviceSession from '../models/DeviceSession.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { generateRefreshToken, hashRefreshToken, compareRefreshToken } from '../utils/tokens.js';
import { signAccessToken } from '../config/jwt.js';
import { AppError } from '../middleware/errorHandler.js';
import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { recordAuditLog } from './auditLog.service.js';

const toDeviceDTO = (doc, currentDeviceId) => ({
  id: doc._id.toString(),
  deviceId: doc.deviceId,
  label: doc.label,
  userAgent: doc.userAgent,
  lastIp: doc.lastIp,
  lastActiveAt: doc.lastActiveAt,
  registeredAt: doc.createdAt,
  isCurrent: doc.deviceId === currentDeviceId,
});

async function issueSession(device) {
  const refreshToken = generateRefreshToken();
  device.refreshTokenHash = hashRefreshToken(refreshToken);
  device.lastActiveAt = new Date();
  await device.save();

  const accessToken = signAccessToken({ deviceId: device.deviceId });
  return { accessToken, refreshToken, expiresInMinutes: env.ACCESS_TOKEN_TTL_MINUTES };
}

/**
 * Verifies the shop password and either refreshes an already-registered
 * device's session, or registers a new device — rejecting a new device once
 * `MAX_DEVICES_PER_ACCOUNT` (2) devices are already registered, per the
 * confirmed design. Logging in again from an already-known device never
 * consumes a new slot.
 */
export async function login({ password, deviceId, deviceLabel, userAgent, ip }) {
  const auth = await ShopAuth.findOne({ singletonKey: ShopAuth.SINGLETON_KEY }).select('+passwordHash');
  if (!auth) {
    throw new AppError('لم يتم إعداد كلمة مرور الدخول بعد', 500, { code: 'SHOP_AUTH_NOT_CONFIGURED' });
  }

  const passwordOk = await verifyPassword(password, auth.passwordHash);
  if (!passwordOk) {
    await recordAuditLog({
      action: 'auth.login.failed',
      entityType: 'ShopAuth',
      values: { reason: 'wrong_password' },
      actorDeviceId: deviceId,
    });
    throw new AppError('كلمة المرور غير صحيحة', 401);
  }

  let device = await DeviceSession.findOne({ deviceId });

  if (!device) {
    const registeredCount = await DeviceSession.countDocuments();
    if (registeredCount >= env.MAX_DEVICES_PER_ACCOUNT) {
      const devices = await DeviceSession.find().sort({ lastActiveAt: -1 });
      await recordAuditLog({
        action: 'auth.login.failed',
        entityType: 'ShopAuth',
        values: { reason: 'device_limit_reached' },
        actorDeviceId: deviceId,
      });
      throw new AppError(
        `تم الوصول للحد الأقصى للأجهزة المسجلة (${env.MAX_DEVICES_PER_ACCOUNT}). يرجى إلغاء تسجيل جهاز قديم أولاً من الإعدادات.`,
        403,
        { code: 'DEVICE_LIMIT_REACHED', devices: devices.map((d) => toDeviceDTO(d, deviceId)) },
      );
    }
    device = new DeviceSession({
      deviceId,
      label: deviceLabel || '',
      userAgent: userAgent || '',
      lastIp: ip || '',
    });
  } else {
    if (deviceLabel) device.label = deviceLabel;
    device.userAgent = userAgent || device.userAgent;
    device.lastIp = ip || device.lastIp;
  }

  const session = await issueSession(device);
  logger.info({ deviceId }, 'Shop login succeeded');
  await recordAuditLog({
    action: 'auth.login.success',
    entityType: 'DeviceSession',
    entityId: device._id,
    values: {},
    actorDeviceId: deviceId,
  });
  return { ...session, device: toDeviceDTO(device, deviceId) };
}

/**
 * Rotates the refresh token on every use (issues a brand new one, discards
 * the old) — limits how long a leaked refresh token stays useful, and lets
 * us detect reuse of an already-rotated token as a signal worth logging.
 */
export async function refresh({ refreshToken, deviceId }) {
  const device = await DeviceSession.findOne({ deviceId }).select('+refreshTokenHash');
  if (!device) {
    throw new AppError('الجهاز غير مسجل، يرجى تسجيل الدخول مرة أخرى', 401, { code: 'DEVICE_NOT_REGISTERED' });
  }

  if (!compareRefreshToken(refreshToken, device.refreshTokenHash)) {
    logger.warn({ deviceId }, 'Refresh token mismatch');
    throw new AppError('رمز التحديث غير صالح، يرجى تسجيل الدخول مرة أخرى', 401);
  }

  return issueSession(device);
}

/**
 * Clears this device's session (its refresh token stops working, forcing a
 * password login for a new one) WITHOUT deleting its DeviceSession — logging
 * out must not free up a slot toward the 2-device limit, per the confirmed
 * design. Freeing a slot is a separate, explicit action (`revokeDevice`).
 */
export async function logout({ deviceId }) {
  const device = await DeviceSession.findOne({ deviceId });
  if (device) {
    device.refreshTokenHash = null;
    await device.save();
  }
  await recordAuditLog({ action: 'auth.logout', entityType: 'DeviceSession', entityId: device?._id || null, values: {} });
  return { success: true };
}

export async function listDevices({ currentDeviceId }) {
  const devices = await DeviceSession.find().sort({ lastActiveAt: -1 });
  return devices.map((d) => toDeviceDTO(d, currentDeviceId));
}

/** Frees up a device slot. Revoking the device you're currently on is allowed (logs it out). */
export async function revokeDevice({ id }) {
  const device = await DeviceSession.findById(id);
  if (!device) {
    throw new AppError('الجهاز غير موجود', 404);
  }
  await DeviceSession.deleteOne({ _id: id });
  await recordAuditLog({
    action: 'auth.device.revoked',
    entityType: 'DeviceSession',
    entityId: device._id,
    values: { revokedDeviceId: device.deviceId },
  });
  return { success: true };
}

/**
 * Requires the current password (standard practice — an active session
 * alone isn't proof of continued access to the password). On success, every
 * OTHER registered device is signed out (its refresh token cleared, slot
 * kept) so a changed password actually revokes anyone else's access; the
 * device making this request keeps its session, since it just proved it
 * holds the new password's predecessor.
 */
export async function changePassword({ currentPassword, newPassword, currentDeviceId }) {
  const auth = await ShopAuth.findOne({ singletonKey: ShopAuth.SINGLETON_KEY }).select('+passwordHash');
  if (!auth) {
    throw new AppError('لم يتم إعداد كلمة مرور الدخول بعد', 500, { code: 'SHOP_AUTH_NOT_CONFIGURED' });
  }

  const currentOk = await verifyPassword(currentPassword, auth.passwordHash);
  if (!currentOk) {
    throw new AppError('كلمة المرور الحالية غير صحيحة', 401);
  }

  auth.passwordHash = await hashPassword(newPassword);
  auth.passwordUpdatedAt = new Date();
  await auth.save();

  await DeviceSession.updateMany(
    { deviceId: { $ne: currentDeviceId } },
    { $set: { refreshTokenHash: null } },
  );

  logger.info('Shop password changed');
  await recordAuditLog({ action: 'auth.password.changed', entityType: 'ShopAuth', values: {} });
  return { success: true };
}
