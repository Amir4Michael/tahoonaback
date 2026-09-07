import mongoose from 'mongoose';
import { moneyField } from './shared/money.js';

const { Schema, model, models } = mongoose;

/**
 * A standalone settlement WE pay to the supplier against our OUTSTANDING
 * BALANCE as a whole (the same supplier-level aggregate figure shown in
 * Supplier Details — see personService.getTotals), not against any single
 * purchase invoice — the mirror of CustomerPayment.js, but money flowing
 * the opposite direction (out of the cashbox, not in). Nothing in this
 * project tracks per-invoice payment allocation, so this reduces the
 * running total across all our purchases from this supplier, never a
 * specific Purchase.
 *
 * Existing Purchase documents are NEVER modified by a payment — `Purchase.
 * paid`/`Purchase.remaining` keep showing exactly what was paid/owed at the
 * moment of that specific purchase, forever. See
 * services/supplierPayment.service.js and services/supplierBalance.service.js.
 *
 * `balanceAfter` is a SNAPSHOT of the supplier's remaining balance
 * immediately after this payment was applied, computed once inside the same
 * transaction that creates this document — matches the project's snapshot
 * philosophy for Sale/Purchase line items and CustomerPayment.
 */
const supplierPaymentSchema = new Schema(
  {
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    // Strictly positive — a payment of 0 or less is meaningless and is
    // rejected in the service layer before this is ever constructed.
    amount: moneyField({ required: true, min: 0.01 }),
    // Snapshot of the supplier's remaining balance right after this
    // payment — never negative (a payment can never exceed the balance at
    // the time it's recorded; see supplierPayment.service.js).
    balanceAfter: moneyField({ required: true }),
    note: { type: String, default: '', trim: true, maxlength: 500 },
    // Business date/time of the payment — distinct from Mongoose's own
    // createdAt/updatedAt bookkeeping timestamps below.
    date: { type: Date, required: true, default: Date.now },
    // Duplicate-submission guard, added during the full regression audit —
    // see CustomerPayment.js for the full reasoning (identical here).
    idempotencyKey: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { timestamps: true },
);

supplierPaymentSchema.index({ supplierId: 1, date: -1 }); // "this supplier's payments", newest first
supplierPaymentSchema.index({ date: -1 });
supplierPaymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export default models.SupplierPayment || model('SupplierPayment', supplierPaymentSchema);
