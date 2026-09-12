import mongoose from 'mongoose';
import { moneyField } from './shared/money.js';

const { Schema, model, models } = mongoose;

/**
 * The supplier-side mirror of CustomerCreditPayout — money the SHOP
 * receives BACK from a supplier who owes us a credit (creditOwed > 0 on the
 * supplier — see personService.js's getTotals doc block, almost always
 * arising from a purchase return worth more than what we still owed them
 * at the time).
 *
 * Direction is the opposite of CustomerCreditPayout: that's cash leaving
 * the register (an 'out' cashbox transaction) to a customer; this is cash
 * ENTERING the register (an 'in' cashbox transaction) from a supplier — see
 * supplierCreditReceipt.service.js.
 *
 * `creditOwedAfter` is a snapshot of the supplier's remaining creditOwed
 * immediately after this receipt, mirroring CustomerPayment.balanceAfter's
 * snapshot philosophy.
 *
 * This ONLY reduces creditOwed — it is not a way to invent a supplier
 * credit that doesn't already exist; createSupplierCreditReceipt (in
 * supplierCreditReceipt.service.js) rejects an amount larger than the
 * supplier's current creditOwed.
 */
const supplierCreditReceiptSchema = new Schema(
  {
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    // Strictly positive — same reasoning as CustomerPayment.amount.
    amount: moneyField({ required: true, min: 0.01 }),
    // Snapshot of the supplier's remaining creditOwed right after this
    // receipt — never negative (a receipt can never exceed the creditOwed
    // at the time it's recorded; see supplierCreditReceipt.service.js).
    creditOwedAfter: moneyField({ required: true }),
    note: { type: String, default: '', trim: true, maxlength: 500 },
    date: { type: Date, required: true, default: Date.now },
    // Same duplicate-submission guard as CustomerPayment/CustomerCreditPayout.
    idempotencyKey: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { timestamps: true },
);

supplierCreditReceiptSchema.index({ supplierId: 1, date: -1 });
supplierCreditReceiptSchema.index({ date: -1 });
supplierCreditReceiptSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export default models.SupplierCreditReceipt || model('SupplierCreditReceipt', supplierCreditReceiptSchema);