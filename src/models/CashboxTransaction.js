import mongoose from 'mongoose';
import { moneyField } from './shared/money.js';
import { CASHBOX_TX_TYPES, CASHBOX_REF_TYPES } from './constants.js';

const { Schema, model, models } = mongoose;

const cashboxTransactionSchema = new Schema(
  {
    type: { type: String, enum: CASHBOX_TX_TYPES, required: true },
    // Must be strictly positive — direction is carried by `type`, not sign.
    amount: moneyField({ required: true, min: 0.01 }),
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    refType: { type: String, enum: CASHBOX_REF_TYPES, required: true, default: 'manual' },
    // Points into Sale/Purchase/Expense depending on `refType`, or stays null
    // for a manual entry. Kept as a plain ObjectId rather than a typed `ref`
    // since the target collection varies and the UI never needs to populate
    // it — the human-readable `reason` already carries the invoice/purchase
    // number. A future drill-down feature can resolve it manually by refType.
    refId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, default: '', trim: true, maxlength: 500 },
    date: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

cashboxTransactionSchema.index({ date: -1 }); // chronological ledger / balance calculation
cashboxTransactionSchema.index({ refType: 1, refId: 1 }); // e.g. "find the tx created by this expense" on delete

export default models.CashboxTransaction || model('CashboxTransaction', cashboxTransactionSchema);
