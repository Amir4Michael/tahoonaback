import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

// Defense in depth: even though callers are expected to only ever pass
// curated, non-sensitive fields into `values`, this strips a few
// known-dangerous keys before saving — never trust the caller perfectly for
// something as security-relevant as an audit trail.
const FORBIDDEN_VALUE_KEYS = ['password', 'passwordHash', 'currentPassword', 'newPassword', 'accessToken', 'refreshToken', 'token', 'secret'];

/**
 * Structured, security-focused audit trail — distinct from the lightweight,
 * user-facing `ActivityLog` feed (see ActivityLog.js). Records who (which
 * registered device — there are no per-employee accounts, per the confirmed
 * design), what action, when, which entity, and a curated set of values
 * relevant to reviewing the action — never a full document dump, and never
 * passwords/secrets/tokens.
 *
 * Read-only from the API's perspective: entries are written by services as
 * a side effect of a mutation, and only ever listed back — there is no
 * update or delete endpoint, by design (an editable audit log isn't one).
 */
const auditLogSchema = new Schema(
  {
    // A short, dot-namespaced action code, e.g. 'sale.create', 'product.update'.
    action: { type: String, required: true, trim: true, maxlength: 100 },
    // The kind of entity affected, e.g. 'Sale', 'Product' — matches the
    // Mongoose model name.
    entityType: { type: String, required: true, trim: true, maxlength: 50 },
    entityId: { type: Schema.Types.ObjectId, default: null },
    // The device that performed the action — null only for actions with no
    // device context at all (there always should be one in practice, since
    // every mutating route requires a registered device).
    actorDeviceId: { type: String, default: null, trim: true, maxlength: 200 },
    // Curated, action-specific fields relevant for review (e.g.
    // { total, paid, paymentMethod } for a sale, or { before, after } for an
    // update) — intentionally `Mixed` since the shape genuinely varies per
    // action type; never a full document, never secrets (see the pre-save
    // guard below).
    values: { type: Schema.Types.Mixed, default: {} },
    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

auditLogSchema.pre('validate', function stripSensitiveValues(next) {
  if (this.values && typeof this.values === 'object') {
    for (const key of FORBIDDEN_VALUE_KEYS) {
      delete this.values[key];
    }
  }
  next();
});

auditLogSchema.index({ at: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ action: 1, at: -1 });

export default models.AuditLog || model('AuditLog', auditLogSchema);
