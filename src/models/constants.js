// Centralized enums so a valid value only has to be spelled correctly once,
// and later phases (services/controllers/validation) import the same list
// instead of re-typing magic strings.

export const PAYMENT_METHODS = ['cash', 'credit'];

export const CASHBOX_TX_TYPES = ['in', 'out'];

export const CASHBOX_REF_TYPES = ['sale', 'purchase', 'expense', 'manual'];

// Human-readable activity feed types — matches the current frontend's
// `state.activity` exactly. Not to be confused with the future, more
// detailed `AuditLog` (Phase: Audit Log), which will record actor/device
// and before/after values for security review; this one stays a light,
// user-facing feed.
export const ACTIVITY_TYPES = ['product', 'customer', 'supplier', 'sale', 'purchase', 'expense', 'cash', 'settings'];
