import Settings from '../models/Settings.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';

const DEFAULTS = {
  shopName: 'محلي',
  ownerName: '',
  phone: '',
  address: '',
  invoiceFooter: '',
  lowStockThreshold: 5,
};

/**
 * Always returns a settings document — creates the singleton with sensible
 * defaults on first access if it doesn't exist yet. Unlike `ShopAuth` (which
 * deliberately requires an explicit CLI seed for the login password, since
 * auto-creating a credential would be a security concern), there's no such
 * concern for shop info, so auto-creating on first read is simply more
 * convenient and matches how the frontend already expects `state.settings`
 * to always be present.
 */
export async function getSettings() {
  return Settings.findOneAndUpdate(
    { singletonKey: Settings.SINGLETON_KEY },
    { $setOnInsert: { ...DEFAULTS, singletonKey: Settings.SINGLETON_KEY } },
    { upsert: true, new: true },
  );
}

/**
 * Partial update — only the fields actually present in `data` are changed
 * (same precise-diff pattern as product/customer/supplier updates: no
 * `.partial()`-derived schema that could inject defaults for omitted
 * fields). Deliberately has no `accessCode`/password field to update here —
 * that's `PATCH /api/auth/password`'s job, in an entirely different
 * collection (`ShopAuth`), never mixed with plain shop info.
 */
export async function updateSettings(data) {
  const settings = await getSettings();

  const changedKeys = Object.keys(data);
  const before = {};
  for (const key of changedKeys) before[key] = settings[key];

  Object.assign(settings, data);
  await settings.save();

  const after = {};
  for (const key of changedKeys) after[key] = settings[key];

  await recordActivity({ type: 'settings', description: 'تم تحديث إعدادات النظام' });
  await recordAuditLog({
    action: 'settings.update',
    entityType: 'Settings',
    entityId: settings._id,
    values: { changed: changedKeys, before, after },
  });

  return settings;
}
