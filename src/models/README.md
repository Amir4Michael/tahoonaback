# Data Models (Phase 2)

Mongoose schemas only in this phase — no controllers/routes/services yet
(those start in the Products phase and onward). Every business rule below is
enforced (or explicitly deferred, and noted where) at the schema level.

## Models

| Model | Purpose |
|---|---|
| `Product` | Catalog item. `purchasePrice` is the CURRENT weighted-average cost. |
| `Customer` | Buyer on file (optional — sales can be walk-in/cash). |
| `Supplier` | Vendor products are purchased from. |
| `Sale` | An invoice. `items[]` is a full price/cost **snapshot**, not a live reference. |
| `Purchase` | A restock. `items[]` snapshot feeds the weighted-average recalculation. |
| `Expense` | A cash outflow reason (rent, salaries, ...). |
| `CashboxTransaction` | Every in/out movement of the cashbox, auto-generated or manual. |
| `ActivityLog` | Light, human-readable activity feed (see `AuditLog` for the separate, structured security trail). |
| `AuditLog` | Structured audit trail (Phase 10) — action, entity, acting device, curated before/after values. Read-only from the API. |
| `ShopAuth` | Singleton holding the hashed shop-wide login password (Phase 3). |
| `DeviceSession` | Registered device sessions, capped at 2 (Phase 3). |
| `Counter` | Atomic sequence generator backing invoice/purchase numbering (Phase 6/7). |
| `Settings` | Singleton shop configuration — **no login credential lives here.** |

## Business rules this phase encodes

- **Historical integrity.** `Sale.items[]` and `Purchase.items[]` store
  `name`/`code`/`price`(/`cost` for sales) as snapshots at transaction time —
  never resolved live through `productId`. A product's price/cost changing
  later cannot retroactively alter a past invoice.
- **Custom sale price per line.** `Sale.items[].price` has no relationship
  enforced to `Product.salePrice` — the service layer (POS phase) is free to
  stamp a different, validated price per line without ever writing back to
  the product.
- **Weighted-average cost.** `Product.purchasePrice` is a plain, mutable
  field — the actual `(oldQty×oldCost + newQty×newCost) / totalQty`
  calculation lives in the service layer (Purchases phase), not in the
  schema; the schema just guarantees it can never go negative.
- **No plaintext credentials near shop info.** `Settings` deliberately has no
  `accessCode`/password field, unlike the current frontend's mock state. The
  hashed shop login credential gets its own collection in the Authentication
  phase.
- **No cross-collection checks in the schema.** "Can't delete a customer with
  sales on file" needs a query against `Sale`, which a Mongoose validator
  can't cheaply do on every unrelated save — that check lives in the service
  layer, not here.

## Conventions

- **Money fields** use the shared `moneyField()` helper
  (`src/models/shared/money.js`): non-negative `Number`, rounded to 2 decimal
  places on every write via a `set` transform, so float drift never
  accumulates across repeated weighted-average recalculations.
- **Enums** are centralized in `src/models/constants.js` so a valid value is
  spelled correctly in exactly one place.
- **Embedded line items** (`Sale.items`, `Purchase.items`) use `{ _id: false }`
  — they're simple snapshots, not entities that need their own identity, and
  skipping the extra `_id` per line saves a little storage/bandwidth per the
  project's performance requirements.
- **`models.X || model('X', schema)`** guards every model definition against
  `OverwriteModelError` when the module is reloaded (dev `--watch`, test
  runners) — harmless in production where a module only loads once anyway.

## Indexes

Every model declares its indexes via `schema.index(...)`, but **`autoIndex`
is disabled in production** (see `src/config/db.js`) — checking/creating
indexes on every serverless cold start is wasted round-trips to Atlas for
something that only changes when a model's indexes change. Instead:

```bash
npm run sync-indexes
```

Run this once against a fresh database, and again any time an index
declaration changes. In development, `autoIndex` stays on so indexes just
work without a manual step.

## Testing approach for this phase (and why)

Every model has `validateSync()`-based tests (schema validation — required
fields, `min`, `enum`, custom validators) plus assertions on
`schema.indexes()` (confirming the intended indexes are declared, with the
right `unique` flags).

**What this phase's tests do *not* cover:** actual database-level enforcement
(e.g. a real duplicate `code` insert being rejected by MongoDB) — Mongoose's
`validateSync()` never touches a database, and `unique` isn't a validator,
it's an index. This sandbox's network policy doesn't allow downloading a
local MongoDB binary for an in-process test database, so that layer will get
integration-tested against a real MongoDB Atlas connection once one is wired
up (or you're welcome to add `mongodb-memory-server` yourself in an
environment where its binary download isn't blocked — the schemas
themselves don't need any changes for that).
