import mongoose from 'mongoose';
import { moneyField } from './shared/money.js';

const { Schema, model, models } = mongoose;

const customerCreditPayoutSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    amount: moneyField({ required: true, min: 0.01 }),
    creditOwedAfter: moneyField({ required: true }),
    note: { type: String, default: '', trim: true, maxlength: 500 },
    date: { type: Date, required: true, default: Date.now },
    idempotencyKey: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { timestamps: true },
);

customerCreditPayoutSchema.index({ customerId: 1, date: -1 });
customerCreditPayoutSchema.index({ date: -1 });
customerCreditPayoutSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export default models.CustomerCreditPayout || model('CustomerCreditPayout', customerCreditPayoutSchema);