import mongoose from 'mongoose';
import { ACTIVITY_TYPES } from './constants.js';

const { Schema, model, models } = mongoose;

/**
 * Light, human-readable activity feed — matches the current frontend's
 * `state.activity` exactly (one line per notable action, newest first).
 *
 * NOT the same thing as the future `AuditLog` (see the Audit Log phase),
 * which will additionally record which device/session performed the action
 * and before/after values for security review. Keep this one purely as the
 * user-facing feed it already is.
 */
const activityLogSchema = new Schema(
  {
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    amount: { type: Number, default: 0 },
    // Loosely typed on purpose — the target collection depends on `type`,
    // same reasoning as CashboxTransaction.refId.
    refId: { type: Schema.Types.ObjectId, default: null },
    date: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

activityLogSchema.index({ date: -1 });

export default models.ActivityLog || model('ActivityLog', activityLogSchema);
