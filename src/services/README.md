# Services

## `auth.service.js` (Phase 3 — Authentication)

Implements the confirmed login model: **one shop-wide password, up to 2
simultaneously registered devices**, no per-employee accounts, no
roles/permissions.

### Token transport

Two tokens, both returned in the JSON response body (no cookies):

- **Access token** — a short-lived JWT (`ACCESS_TOKEN_TTL_MINUTES`, default
  15 min), signed with `JWT_ACCESS_SECRET`, carrying only `{ deviceId }`. Sent
  by the frontend as `Authorization: Bearer <token>` on every request.
- **Refresh token** — a long-lived (`REFRESH_TOKEN_TTL_DAYS`, default 30
  days), opaque, high-entropy random string. Stored by the frontend
  (localStorage, alongside its `deviceId`) and sent to `POST /api/auth/refresh`
  to get a new access token once the old one expires.

**Why not httpOnly cookies?** They're more XSS-resistant, but the frontend
and backend are deployed as **separate Vercel projects on different
domains**, which means cross-domain cookies need `SameSite=None; Secure` plus
`credentials: true` on every request — extra moving parts for a shop-internal
tool with no third-party embedding. Bearer-token-in-header is the simpler,
equally standard choice for this specific architecture, and is what's
implemented. (If this ever needs to be hardened further, migrating to
httpOnly cookies is a contained change — it wouldn't touch the device-limit
or password logic at all.)

### Why the refresh token isn't a JWT

A JWT is useful when you want to verify something *without* a database
round-trip. A refresh token's entire job here is the opposite: look it up
against exactly one `DeviceSession` document to (a) confirm the device is
still registered and (b) rotate it. There's no benefit to making it
self-contained, so it's just `crypto.randomBytes(48)` — and hashed with plain
SHA-256 (not bcrypt) before storage, because bcrypt's deliberate slowness
exists to resist brute-forcing a *low-entropy* human password; a 384-bit
random token has nothing to brute-force, so a fast, constant-time-compared
hash is both sufficient and the conventional choice (the same approach OAuth
implementations use for opaque tokens).

### Device identification — not IP, not User-Agent

Per the confirmed design, "the same device" is decided by a **persistent,
client-generated `deviceId`** (e.g. `crypto.randomUUID()`, generated once and
stored in `localStorage`) — never by IP (changes constantly on mobile/roaming
networks) or User-Agent (changes on every browser/OS update) alone. Those two
are still recorded (`userAgent`, `lastIp`) but purely for **display** in the
device list — never used to decide whether a login is "a new device".

### The device-limit rule, precisely

On `POST /api/auth/login`:

1. Verify the password. Wrong password → reject before touching any device
   data at all.
2. Look up `DeviceSession` by the submitted `deviceId`.
   - **Found** (a known device): refresh its session. This does **not**
     count against the limit — logging in again on a device you already use
     never costs you a slot.
   - **Not found** (a new device): count currently registered devices.
     - `< MAX_DEVICES_PER_ACCOUNT` (2): register it, issue a session.
     - `>= MAX_DEVICES_PER_ACCOUNT`: reject with `403` and
       `details.code = 'DEVICE_LIMIT_REACHED'`, plus the current device list
       — enough for the frontend to show "you're at your device limit, remove
       one" with the list already in hand, no extra request needed.

### Logout vs. revoking a device — an intentional distinction

- **`POST /api/auth/logout`** (authenticated) clears the *current* device's
  refresh token — its next request needs the password again — but the
  `DeviceSession` document itself is **kept**. Per the confirmed design,
  logging out must never silently free up a slot; the device is still
  "yours" until you explicitly remove it.
- **`DELETE /api/auth/devices/:id`** (authenticated) actually deletes the
  `DeviceSession`, freeing its slot for a new device to register. This is the
  action described in the requirements: "الشخص الآخر يستطيع تسجيل جهازه بعد
  حذف جهاز قديم."

### What happens on a password change

`PATCH /api/auth/password` requires the *current* password (an active
session alone isn't proof of continued access to it). On success, every
**other** registered device has its refresh token cleared (forcing a
password re-entry there) — but keeps its slot — while the device that made
the request keeps its session uninterrupted, since it just proved it holds
the password. This is the standard "sign out other sessions" pattern applied
to a 2-device-slot model instead of an unlimited one.

### Bootstrapping the password

There's deliberately no public "set the initial password" HTTP endpoint —
that would be an unauthenticated way to take over the account. Instead:
`npm run seed-password -- "..."` (see `scripts/seed-shop-password.js`) writes
directly to the database. Meant for first-time setup and emergency recovery
only; routine changes go through `PATCH /api/auth/password`.

### On the future Audit Log and multi-employee accounts

Per the confirmed design, there is currently no way to know *which specific
person* used the shared account if more than one person has the password —
so `auth.service.js` doesn't try to. `logger.info('Shop login succeeded')`
records that a login happened and which device, nothing more. If per-employee
accounts are ever needed, this service is the seam where that would plug in
— `DeviceSession` and the token issuance logic barely change; only "verify
against `ShopAuth.passwordHash`" would become "verify against a specific
user's own hash", and `deviceId` scoping would gain a `userId` alongside it.
Nothing about the *device limit* or *token rotation* design would need to
change.

## `sale.service.js` (Phase 6 — Sales / POS)

`createSale` is the most business-critical function in the project so far —
see the README's "MongoDB transactions" section for the full reasoning. In
short: it runs inside a MongoDB session transaction because it has to keep
several documents across several collections consistent as a group (stock on
N products, the Sale itself, an optional CashboxTransaction, an ActivityLog
entry) — if validation for line 3 of 5 fails, lines 1–2's stock decrements
must not have happened either. Beyond the transaction, each stock decrement
is independently guarded (`quantity: { $gte: needed }` at write time, not
just checked once at read time), which closes a small oversell gap the
frontend's original single-snapshot validation had — without changing any
business rule that was actually intentional.

Validation order and Arabic error messages are copied from the frontend's
`completeSaleSvc` field-for-field: empty cart → credit-without-customer →
per-line (existence, quantity, price) → payment-amount checks. Anything that
needs a database read (does this product exist, is there enough stock) can
only live here, not in the route's zod schema — the schema only validates
shape (right types, well-formed ObjectIds) and the one cheap cross-field rule
(credit needs a customer), explained further in `sale.route.js` itself.

## `purchase.service.js` (Phase 7 — Purchases)

`createPurchase` follows the same transactional shape as `createSale` (see
above), sharing the same `withTransaction` helper from `src/utils/
transactions.js`. The one genuinely different piece of logic is the
weighted-average cost recalculation — see the README's "MongoDB
transactions" section for why it's sent as a single atomic aggregation-
pipeline update (`Product.updateOne(filter, [ ... ])`) rather than a
read-then-write: the new `quantity`/`purchasePrice` are computed from the
document's *current* state as part of the write itself, so there's no race
window to worry about, not even for an unusual purchase that lists the same
product on two lines.

Validation order/messages mirror the frontend's `addPurchaseSvc`: missing
supplier → empty items → per-line (existence, quantity, price) → payment
amount. Unlike sales, there's no upper-bound quantity check — a purchase
only rejects a non-positive quantity or an invalid price, since purchases
are how stock increases in the first place.

## `cashbox.service.js` / `expense.service.js` (Phase 8 — Cashbox & Expenses)

`getBalance()` is a running total over the entire `CashboxTransaction`
history (`sum(in) - sum(out)`), matching the frontend's `cashboxBalance`
selector — there's no cached/materialized balance field to keep in sync. It
accepts an optional `session` specifically so a balance-sufficiency check can
read a value that's guaranteed consistent with the write that immediately
follows it, inside the same transaction: reading the balance *before*
starting a transaction would let two concurrent withdrawal (or expense)
requests each see the same "sufficient" balance and both proceed, together
overdrawing the cashbox. `createCashTransaction` (withdrawals) and
`createExpense` both call `getBalance(session)` from inside their own
`withTransaction(...)` for exactly this reason.

`createExpense`/`deleteExpense` write or remove the `Expense` document and
its linked `CashboxTransaction` together in one transaction — unlike a
manual cashbox entry (which is only ever one core record), an expense and
its cashbox entry are two records that must never drift apart, or the
balance calculation silently corrupts. This mirrors how Sales/Purchases keep
stock and their transaction record consistent (see above).

## `reports.service.js` (Phase 9 — Invoices & Reports)

Every function here is read-only and exists to answer exactly one
`ReportsPage` tab — the goal is that the frontend, once wired up, requests a
handful of numbers instead of loading full `sales`/`purchases`/`expenses`
arrays into memory and reducing them client-side the way the current
frontend mock does.

The one non-obvious piece is `getPersonBalanceReport` (internal, shared by
`getCustomersReport`, `getSuppliersReport`, and `getPurchasesReport`'s
supplier-balances table): it rolls up total/paid/remaining per Customer or
Supplier from their transaction collection, and returns both a summary
(`count`, `totalOutstanding`, `withBalanceCount`) *and* a sorted top-N list
from **one aggregation** via `$facet` — computing the summary over the full
joined collection while only materializing the top N documents, rather than
fetching everyone into application memory to compute both.

`getInventoryReport`, `getCustomersReport`, and `getSuppliersReport` never
take a date range — matching the frontend exactly, where inventory value is
a snapshot of *right now* and a customer's/supplier's outstanding balance is
always all-time, regardless of whatever report period is selected elsewhere
on the page for the other tabs.

## `auditLog.service.js` (Phase 10 — Audit Log)

`recordAuditLog` is the funnel every other mutating service in the project
calls (product, customer/supplier, sale, purchase, cashbox, expense, auth) —
see the README's "Audit Log" section for the full design, including why the
acting device is normally read from `utils/requestContext.js` (an
`AsyncLocalStorage`-based context set by `requireAuth`) rather than passed
as an explicit parameter everywhere, and the one exception (`auth.service.js`'s
`login()`, which runs before that context exists and passes `actorDeviceId`
directly).

There is no `updateAuditLog`/`deleteAuditLog` — an editable audit trail
isn't one. `listAuditLogs` is the only other export, a plain paginated
read matching the shape of every other list endpoint in the project.

## `settings.service.js` (added while wiring the frontend's Settings page)

A gap, not a planned phase: the `Settings` model existed since Phase 2, but
no service/controller/route ever read or wrote it — `getSettings()` and
`updateSettings()` fill that in, following the conventions already
established elsewhere rather than inventing new ones. `getSettings()`
upserts the singleton with sensible defaults on first read; unlike
`ShopAuth`'s password (which deliberately requires an explicit CLI seed,
since auto-creating a credential would be a real security concern), there's
no such concern for shop info, so auto-creating on first access is simply
more convenient. `updateSettings()` uses the same precise before/after diff
pattern as product/customer/supplier updates (only the fields actually sent
are changed and recorded, never a full-document dump). It has no
`accessCode`/password field to update — that was already excluded from the
model itself back in Phase 2, and stays that way here; a login credential
changes through `PATCH /api/auth/password` only, in an entirely different
collection, never mixed with plain shop info returned wholesale by a
"get settings" call.
