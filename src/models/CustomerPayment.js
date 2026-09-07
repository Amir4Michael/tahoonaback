import mongoose from 'mongoose';
import { moneyField } from './shared/money.js';

const { Schema, model, models } = mongoose;

/**
 * A standalone settlement the customer makes against their OUTSTANDING
 * BALANCE as a whole (the same customer-level aggregate figure shown in
 * Customer Details — see personService.getTotals), not against any single
 * invoice. Nothing in this project tracks per-invoice payment allocation —
 * a customer's debt has always been one running total across all their
 * sales (`total - paid`, summed) — so a payment reduces that running total
 * rather than being tied to a specific Sale. Inventing per-invoice
 * allocation (e.g. FIFO against oldest unpaid invoice) would be a new
 * behavior the rest of the system doesn't support, so this deliberately
 * doesn't do that.
 *
 * Existing Sale documents are NEVER modified by a payment — `Sale.paid`/
 * `Sale.remaining` keep showing exactly what was paid/owed at the moment of
 * that specific sale, forever. The customer's current balance is always
 * `(sum of Sale.total - Sale.paid) - (sum of CustomerPayment.amount)`,
 * computed fresh (see personService.getTotals), never by mutating history.
 *
 * `balanceAfter` is a SNAPSHOT of the customer's remaining balance
 * immediately after this payment was applied, computed once inside the same
 * transaction that creates this document (see customerPayment.service.js)
 * — matches the project's snapshot philosophy for Sale/Purchase line items:
 * history must keep showing exactly what the balance was at that moment,
 * even as later sales/payments move it further.
 */
const customerPaymentSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    // Strictly positive — a payment of 0 or less is meaningless and is
    // rejected in the service layer before this is ever constructed.
    amount: moneyField({ required: true, min: 0.01 }),
    // Snapshot of the customer's remaining balance right after this
    // payment — never negative (a payment can never exceed the balance at
    // the time it's recorded; see customerPayment.service.js).
    balanceAfter: moneyField({ required: true }),
    note: { type: String, default: '', trim: true, maxlength: 500 },
    // Business date/time of the payment — distinct from Mongoose's own
    // createdAt/updatedAt bookkeeping timestamps below.
    date: { type: Date, required: true, default: Date.now },
    // Duplicate-submission guard, added during the full regression audit to
    // match SalesReturn/PurchaseReturn's existing protection: the frontend
    // generates one key per confirm action and reuses it on retry, and the
    // sparse unique index below guarantees the same key can never produce
    // two payment documents. Sparse (not a plain unique index) so any
    // pre-existing payment recorded before this field existed — which has
    // no key at all — never collides with another equally-keyless one.
    idempotencyKey: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { timestamps: true },
);

customerPaymentSchema.index({ customerId: 1, date: -1 }); // "this customer's payments", newest first
customerPaymentSchema.index({ date: -1 });
customerPaymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export default models.CustomerPayment || model('CustomerPayment', customerPaymentSchema);
