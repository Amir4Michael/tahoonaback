import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

const customerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    phone: { type: String, default: '', trim: true, maxlength: 30 },
    address: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { timestamps: true },
);

// Powers the POS "quick customer search" (by name or phone).
customerSchema.index({ name: 'text', phone: 'text' });
customerSchema.index({ phone: 1 });

// Deletion is blocked in the service layer if the customer has any sales —
// enforced there (not here) since it requires checking a different
// collection, which a schema-level validator can't do without an extra query
// on every unrelated save.

export default models.Customer || model('Customer', customerSchema);
