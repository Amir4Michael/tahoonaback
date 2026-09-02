import { connectDB, disconnectDB } from '../src/config/db.js';
import { hashPassword } from '../src/utils/password.js';
import ShopAuth from '../src/models/ShopAuth.js';
import { logger } from '../src/config/logger.js';

/**
 * Sets (or resets) the shop's single login password directly in the
 * database. Intended for first-time setup and emergency recovery (e.g. the
 * password was forgotten and there's no way to log in to change it via the
 * API) — day-to-day password changes should go through
 * `PATCH /api/auth/password` instead, which requires knowing the current
 * password and correctly signs out other devices.
 *
 * Usage:
 *   node scripts/seed-shop-password.js "the-new-password"
 */
async function main() {
  const password = process.argv[2];
  if (!password || password.length < 4) {
    logger.error('Usage: node scripts/seed-shop-password.js "<password, min 4 chars>"');
    process.exit(1);
    return;
  }

  await connectDB();

  const passwordHash = await hashPassword(password);
  await ShopAuth.findOneAndUpdate(
    { singletonKey: ShopAuth.SINGLETON_KEY },
    { $set: { passwordHash, passwordUpdatedAt: new Date() } },
    { upsert: true, new: true },
  );

  logger.info('Shop login password set successfully.');
  await disconnectDB();
}

main().catch((err) => {
  logger.error({ err }, 'Failed to set shop password');
  process.exit(1);
});
