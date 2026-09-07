import mongoose from 'mongoose';
import { moneyField, round2 } from './shared/money.js';
import { PAYMENT_METHODS } from './constants.js';

const { Schema, model, models } = mongoose;

/**
 * A sale line is a full SNAPSHOT taken at the moment of sale — `name`,
 * `code`, `price`, and `cost` are copied in, not resolved live through
 * `productId`. This is the whole point of the historical-integrity rule: if
 * the product's price or cost changes next week, every past sale must keep
 * showing exactly what it sold for and cost at the time. `productId` is kept
 * only to link back to the product (e.g. "this product's sales history",
 * reducing stock on creation) — it is never used to re-derive price or cost
 * for an existing sale.
 *
 * `price` is the ACTUAL price this line sold at, which may differ from the
 * product's current `salePrice` (a one-off custom price for this customer/
 * transaction — see the POS phase). It is validated and stamped in the
 * service layer, never taken from the product blindly.
 */
const saleItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', trim: true },
    price: moneyField({ required: true }), // actual sold price for this line (snapshot)
    cost: moneyField({ required: true }), // product's cost at the moment of sale (snapshot, for profit calc)
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const saleSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, trim: true },
    // null = walk-in / cash customer (no account on file).
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    items: {
      type: [saleItemSchema],
      required: true,
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'الفاتورة يجب أن تحتوي على منتج واحد على الأقل',
      },
    },
    // Sum of the lines (price*quantity) BEFORE the invoice-level discount —
    // kept alongside `total` so a saved invoice can always show both figures
    // without recomputing from `items` (product prices/costs may drift later).
    // Defaults to `total` (a *function* default, evaluated against `this`
    // document at construction time — unlike a pre('validate') hook, this
    // also runs under `validateSync()`) when omitted: correct for every sale
    // built before this field existed, since no discount => subtotal ===
    // total. sale.service.js always sets it explicitly for real sales.
    subtotal: moneyField({
      required: true,
      default() {
        return this.total;
      },
    }),
    // Flat (fixed-amount) discount applied to the invoice as a whole — never
    // distributed across individual lines, so `items[].price` always stays
    // the actual per-unit price the product sold at. Validated in the
    // service layer against `subtotal` (0 <= discount <= subtotal).
    discount: moneyField({ required: true, default: 0 }),
    // Final amount owed for this invoice: subtotal - discount. `paid` and
    // `remaining` are always relative to THIS field, not `subtotal` — this
    // preserves every existing consumer of `total` (customer balances,
    // reports, cashbox) without needing to know about discounts at all.
    total: moneyField({ required: true }),
    paid: moneyField({ required: true }),
    remaining: moneyField({ required: true }),
    // Can go negative if a line was sold below its cost — that's a real
    // business outcome (e.g. a discount), not a data error, so no min here.
    profit: { type: Number, required: true, set: round2 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    // Business date of the sale — distinct from Mongoose's own
    // createdAt/updatedAt bookkeeping timestamps below.
    date: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

saleSchema.index({ invoiceNumber: 1 }, { unique: true });
saleSchema.index({ customerId: 1, date: -1 }); // "this customer's sales", newest first
saleSchema.index({ date: -1 }); // sales history / reports by date range

export default models.Sale || model('Sale', saleSchema);
