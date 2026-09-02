# Deployment Guide — System 1 Backend (Vercel + MongoDB Atlas)

This is the concrete, step-by-step version of what `README.md`'s "Roadmap"
item 13 describes. Nothing in this sandbox can actually reach MongoDB
Atlas or a live Vercel deployment (no network access to either from here),
so this phase is documentation + a verification script, not something
already run — follow it in your own environment.

## 1. MongoDB Atlas

1. Create a **separate** Atlas project/cluster for System 1 — per the
   confirmed design, each of the four shop systems gets its own fully
   independent database, never a shared one.
2. Free tier (M0) is fine to start; it already runs as a replica set,
   which is what makes the transactional Sales/Purchases/Cashbox/Expenses
   logic work (see `README.md`'s "MongoDB transactions" section).
3. Create a database user with a strong, generated password (not reused
   from anywhere else). Note the connection string — this becomes
   `MONGODB_URI`.
4. Network access: add `0.0.0.0/0` (allow from anywhere) since Vercel's
   serverless functions don't have fixed outbound IPs on the default plan
   — or use Atlas's Vercel integration if you set one up, which manages
   this automatically.

## 2. Cloudinary (product image uploads)

Optional — the app runs fully without this, just without the "upload a
product image" feature.

1. Create a free account at [cloudinary.com](https://cloudinary.com) — one
   **separate** account per system, same isolation rule as Atlas.
2. Dashboard → Settings → API Keys gives you the three values:
   `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
3. Nothing else to configure on Cloudinary's side — no upload preset needed,
   since this project uses **signed** uploads (the backend mints a
   short-lived token per request; see the backend `README.md`'s "Product
   images" section for why that's safer than an unsigned preset).

## 3. Environment variables (Vercel project settings, not `.env`)

Set these as **Environment Variables** in the Vercel project for this
backend (Project Settings → Environment Variables), for the Production
environment at minimum:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | the Atlas connection string from step 1 |
| `JWT_ACCESS_SECRET` | a long random string — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CORS_ORIGINS` | the real deployed frontend's origin, e.g. `https://system1-shop.vercel.app` (comma-separate if you also want to allow a staging URL) |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` (or leave unset — that's the default) |
| `REFRESH_TOKEN_TTL_DAYS` | `30` (or leave unset) |
| `MAX_DEVICES_PER_ACCOUNT` | `2` (or leave unset) |
| `BCRYPT_SALT_ROUNDS` | `12` (or leave unset) |
| `LOG_LEVEL` | `info` (or leave unset) |
| `CLOUDINARY_CLOUD_NAME` | from Cloudinary dashboard → Settings → API Keys |
| `CLOUDINARY_API_KEY` | same page |
| `CLOUDINARY_API_SECRET` | same page — keep this one as secret as `JWT_ACCESS_SECRET` |
| `CLOUDINARY_UPLOAD_FOLDER` | `system1/products` (or leave unset — that's the default) |

Never commit any of these to source control — `.env.example` documents the
shape, `.env` itself is gitignored.

## 4. Deploy the backend

1. Push this `backend/` directory as its own Vercel project (import the
   repo, set the project root to `backend/` if it's in a monorepo).
2. Vercel auto-detects `api/index.js` as a serverless function and
   `vercel.json`'s rewrite routes every `/api/*` request to it — no build
   step configuration needed beyond the defaults for a Node project.
3. Deploy. Confirm `GET https://<your-backend>.vercel.app/api/health`
   returns `{"success":true,"status":"ok",...}` — this doesn't touch the
   database, so it should work even before anything else is configured.
4. Confirm `GET https://<your-backend>.vercel.app/api/health/db` reports
   `"db":"connected"` — this is the first real check that `MONGODB_URI` is
   correct and Atlas network access is configured properly.

## 5. One-time database setup (run locally, pointed at the real Atlas cluster)

From your own machine (not from Vercel — these are one-off scripts, not
part of the deployed app):

```bash
cd backend
cp .env.example .env
# edit .env: set MONGODB_URI to the real Atlas connection string

npm install
npm run sync-indexes      # creates every model's declared indexes on Atlas
npm run seed-password -- "choose-a-real-shop-password-here"
```

`sync-indexes` is safe to re-run any time indexes change in the future.
`seed-password` is for first-time setup only — after this, change the
password through the app itself (Settings → تغيير كلمة المرور), which
correctly signs out other devices; re-running the seed script is only for
emergency recovery (forgotten password, every device lost).

**Delete your local `.env` afterward** (or at least make sure it never gets
committed) — it now contains a real production connection string.

## 6. Frontend deployment

1. Deploy `ffffff/` (the frontend) as its own, separate Vercel project.
2. Set `VITE_API_BASE_URL` as an environment variable on that project,
   pointing at the backend's deployed URL + `/api`, e.g.
   `https://system1-backend.vercel.app/api`.
3. Redeploy after setting it (Vite bakes env vars in at build time, so a
   variable added after the first deploy needs a fresh build to take
   effect).
4. Confirm `CORS_ORIGINS` on the **backend** project includes this
   frontend's actual deployed origin exactly (protocol + host, no trailing
   slash) — a mismatch here is the most common first-deployment failure,
   and shows up as the browser silently blocking every API call with a
   CORS error in the console, not a clear error message from the app
   itself.

## 7. Post-deploy verification

Run the smoke-test script (`scripts/smoke-test.js`, in this same
directory) against the live deployment:

```bash
npm run smoke-test -- https://<your-backend>.vercel.app/api "your-shop-password"
# or directly: node scripts/smoke-test.js https://<your-backend>.vercel.app/api "your-shop-password"
```

It exercises the exact chain a real first login does: health check → DB
connectivity → login → an authenticated read → refresh → logout. See that
script's own comments for exactly what it checks and why.

Then, in the browser, against the real deployed frontend: log in, add a
product, complete a sale, and check it appears in Sales History and moved
the Cashbox balance — the shortest real path that touches the database,
authentication, and the transactional Sales flow all at once.

## 8. Repeating this for Systems 2–4

Per the confirmed design, Systems 2–4 are the same backend architecture
with independent Atlas clusters, independent Cloudinary accounts, and
their own branding — not a shared deployment. Repeat sections 1–6 for each,
with its own `MONGODB_URI`, `JWT_ACCESS_SECRET` (never reuse secrets across
systems), and `CORS_ORIGINS`.
