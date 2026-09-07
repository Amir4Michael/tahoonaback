import mongoose from 'mongoose';
import { moneyField } from './shared/money.js';

const { Schema, model, models } = mongoose;

/**
 * A return line is a SNAPSHOT, same philosophy as Sale/Purchase items:
 * `name`/`code`/`originalUnitPrice` are copied from the ORIGINAL sale line
 * at the moment of return, never re-read live from Product — so history
 * keeps showing exactly what was sold and returned, even if the product's
 * price changes later. `returnAmount` = originalUnitPrice * returnedQuantity
 * — a flat, undiscounted figure (an invoice-level discount, if any, was
 * never distributed across lines when the sale was made, so it isn't
 * re-attributed to a partial return either; see the POS discount phase).
 */
const salesReturnItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', trim: true },
    returnedQuantity: { type: Number, required: true, min: 1 },
    originalUnitPrice: moneyField({ required: true }), // snapshot of the ORIGINAL sale line's price
    returnAmount: moneyField({ required: true }), // originalUnitPrice * returnedQuantity, snapshot
  },
  { _id: false },
);

/**
 * A standalone return transaction against ONE existing Sale — never
 * modifies, deletes, or backdates that Sale in any way (see
 * salesReturn.service.js: the original invoice is only ever READ, never
 * written to). `customerId` is copied from the sale at creation time
 * (a sale's customerId never changes, so this is safe) purely so return
 * history can be queried directly by customer without a $lookup back to
 * Sale on every request.
 *
 * `idempotencyKey` makes the create endpoint safe against duplicate
 * submission (double-tap, network retry): the frontend generates one key
 * per confirm action and the unique index below guarantees the same key
 * can never produce two return documents — see salesReturn.service.js.
 */
const salesReturnSchema = new Schema(
  {
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    items: {
      type: [salesReturnItemSchema],
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
salesReturnSchema.index({ idempotencyKey: 1 }, { unique: true });
salesReturnSchema.index({ saleId: 1 }); // "already-returned quantity per product" lookups
salesReturnSchema.index({ customerId: 1, date: -1 }); // "this customer's returns", newest first

export default models.SalesReturn || model('SalesReturn', salesReturnSchema);
