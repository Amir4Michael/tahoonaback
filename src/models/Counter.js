import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

/**
 * One document per named sequence (e.g. 'invoiceNumber', 'purchaseNumber').
 * The frontend's mock `nextNumber()` helper scans all existing records and
 * takes `max + 1` — fine for a single in-memory user, but unsafe for a real
 * backend: two concurrent requests could compute the same "next" number.
 * This collection exists so the increment can be done atomically instead
 * (see src/services/sequence.service.js) — MongoDB's `$inc` on a single
 * document is atomic even without a transaction, which is what actually
 * guarantees two concurrent callers never receive the same number.
 */
const counterSchema = new Schema({
  name: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 },
});

export default models.Counter || model('Counter', counterSchema);
