import mongoose from 'mongoose';
import { moneyField } from './shared/money.js';
import { PAYMENT_METHODS } from './constants.js';

const { Schema, model, models } = mongoose;

/**
 * Like a sale line, a purchase line is a SNAPSHOT (`name`/`code`/`price` at
 * the time of purchase) — it must keep reporting exactly what was actually
 * paid per unit in this batch, even after the product's current cost has
 * since moved on to a later purchase's price. `price` here is this batch's
 * purchase cost per unit; it's what the product's `purchasePrice` gets
 * overwritten to (done in the service layer) but this snapshot itself is
 * never rewritten by that.
 */
const purchaseItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', trim: true },
    price: moneyField({ required: true }), // actual purchase cost per unit for this batch (snapshot)
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const purchaseSchema = new Schema(
  {
    purchaseNumber: { type: String, required: true, trim: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    items: {
      type: [purchaseItemSchema],
      required: true,
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'عملية الشراء يجب أن تحتوي على منتج واحد على الأقل',
      },
    },
    // Sum of the lines (price*quantity) BEFORE the invoice-level discount —
    // kept alongside `total` so a saved purchase can always show both
    // figures without recomputing from `items`. Defaults to `total` (a
    // *function* default, evaluated against `this` document, so it also
    // runs under `validateSync()`) when omitted: correct for every purchase
    // built before this field existed (no discount => subtotal === total).
    subtotal: moneyField({
      required: true,
      default() {
        return this.total;
      },
    }),
    // Flat (fixed-amount) discount applied to the purchase as a whole —
    // never distributed across individual lines, so `items[].price` (which
    // becomes the product's new cost) always stays the actual per-unit
    // price paid in this batch.
    discount: moneyField({ required: true, default: 0 }),
    // Final amount owed to the supplier for this purchase: subtotal -
    // discount. `paid`/`remaining` and every existing consumer of `total`
    // (supplier balances, reports, cashbox) are relative to THIS field.
    total: moneyField({ required: true }),
    paid: moneyField({ required: true }),
    remaining: moneyField({ required: true }),
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    notes: { type: String, default: '', trim: true, maxlength: 1000 },
    // Business date of the purchase — the current frontend allows backdating
    // a purchase (e.g. entering an invoice received a few days ago), so this
    // is a real, user-settable field, not just bookkeeping.
    date: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

purchaseSchema.index({ purchaseNumber: 1 }, { unique: true });
purchaseSchema.index({ supplierId: 1, date: -1 });
purchaseSchema.index({ date: -1 });

export default models.Purchase || model('Purchase', purchaseSchema);