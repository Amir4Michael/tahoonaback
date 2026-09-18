import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

const customerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    phone: { type: String, default: '', trim: true, maxlength: 30 },
    address: { type: String, default: '', trim: true, maxlength: 300 },
    // Balance carried over from before this system was in use (paper
    // books) — set once at onboarding (or corrected later only through
    // customerOpeningBalance.service.js's guarded path, never through the
    // normal update() below — see that file's docstring for why). Folded
    // into personBalance.service.js's getPersonRemaining and
    // personService.js's getTotals/list as a starting term, exactly like
    // an extra historical Sale would be — but it IS NOT a Sale, is never
    // written to Cashbox/ActivityLog's financial totals, and is invisible
    // to every Sales/Profit/Inventory report; it only ever affects this
    // one person's own remaining/creditOwed balance.
    openingBalance: {
      amount: { type: Number, min: 0, default: 0 },
      // 'they_owe_us': counted toward `remaining` (this customer owes the
      // shop from before). 'we_owe_them': counted toward `creditOwed` (the
      // shop owes this customer from before — e.g. a credit they were
      // never paid out).
      direction: { type: String, enum: ['they_owe_us', 'we_owe_them'], default: 'they_owe_us' },
    },
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