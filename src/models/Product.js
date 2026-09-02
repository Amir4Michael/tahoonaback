import mongoose from 'mongoose';
import { moneyField } from './shared/money.js';

const { Schema, model, models } = mongoose;

/**
 * `purchasePrice` is the product's CURRENT weighted-average cost — it moves
 * every time new stock is purchased at a different price (see the Purchases
 * phase's weighted-average logic). `salePrice` is just the default asking
 * price shown at POS; an individual sale line can record a different actual
 * price without ever writing back to this field (see Sale.items[].price).
 *
 * Neither field is ever read to reinterpret a past Sale/Purchase — those
 * keep their own snapshot values in their `items[]`, independent of whatever
 * this product's price/cost is today.
 */
const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, required: true, trim: true, maxlength: 100 },
    purchasePrice: moneyField(),
    salePrice: moneyField(),
    quantity: { type: Number, required: true, min: 0, default: 0 },
    minQuantity: { type: Number, required: true, min: 0, default: 0 },
    notes: { type: String, default: '', trim: true, maxlength: 1000 },
    // Cloudinary URL only. Raw image bytes are never sent to or stored by
    // this backend — the frontend uploads directly to System 1's Cloudinary
    // account and only the resulting URL lands here (see Products phase).
    image: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

// `code` must be unique across the catalog (enforced by the frontend today).
productSchema.index({ code: 1 }, { unique: true });
// Name lookups/sorting (product pickers, search).
productSchema.index({ name: 1 });
// Low-stock / out-of-stock threshold queries (quantity <= minQuantity, quantity <= 0).
productSchema.index({ quantity: 1 });

export default models.Product || model('Product', productSchema);
