# System 1 — Backend

Production-ready backend for Shop **System 1** (Node.js + Express + MongoDB),
built to run as a Vercel serverless function with its own, fully independent
MongoDB Atlas cluster (Systems 2–4 will each get their own copy of this
backend with their own database and Cloudinary account — no data is shared
between systems).

This is being built **in phases**. Phases completed so far:

- **Phase 1 — Backend Foundation**: app skeleton, configuration, security
  middleware, logging, error handling, serverless-ready MongoDB connection.
- **Phase 2 — Database Models + Indexes**: Mongoose schemas for every entity
  (see `src/models/README.md` for the full design rationale).
- **Phase 3 — Authentication**: single shop-wide password login, JWT access
  tokens, device-session registration capped at 2 devices, device
  management endpoints, and password change. See `src/services/README.md`
  for the full design rationale.
- **Phase 4 — Products & Inventory**: full CRUD, matching the frontend's
  InventoryPage search/filter/sort exactly, paginated and index-backed.
- **Phase 5 — Customers & Suppliers**: full CRUD with rolled-up totals
  (total/paid/remaining/count/last transaction), blocked deletion when
  transactions are on file, and search — built once as a shared factory
  since the two entities are structurally identical.
- **Phase 6 — Sales / POS**: transactional sale creation (custom per-line
  pricing, atomic stock guard, safe concurrent-proof invoice numbering) plus
  paginated/searchable sales history. See "MongoDB transactions" below.
- **Phase 7 — Purchases**: transactional purchase creation with fully atomic
  weighted-average cost recalculation, backdating support, plus paginated/
  searchable purchase history. Also extracted the shared `withTransaction`
  helper (with transient-error retry) used by both Sales and Purchases.
- **Phase 8 — Cashbox & Expenses**: balance/summary, transaction history,
  manual deposits/withdrawals with a race-safe balance check, and expenses
  that keep their linked cashbox entry consistent via the same transaction.
- **Phase 9 — Invoices & Reports**: every ReportsPage tab (sales, purchases,
  profit, inventory, customers, suppliers) computed server-side via MongoDB
  aggregation — the frontend will only ever receive the numbers it displays,
  never the raw transaction history it would otherwise have to sum itself.
- **Phase 10 — Audit Log**: a structured, security-focused audit trail
  (distinct from the lightweight ActivityLog feed) recording who — i.e.
  which registered device — did what, when, to which entity, with curated
  before/after values. Wired into every mutating service in the project.
  See "Audit Log" below and `src/services/README.md` for the full design.

Frontend wiring is now **complete** (see the frontend's own
`FRONTEND_INTEGRATION.md` for the full sub-phase-by-sub-phase account). Two
small backend gaps surfaced along the way and were filled with full test
coverage rather than worked around on the frontend side: `GET /api/activity`
(the write path, `recordActivity`, existed since Phase 4, but no read
endpoint did) and `GET`/`PATCH /api/settings` (the `Settings` model existed
since Phase 2, but no route ever read or wrote it). Both are in the table
below.

## Stack

- Node.js (ESM) + Express 4
- MongoDB Atlas + Mongoose, with MongoDB session transactions for
  multi-document operations (Sales, Purchases, Expenses)
- JWT access tokens + bcrypt-hashed shop password + SHA-256-hashed refresh
  tokens (see Authentication below)
- `helmet` for security headers, `cors`, `express-rate-limit`
- `pino` structured logging (redacts passwords/tokens/secrets automatically)
- `zod` for fail-fast environment validation and request validation
- `vitest` + `supertest` for testing

## Getting started

```bash
npm install
cp .env.example .env   # edit as needed — MONGODB_URI can stay empty for now
npm run dev             # http://localhost:4000
```

```bash
npm run lint
npm test
```

## What exists right now

```
backend/
├── api/
│   └── index.js          # Vercel serverless entrypoint (reuses createApp + cached DB connection)
├── scripts/
│   ├── sync-indexes.js     # Explicit index sync (autoIndex is off in production — see below)
│   └── seed-shop-password.js  # Bootstrap/reset the shop login password (see Authentication below)
├── src/
│   ├── app.js             # Express app factory: helmet, CORS, body parsing, logging, rate limit, routes
│   ├── server.js          # Local dev entrypoint only (not used on Vercel)
│   ├── config/
│   │   ├── env.js         # zod-validated environment config, fails fast on bad/missing config
│   │   ├── logger.js      # pino logger with secret/credential redaction
│   │   ├── db.js          # MongoDB connection with warm-invocation caching (serverless-safe)
│   │   ├── jwt.js         # Access token sign/verify
│   │   └── cloudinary.js  # Cloudinary SDK config — optional, see "Product images" below
│   ├── middleware/
│   │   ├── errorHandler.js  # AppError class + centralized error formatting (hides internals in prod)
│   │   ├── asyncHandler.js  # wraps async route handlers so rejections reach the error handler
│   │   ├── auth.js          # requireAuth — verifies the Bearer access token
│   │   ├── validate.js      # validateBody/validateQuery(zodSchema) — generic request validation
│   │   └── validateObjectId.js  # validateObjectIdParam — rejects malformed :id params early
│   ├── models/             # Mongoose schemas — see src/models/README.md for full design rationale
│   │   ├── Product.js, Customer.js, Supplier.js, Sale.js, Purchase.js,
│   │   ├── Expense.js, CashboxTransaction.js, ActivityLog.js, Settings.js,
│   │   ├── ShopAuth.js, DeviceSession.js, Counter.js, AuditLog.js
│   │   ├── constants.js    # shared enums (payment methods, cashbox types, ...)
│   │   ├── shared/money.js # non-negative, auto-rounded money field helper
│   │   └── index.js        # barrel export
│   ├── services/
│   │   ├── auth.service.js    # login/refresh/logout/device management/password change — see README
│   │   ├── product.service.js # list (paginated/searchable/filterable/sortable), CRUD
│   │   ├── personService.js   # shared CRUD+totals factory for Customer/Supplier
│   │   ├── customer.service.js  # personService instantiated for Customer/Sale
│   │   ├── supplier.service.js  # personService instantiated for Supplier/Purchase
│   │   ├── sale.service.js    # createSale (transactional), listSales, getSale — see README
│   │   ├── purchase.service.js # createPurchase (transactional, weighted-avg cost), listPurchases, getPurchase
│   │   ├── cashbox.service.js  # getBalance/getSummary, listCashboxTransactions, createCashTransaction
│   │   ├── expense.service.js  # listExpenses/getSummary, transactional create/delete (keeps cashbox in sync)
│   │   ├── reports.service.js  # every ReportsPage tab, computed via aggregation — see README
│   │   ├── auditLog.service.js # recordAuditLog (called by every service above), listAuditLogs — see README
│   │   ├── settings.service.js # getSettings (auto-creates singleton), updateSettings — added during frontend wiring
│   │   ├── upload.service.js # getUploadSignature() — Cloudinary direct-upload token, see "Product images" below
│   │   ├── sequence.service.js # nextSequence() — atomic invoice/purchase numbering
│   │   ├── activityLog.service.js  # shared recordActivity() + listActivity(), used by every phase
│   │   └── README.md
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── product.controller.js
│   │   ├── sale.controller.js
│   │   ├── purchase.controller.js
│   │   ├── cashbox.controller.js
│   │   ├── expense.controller.js
│   │   ├── reports.controller.js
│   │   ├── auditLog.controller.js
│   │   ├── activity.controller.js
│   │   ├── settings.controller.js
│   │   └── upload.controller.js
│   ├── utils/
│   │   ├── password.js     # bcrypt hash/verify
│   │   ├── tokens.js       # refresh token generation + SHA-256 hashing/comparison
│   │   ├── mongoErrors.js  # isDuplicateKeyError — turns a raw E11000 into a clean AppError
│   │   ├── transactions.js # withTransaction() — MongoDB session transaction + transient-error retry
│   │   └── requestContext.js # AsyncLocalStorage — carries the acting deviceId to audit logging
│   └── routes/
│       ├── index.js        # mounts all route groups under /api
│       ├── health.route.js # GET /api/health (liveness), GET /api/health/db (DB readiness)
│       ├── auth.route.js   # POST /login, /refresh, /logout, GET/DELETE /devices, PATCH /password
│       ├── product.route.js # full CRUD, all requiring authentication
│       ├── personRoutes.js  # shared router factory used by customer.route.js/supplier.route.js
│       ├── customer.route.js
│       ├── supplier.route.js
│       ├── sale.route.js    # POST (create), GET (history, paginated/searchable/filterable)
│       ├── purchase.route.js # same shape as sale.route.js
│       ├── cashbox.route.js  # GET (history), GET /summary, POST (manual in/out)
│       ├── expense.route.js  # GET (history), GET /summary, POST (create), DELETE
│       ├── reports.route.js  # GET /sales, /purchases, /profit, /inventory, /customers, /suppliers
│       ├── auditLog.route.js # GET only — no write endpoints, by design
│       ├── activity.route.js # GET only — added while wiring the frontend (see below)
│       ├── settings.route.js # GET + PATCH — added while wiring the frontend (see below)
│       └── upload.route.js # GET /signature only — no upload route, see "Product images" below
├── tests/                 # vitest + supertest (453 tests)
├── scripts/
│   ├── sync-indexes.js     # creates every model's declared indexes
│   ├── seed-shop-password.js # first-time/emergency-recovery password seed
│   └── smoke-test.js       # post-deploy verification — see DEPLOYMENT.md
├── vercel.json            # routes all /api/* to the single serverless function
├── DEPLOYMENT.md          # step-by-step Vercel + Atlas deployment guide
├── E2E_CHECKLIST.md       # business-rule checklist to run against real infra
└── .env.example
```

## Endpoints available today

| Method | Path | Auth required | Purpose |
|---|---|---|---|
| GET | `/api/health` | No | Liveness — always responds, never touches the DB |
| GET | `/api/health/db` | No | Reports current MongoDB connection state |
| POST | `/api/auth/login` | No (rate-limited) | Shop password + deviceId → access/refresh tokens |
| POST | `/api/auth/refresh` | No | Rotates the refresh token, issues a new access token |
| POST | `/api/auth/logout` | Yes | Clears this device's session (keeps its device slot) |
| GET | `/api/auth/devices` | Yes | Lists the (up to 2) registered devices |
| DELETE | `/api/auth/devices/:id` | Yes | Revokes a device, freeing its slot |
| PATCH | `/api/auth/password` | Yes | Changes the shop password; signs out every other device |
| GET | `/api/products` | Yes | Paginated list — `page`, `limit`, `search`, `filter` (`low`/`out`/`available`), `sort` (`name`/`qtyAsc`/`qtyDesc`/`profit`) |
| GET | `/api/products/:id` | Yes | Get one product |
| POST | `/api/products` | Yes | Create a product (409 on a duplicate code) |
| PATCH | `/api/products/:id` | Yes | Partial update — omitted fields are left untouched |
| DELETE | `/api/products/:id` | Yes | Delete (no check against sale/purchase history — see below) |
| GET | `/api/customers` | Yes | Paginated list, each with rolled-up `totals` (total/paid/remaining/count/lastPurchase) |
| GET / POST / PATCH / DELETE | `/api/customers[/:id]` | Yes | Full CRUD; delete blocked (409) if the customer has sales on file |
| GET / POST / PATCH / DELETE | `/api/suppliers[/:id]` | Yes | Same shape as customers, rolled up from Purchase instead of Sale |
| GET | `/api/sales` | Yes | Paginated sales history — `search` (invoice # or customer name), `customerId`, `paymentMethod`, `from`/`to` date range |
| GET | `/api/sales/:id` | Yes | Get one sale |
| POST | `/api/sales` | Yes | Create a sale — transactional (see below) |
| GET | `/api/purchases` | Yes | Paginated purchase history — `search` (purchase # or supplier name), `supplierId`, `paymentMethod`, `from`/`to` date range |
| GET | `/api/purchases/:id` | Yes | Get one purchase |
| POST | `/api/purchases` | Yes | Create a purchase — transactional, recalculates weighted-average cost |
| GET | `/api/cashbox` | Yes | Paginated transaction history — `type`, `search` (reason), `from`/`to` |
| GET | `/api/cashbox/summary` | Yes | `{ balance, todayIn, todayOut }` |
| POST | `/api/cashbox` | Yes | Manual deposit/withdrawal (create-only — no edit/delete, matches the frontend) |
| GET | `/api/expenses` | Yes | Paginated list — `reason` (exact or 'all'), `from`/`to`; response includes `totalAmount` over all matches |
| GET | `/api/expenses/summary` | Yes | `{ todayTotal, monthTotal }` |
| POST | `/api/expenses` | Yes | Create — transactional with its linked cashbox 'out' entry |
| DELETE | `/api/expenses/:id` | Yes | Delete — transactional, removes the linked cashbox entry too |
| GET | `/api/reports/sales` | Yes | `from`/`to` — revenue, invoice count, cash/credit split, collected/outstanding, top 5 best-selling products |
| GET | `/api/reports/purchases` | Yes | `from`/`to` — totals, plus every supplier's total/paid/remaining |
| GET | `/api/reports/profit` | Yes | `from`/`to` — revenue, cost of goods sold, gross, expenses, net |
| GET | `/api/reports/inventory` | Yes | No params — a snapshot of the current catalog (stock value, low/out-of-stock counts) |
| GET | `/api/reports/customers` | Yes | `limit` (default 8) — all-time outstanding totals + top customers by spend |
| GET | `/api/reports/suppliers` | Yes | Same shape as customers, rolled up from Purchase |
| GET | `/api/audit-log` | Yes | Paginated — `action`, `entityType`, `actorDeviceId`, `from`/`to`. No write endpoints exist. |
| GET | `/api/activity` | Yes | Paginated activity feed — `type`, `from`/`to`. No write endpoints exist (entries are written internally via `recordActivity`). Added while wiring the frontend's Dashboard/Activity pages (a gap: `recordActivity` existed since Phase 4, but no read endpoint did until now). |
| GET | `/api/settings` | Yes | Singleton shop config; auto-creates with defaults on first read. |
| PATCH | `/api/settings` | Yes | Partial update. Deliberately no `accessCode`/password field — that lives only in `PATCH /api/auth/password`. Added while wiring the frontend's Settings page (a gap: the `Settings` model existed since Phase 2, but no route read/wrote it until now). |
| GET | `/api/uploads/signature` | Yes | Signed, short-lived token for a **direct browser-to-Cloudinary upload** — product image bytes never pass through this backend. No POST/upload route exists here on purpose. See "Product images (Cloudinary)" below. |

Every other path returns a consistent 404 JSON shape via the central error handler:

```json
{ "success": false, "error": { "message": "المسار غير موجود: GET /api/whatever" } }
```

### First-time setup

There's no public "set the initial password" endpoint (that would be an
unauthenticated way to take over the account). Instead, set it once directly
against the database:

```bash
npm run seed-password -- "your-shop-password"
```

Day-to-day password changes go through `PATCH /api/auth/password` instead,
which requires the current password and correctly signs out other devices.
Re-run the seed script only for first-time setup or emergency recovery (e.g.
the password was forgotten and every device is already lost).

## Design decisions worth knowing about

- **Serverless-safe DB connections.** `connectDB()` caches the Mongoose
  connection (and the in-flight connection promise) on `global`, so repeated
  calls across warm Vercel invocations reuse one connection instead of
  opening a new one per request — this is what keeps us under Atlas's
  connection limits in a serverless environment. Concurrent calls before the
  first connection resolves are de-duplicated into a single `mongoose.connect()`
  (covered by a test).
- **App never crashes at boot without a DB.** `MONGODB_URI` is optional in
  development/test; only `NODE_ENV=production` requires it (same for
  `JWT_ACCESS_SECRET`). `/api/health` works with no database at all — useful
  while Atlas/env vars are still being wired up.
- **Centralized errors.** Routes throw `AppError(message, statusCode, details)`
  for expected/business errors; anything else (a bug) is logged in full but
  shown to the client as a generic message in production, never leaking stack
  traces or internals.
- **No secrets in logs.** `pino`'s redaction is configured for `password`,
  `accessCode`, `token`, `refreshToken`, `secret`, and the `Authorization`/
  `Cookie` headers, wherever they appear in a logged object.
- **Images will go to Cloudinary, not MongoDB.** No image handling exists yet
  in this phase, but the plan (confirmed) is: the frontend uploads directly to
  System 1's own Cloudinary account, and only the resulting URL is ever stored
  in MongoDB — the backend never receives or stores raw image bytes.
- **Login model (confirmed, implemented in Phase 3):** a single shop-wide
  password (not per-employee accounts), with a hard cap of **2 simultaneously
  registered devices**, enforced by `deviceId` — a persistent, client-generated
  identifier (`crypto.randomUUID()`, stored in localStorage), never by
  IP/User-Agent alone. See `src/services/README.md` for the full auth design:
  token transport, refresh rotation, why logout doesn't free a device slot,
  and what happens to other devices on a password change.
- **Product search/filter/sort matches the frontend exactly, including its
  quirks** (Phase 4): substring match on name OR code (not a MongoDB `$text`
  search, which tokenizes on whole words and wouldn't replicate "type any
  fragment" search UX), `low`/`out`/`available` stock filters, and a `profit`
  sort computed on the fly. All four are done in a **single aggregation**
  (`$facet`) per request — one round-trip to MongoDB for both the page of
  results and the total count, instead of two separate queries.
- **Partial updates never inject defaults.** `PATCH /api/products/:id` uses a
  dedicated update schema (not `createSchema.partial()`) — a `.partial()`
  derived from a schema with `.default(...)` would silently reset any omitted
  field to its default (e.g. a PATCH that only changes `name` would zero out
  `purchasePrice`). Covered by a test at both the service and HTTP layer.
- **Product deletion has no referential check against Sale/Purchase history**
  — this matches the current frontend's `deleteProductSvc` exactly, and isn't
  an oversight: every Sale/Purchase line already stores its own
  name/code/price snapshot independent of the live Product document, so
  deleting a product never corrupts a past invoice or report. (Customer/
  Supplier deletion, by contrast, IS blocked when they have transactions on
  file — the frontend draws that line differently, and the backend preserves
  it exactly as-is.)
- **Customer and Supplier share one implementation** (Phase 5,
  `src/services/personService.js` + `src/routes/personRoutes.js`) — they're
  structurally identical (name/phone/address, blocked deletion when
  referenced, name-or-phone search, totals rolled up from a related
  transaction collection), configured per-entity via which Model/collection/
  field/labels to use rather than duplicating the same CRUD + aggregation
  logic twice. `customer.service.js`/`supplier.service.js` are then just a
  few lines each. Tests cover the shared factory once, plus a small wiring
  test per entity confirming it's actually configured against the right
  model/field (catches a copy-paste mistake like using `supplierId` on the
  customer service).
- **List totals are computed per-page, not per-record.** `GET /api/customers`
  returns each customer with its rolled-up `totals` — computed via a single
  `$lookup`-based aggregation scoped to just the current page's results, so
  displaying a list of customers never triggers one query per customer
  (the N+1 pattern the project explicitly rules out).
- **MongoDB transactions, shared across Sales and Purchases**
  (`src/utils/transactions.js`). Both `createSale` and `createPurchase` touch
  multiple documents across multiple collections that must succeed or fail
  together — a failed sale must never leave stock decremented with nothing
  to show for it; a failed purchase must never leave a product's cost/
  quantity updated with nothing to show for it. `withTransaction()` wraps
  MongoDB's session transaction API once, in one place, and adds the
  officially recommended retry-on-transient-error pattern for replica-set
  transactions (a write conflict with another concurrent transaction on the
  same document, or a brief network blip, is expected under real traffic and
  is safe to retry — the whole transaction is atomic, so a retry re-runs
  cleanly from scratch). A genuine business-rule rejection (`AppError` —
  insufficient stock, an invalid price, ...) is never retried, since it isn't
  a real MongoDB driver error and doesn't carry the transient-error label.
  This requires a replica set — Atlas runs as one by default even on the
  free tier, so no extra infrastructure is needed.
- **Weighted-average cost as a single atomic write, not read-then-write**
  (Phase 7, `purchase.service.js`). Rather than reading a product's current
  quantity/cost, computing the new weighted average in JavaScript, and
  writing it back (a window where a concurrent purchase on the same product
  could read stale data), the update is sent as a MongoDB **aggregation-
  pipeline update** — the new `quantity` and `purchasePrice` are computed
  *from the document's current state at the moment of the write itself*, in
  one atomic operation. This closes the race window entirely rather than
  just narrowing it, and correctly handles even an unusual purchase that
  lists the same product on two separate lines (each update reads-and-writes
  the current document state in sequence). Example:
  `6 @ 10 already in stock + 6 @ 15 new => (6×10 + 6×15) / 12 = 12.5`.
  Sales use a related but simpler technique for the same reason: an atomic
  `updateOne` with a `quantity: { $gte: needed }` guard, re-checking stock
  availability at write time rather than trusting the read taken earlier in
  the same request.
- **Safe, concurrent-proof invoice/purchase numbering** (Phase 6/7). The
  frontend's mock `nextNumber()` scans existing records and takes `max + 1`
  — fine for one in-memory user, unsafe for a real backend where two
  requests could compute the same "next" number at once.
  `src/services/sequence.service.js` uses a dedicated `Counter` collection
  with an atomic `findOneAndUpdate($inc)` instead — atomic at the MongoDB
  level even without a transaction, so two concurrent sales/purchases can
  never receive the same number.
- **Purchases have no upper-bound quantity check** — unlike sales (which
  can't exceed available stock), a purchase only rejects a zero/negative
  quantity or an invalid price; any positive quantity is accepted, since
  purchases are how stock increases in the first place. Matches the
  frontend's `addPurchaseSvc` exactly.
- **The cashbox balance is a running total over full history, computed on
  read** (Phase 8), not a cached/materialized field — matches the frontend's
  `cashboxBalance` selector exactly (`sum(in) - sum(out)`). A
  balance-sufficiency check (before a withdrawal or an expense) reads this
  total *inside the same transaction* as the write that follows it — reading
  it beforehand, outside any transaction, would let two concurrent
  withdrawal requests each see the same "sufficient" balance and both
  proceed, together overdrawing the cashbox.
- **An expense and its cashbox entry are two core financial records that
  must never drift apart** (Phase 8) — creating or deleting an expense
  writes/removes both together in one transaction, the same reasoning as
  Sales/Purchases keeping stock and the transaction record consistent. By
  contrast, a manual cashbox transaction only touches one core collection
  (itself) plus an activity-log entry, so it doesn't need the same multi-
  document guarantee — it's still wrapped in a transaction, but only because
  a withdrawal's balance check needs to run inside one for the race-safety
  reason above, not because of a cross-collection consistency requirement.
- **Reports are computed entirely server-side via aggregation, never by
  shipping raw records to the frontend to sum** (Phase 9) — the frontend's
  `ReportsPage` currently loads the *entire* sales/purchases/expenses arrays
  from memory and reduces them client-side; the backend equivalent returns
  only the handful of numbers each tab actually displays. Every report that
  needs both a summary and a list (sales' best-sellers, purchases' supplier
  balances, customers'/suppliers' top-N) computes both branches in a single
  aggregation via `$facet` — one round-trip, not one query for the summary
  and another for the list. `getInventoryReport`, `getCustomersReport`, and
  `getSuppliersReport` intentionally ignore any date range, matching the
  frontend exactly: inventory value is a snapshot of *now*, and a customer's
  or supplier's outstanding balance is always all-time, independent of
  whatever report period is selected elsewhere on the page. The frontend's
  "today/week/month" period buttons resolve to concrete `from`/`to` dates
  before calling the API — the backend only ever sees a plain date range,
  the same shape used by Sales/Purchases/Cashbox history filters.

### Product images (Cloudinary)

Per the confirmed original design, this backend **never receives or stores
image bytes** — `Product.image` (Phase 2) has only ever been a URL string.
That direct-upload flow itself wasn't actually wired up until now, though:
`GET /api/uploads/signature` is the entire server-side footprint of it — an
authenticated route that returns a short-lived, cryptographically signed
token (`cloudinary.utils.api_sign_request`, using each System's own
`CLOUDINARY_API_SECRET`, never exposed to the client) plus the public,
non-secret `cloud_name`/`api_key`/`folder` the frontend needs. The frontend
then uploads the actual file straight to Cloudinary's own API using that
signature — this backend is never in that request path at all, and never
sees the image.

The signature locks the upload into one fixed, server-controlled
`folder` (`CLOUDINARY_UPLOAD_FOLDER`, default `system1/products` — matches
this System's own isolated account, never shared with Systems 2-4, same
rule as the database). Signed (not unsigned-preset) uploads were chosen
deliberately: an unsigned preset's `cloud_name`/preset name are visible in
any browser's dev tools, and anyone who found them could upload arbitrary
files to the account indefinitely; a signature is minted fresh per request,
only to an authenticated session, and expires (Cloudinary rejects a
signature whose `timestamp` is too old).

Cloudinary credentials are optional at startup (`env.js`) — unlike Mongo/
JWT, the app boots and runs fully without them; only `getUploadSignature()`
itself fails clearly (503, `CLOUDINARY_NOT_CONFIGURED`) if a request needs
them and they're missing, rather than the whole server refusing to start.

### Audit Log (Phase 10)

Per the confirmed design (single shop-wide login, no per-employee accounts),
"who did this" can only ever mean *which registered device* — never a
person's name. `AuditLog` is a **separate, structured** record from the
lightweight, user-facing `ActivityLog` feed built in earlier phases: it
stores a coded `action` (e.g. `'sale.create'`, `'product.update'`), the
affected `entityType`/`entityId`, the acting `actorDeviceId`, a timestamp,
and a curated `values` object — never a full document dump, never a
password/token/secret (enforced twice: callers are expected to only pass
safe fields, and the schema itself strips a fixed list of dangerous keys as
a backstop — see `AuditLog.js`). There is deliberately **no write endpoint**:
entries are only ever created internally, as a side effect of a mutation.

**Wired into every mutating service in the project** — product, customer/
supplier, sale, purchase, cashbox, expense, and auth (login success/
failure, logout, password change, device revocation). Getting the acting
device's id to every one of those call sites *without* adding an extra
parameter to every service function's signature is what
`src/utils/requestContext.js` is for: it uses Node's built-in
`AsyncLocalStorage` to make the deviceId set by `requireAuth` available
anywhere further down the same request's call chain, however deeply nested,
with zero changes to any other function's signature. The one place this
doesn't apply is the login flow itself, which runs *before* authentication
succeeds — `auth.service.js`'s `login()` passes `actorDeviceId` explicitly
there, since no request context exists yet at that point.

For `product.update` and the shared `Customer`/`Supplier` update (in
`personService.js`), the audit entry captures a **precise before/after diff**
— only the fields actually present in the update payload, snapshotted before
the change and again after — rather than a full document, which is what
actually answers "what changed" on review. Sale/Purchase/Cashbox/Expense
creation all record their audit entry *inside the same MongoDB transaction*
as everything else that operation touches (same reasoning as
`recordActivity` participating in those transactions): a failed operation
must never leave behind an audit entry claiming it succeeded.

## Roadmap (subsequent phases — business logic isn't wired up to real routes yet)

1. ~~Backend foundation~~ ✅
2. ~~Database models + indexes~~ ✅ (Product, Customer, Supplier, Sale, Purchase, Expense, CashboxTransaction, ActivityLog, Settings, ShopAuth, DeviceSession)
3. ~~Authentication~~ ✅ (shop password login, JWT, device-session limit of 2, device management, password change)
4. ~~Products & inventory~~ ✅ (full CRUD, search/filter/sort matching the frontend, paginated)
5. ~~Customers & suppliers~~ ✅ (full CRUD, rolled-up totals, blocked deletion when referenced)
6. ~~Sales / POS~~ ✅ (transactional creation, custom per-line pricing, atomic stock guard, safe invoice numbering, history list)
7. ~~Purchases + weighted-average cost logic~~ ✅ (transactional, fully atomic pipeline-update, backdating, history list)
8. ~~Cashbox & expenses~~ ✅ (race-safe balance checks, expense/cashbox consistency via transactions)
9. ~~Invoices & reports~~ ✅ (every ReportsPage tab, computed server-side via aggregation)
10. ~~Audit log~~ ✅ (structured trail wired into every mutating service, device-scoped actor identity)
11. ~~Wire the existing frontend to this API~~ ✅ (all sub-phases 11a–11i — see the frontend's `FRONTEND_INTEGRATION.md` for the full account, including two small backend gaps it surfaced and closed: `GET /api/activity` and the `/api/settings` endpoints)
12. ~~Deployment prep~~ ✅ — `DEPLOYMENT.md` (step-by-step Vercel + Atlas
    setup), `scripts/smoke-test.js` (a real HTTP client that exercises the
    full health → DB → login → authenticated read → refresh → logout chain
    against a live deployment — verified here against a local server; fails
    fast and clearly if the database isn't reachable rather than hanging
    through a cascade of doomed auth calls), and `E2E_CHECKLIST.md` (the
    critical business rules — weighted-average cost, the device limit,
    custom sale pricing, cashbox/expense consistency, and more — to verify
    once against real infrastructure, each pointing at the code it checks).
13. **Run that checklist against real infrastructure.** This sandbox has no
    network access to provision a real MongoDB Atlas cluster or a live
    Vercel deployment, so this step genuinely has to happen outside it:
    provision Atlas, set the real environment variables, deploy both
    projects per `DEPLOYMENT.md`, then run `E2E_CHECKLIST.md` in full.

Each phase ships with its own tests and stops for review before the next one starts.
