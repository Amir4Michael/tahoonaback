import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

// Fixed value that every Settings document must carry, combined with a
// unique index below, to make it structurally impossible to ever insert a
// second Settings document — MongoDB's unique index rejects the insert.
const SINGLETON_KEY = 'system1_settings';

/**
 * Shop configuration — one document per system, ever.
 *
 * Deliberately DOES NOT include the shop login password/access code, even
 * though the current frontend's mock `settings.accessCode` field does. A
 * login credential must never live next to plain shop-info fields returned
 * wholesale by a "get settings" endpoint, and must never be stored in
 * plaintext at all. It will live in its own collection with a hashed value,
 * built in the Authentication phase — this model intentionally has no field
 * for it.
 */
const settingsSchema = new Schema(
  {
    singletonKey: {
      type: String,
      required: true,
      unique: true,
      default: SINGLETON_KEY,
      immutable: true,
    },
    shopName: { type: String, required: true, trim: true, maxlength: 200 },
    ownerName: { type: String, default: '', trim: true, maxlength: 200 },
    phone: { type: String, default: '', trim: true, maxlength: 30 },
    address: { type: String, default: '', trim: true, maxlength: 300 },
    invoiceFooter: { type: String, default: '', trim: true, maxlength: 500 },
    lowStockThreshold: { type: Number, required: true, min: 0, default: 5 },
  },
  { timestamps: true },
);

settingsSchema.statics.SINGLETON_KEY = SINGLETON_KEY;

export default models.Settings || model('Settings', settingsSchema);
