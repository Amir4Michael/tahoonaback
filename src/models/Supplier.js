import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    phone: { type: String, default: '', trim: true, maxlength: 30 },
    address: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { timestamps: true },
);

supplierSchema.index({ name: 'text', phone: 'text' });
supplierSchema.index({ phone: 1 });

// Deletion is blocked in the service layer if the supplier has any purchases
// (same reasoning as Customer — cross-collection check belongs in the service).

export default models.Supplier || model('Supplier', supplierSchema);
