import mongoose from 'mongoose';
import { moneyField } from './shared/money.js';

const { Schema, model, models } = mongoose;

/**
 * A return line is a SNAPSHOT, same philosophy as SalesReturn items:
 * `name`/`code`/`originalUnitPrice` are copied from the ORIGINAL purchase
 * line at the moment of return, never re-read live from Product (whose
 * `purchasePrice` is a blended weighted-average across every purchase ever
 * made — see Product.js/purchase.service.js — not this specific batch's
 * price) — so history keeps showing exactly what THIS batch cost, even as
 * later purchases move the live average elsewhere. `returnAmount` =
 * originalUnitPrice * returnedQuantity.
 */
const purchaseReturnItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', trim: true },
    returnedQuantity: { type: Number, required: true, min: 1 },
    originalUnitPrice: moneyField({ required: true }), // snapshot of the ORIGINAL purchase line's price
    returnAmount: moneyField({ required: true }), // originalUnitPrice * returnedQuantity, snapshot
  },
  { _id: false },
);

/**
 * A standalone return transaction against ONE existing Purchase — goods
 * going BACK to the supplier — never modifies, deletes, or backdates that
 * Purchase in any way (see purchaseReturn.service.js: the original invoice
 * is only ever READ, never written to).
 *
 * NOT a mirror-image of SalesReturn in every detail (deliberately, per the
 * phase's own warning) — the key difference is stock DIRECTION:
 * a sales return puts goods back INTO the shop (stock increases, no
 * scarcity check needed — you can always receive goods back). A purchase
 * return takes goods OUT of the shop, back to the supplier (stock
 * DECREASES), which means it needs the same kind of stock-sufficiency
 * guard the original sale-time decrement uses: you cannot return more
 * units than currently sit in stock, even if the purchase invoice itself
 * would technically still allow it (e.g. 10 bought, 8 already sold, only 2
 * left — you cannot hand 3 back to the supplier no matter what the invoice
 * says). See purchaseReturn.service.js for the atomic `$gte`-guarded
 * decrement that enforces this.
 *
 * `idempotencyKey` makes the create endpoint safe against duplicate
 * submission — same mechanism as SalesReturn.
 */
const purchaseReturnSchema = new Schema(
  {
    purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase', required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    items: {
      type: [purchaseReturnItemSchema],
      required: true,
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'المرتجع يجب أن يحتوي على منتج واحد على الأقل',
      },
    },
    totalReturnAmount: moneyField({ required: true }),
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 200 },
    // Business date/time of the return — distinct from Mongoose's own
    // createdAt/updatedAt bookkeeping timestamps below.
    date: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

// Duplicate-submission guard: a second create() with the same key throws a
// duplicate-key error the service catches and turns into an idempotent
// no-op (returns the original document) instead of a second return.
purchaseReturnSchema.index({ idempotencyKey: 1 }, { unique: true });
purchaseReturnSchema.index({ purchaseId: 1 }); // "already-returned quantity per product" lookups
purchaseReturnSchema.index({ supplierId: 1, date: -1 }); // "this supplier's returns", newest first

export default models.PurchaseReturn || model('PurchaseReturn', purchaseReturnSchema);
