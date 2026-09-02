import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

/**
 * One document per registered device for the shop's single shared account.
 *
 * `deviceId` is a persistent, client-generated identifier (e.g.
 * `crypto.randomUUID()`, stored in the browser's localStorage on first use)
 * — deliberately NOT derived from IP or User-Agent alone, both of which
 * change too often (roaming networks/VPNs, browser or OS updates) to
 * reliably mean "the same device" over time, per the confirmed design.
 * `userAgent`/`lastIp` are stored only for display in the device list, never
 * used to decide whether two logins are "the same device".
 *
 * `refreshTokenHash` is a SHA-256 hash of the current refresh token issued to
 * this device (see src/utils/tokens.js). It's set to `null` on logout — the
 * device stays registered (keeps its slot toward the 2-device limit) but
 * needs the shop password again to get a new session, matching the confirmed
 * rule that logging out must not free up a device slot by itself.
 */
const deviceSessionSchema = new Schema(
  {
    deviceId: { type: String, required: true, trim: true, maxlength: 200 },
    // Informational only — e.g. "Chrome on Windows" derived from the User-Agent,
    // or a name the user gives the device. Never used for identification.
    label: { type: String, default: '', trim: true, maxlength: 200 },
    userAgent: { type: String, default: '', trim: true, maxlength: 500 },
    lastIp: { type: String, default: '', trim: true, maxlength: 100 },
    refreshTokenHash: { type: String, default: null, select: false },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// One session document per physical device — re-logging in on a known
// device must update its existing row, never create a duplicate slot.
deviceSessionSchema.index({ deviceId: 1 }, { unique: true });
deviceSessionSchema.index({ lastActiveAt: -1 }); // device list, newest-active first

export default models.DeviceSession || model('DeviceSession', deviceSessionSchema);
