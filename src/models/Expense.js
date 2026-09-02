import mongoose from 'mongoose';
import { moneyField } from './shared/money.js';

const { Schema, model, models } = mongoose;

const expenseSchema = new Schema(
  {
    reason: { type: String, required: true, trim: true, maxlength: 200 },
    // Must be strictly positive — a zero/negative "expense" isn't meaningful.
    amount: moneyField({ required: true, min: 0.01 }),
    notes: { type: String, default: '', trim: true, maxlength: 1000 },
    date: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

expenseSchema.index({ date: -1 });

export default models.Expense || model('Expense', expenseSchema);
