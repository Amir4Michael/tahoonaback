# End-to-End Verification Checklist

Everything in this project is thoroughly unit/integration-tested with
mocked models (444 backend tests) and build-verified on the frontend, but
none of that touches a **real** MongoDB replica set or a **real** deployed
pair of frontend+backend — this sandbox has no network access to Atlas or
Vercel. Run through this checklist once, against a real deployment (see
`DEPLOYMENT.md`), before relying on this system for actual shop data.

Each item names the specific business rule it's checking and where it's
implemented, so a failure points you straight at the relevant code.

## Setup
- [ ] `npm run smoke-test -- <backend-url> "<password>"` passes end-to-end
      (health → DB → login → authenticated read → refresh → logout)
- [ ] Log into the real deployed frontend with the seeded password
- [ ] Confirm the Settings page shows default shop info (auto-created on
      first read — `settings.service.js`)

## Device limit (backend Phase 3 / frontend 11a, 11i)
- [ ] Log in from a second browser/device — succeeds (2/2 devices)
- [ ] Attempt to log in from a *third* device — rejected with a clear
      "device limit reached" message, and the response lists the 2
      existing devices
- [ ] In Settings → الأجهزة المسجلة, revoke one device
- [ ] The third device can now log in successfully

## Products & weighted-average cost (backend Phase 4/7 / frontend 11b, 11e)
- [ ] Add a new product with quantity 6, purchase price 10
- [ ] Record a purchase of the same product: quantity 6, price 15
- [ ] Product's purchase price is now exactly **12.5** — `(6×10 + 6×15) / 12`
- [ ] Edit the product's name only — purchase price/quantity are untouched
      (true partial update, not a full-document overwrite)
- [ ] Upload a product image (requires `CLOUDINARY_*` set — see
      `DEPLOYMENT.md` section 2) — confirm it appears immediately in the
      product form/grid, and check in Cloudinary's own dashboard that the
      file landed in the configured folder (`CLOUDINARY_UPLOAD_FOLDER`)
- [ ] With Cloudinary env vars intentionally unset, confirm the rest of
      the app still works normally and the image picker fails with a
      clear message instead of crashing the page

## Sales / POS (backend Phase 6 / frontend 11d)
- [ ] Add a product to the cart, override its price for this sale only —
      complete the sale, then check the product's catalog price in
      Inventory is **unchanged** (custom price applies to the sale line
      only, never writes back to the product)
- [ ] Sell a quantity greater than what's in stock — rejected
- [ ] Complete a cash sale — Cashbox balance increases by the sale total
      immediately
- [ ] Complete a credit (آجل) sale with partial payment — the customer's
      "المتبقي" in Customers reflects the unpaid remainder

## Purchases (backend Phase 7 / frontend 11e)
- [ ] Record a purchase with a *new* product created inline via "منتج
      جديد" mid-purchase — the new product appears correctly in both the
      purchase and in Inventory afterward
- [ ] Complete a credit purchase — the supplier's outstanding balance in
      Suppliers reflects it

## Cashbox & Expenses (backend Phase 8 / frontend 11f)
- [ ] Manually add funds to the cashbox — balance updates
- [ ] Attempt to withdraw more than the current balance — rejected
- [ ] Record an expense — cashbox balance decreases by that amount
- [ ] Delete that expense — cashbox balance is restored (the linked
      cashbox entry is removed too, not just the expense)

## Reports (backend Phase 9 / frontend 11g)
- [ ] Reports → المبيعات for "اليوم" matches the sales made above
- [ ] Reports → المخزون shows current stock value — unaffected by
      whatever date range is selected (always a snapshot of now)
- [ ] Reports → العملاء / الموردين totals match what's shown on their
      respective list pages — unaffected by date range (always all-time)

## Audit trail & Activity feed (backend Phase 10 / added during 11h)
- [ ] Every action above (sale, purchase, expense, product edit, password
      change, device revoke) appears in Dashboard → آخر النشاطات
- [ ] `GET /api/audit-log` (no frontend UI for this — it's the structured,
      security-focused trail, not the user-facing feed) shows the same
      actions with the acting device id and a before/after diff for edits

## Settings & the mock-data cutover (frontend 11i)
- [ ] Change the shop name in Settings — it updates immediately in the
      sidebar header **without a page reload** (shared `SettingsContext`)
- [ ] Change the shop password (requires the current password) — confirm
      the *other* logged-in device gets signed out (per the backend's
      Phase 3 design: a password change signs out every other device)

## What this checklist does NOT cover
Load testing, concurrent-write race conditions under real traffic (the
backend's transactional guarantees are unit-tested with mocked sessions,
not load-tested against real MongoDB contention), and mobile-device manual
QA. Worth doing before high-volume production use, out of scope for this
pass.
