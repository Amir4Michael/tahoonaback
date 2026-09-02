import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

const SINGLETON_KEY = 'system1_shop_auth';

/**
 * The single shop-wide login credential (confirmed design: one password for
 * the whole shop, not per-employee accounts). Only ever one document exists,
 * enforced the same way as Settings — a fixed `singletonKey` behind a unique
 * index makes a second insert structurally impossible.
 *
 * `passwordHash` is a bcrypt hash — the plaintext password is never stored,
 * logged, or returned by any endpoint. `select: false` means a plain
 * `ShopAuth.findOne()` won't include it by accident; call sites that actually
 * need to compare it must explicitly `.select('+passwordHash')`.
 */
const shopAuthSchema = new Schema(
  {
    singletonKey: {
      type: String,
      required: true,
      unique: true,
      default: SINGLETON_KEY,
      immutable: true,
    },
    passwordHash: { type: String, required: true, select: false },
    passwordUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

shopAuthSchema.statics.SINGLETON_KEY = SINGLETON_KEY;

export default models.ShopAuth || model('ShopAuth', shopAuthSchema);
