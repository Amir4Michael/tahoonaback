/**
 * Post-deployment smoke test. Run this against a REAL deployed backend
 * (never against a local/dev instance meant to stay empty) to confirm the
 * full chain a real first login goes through actually works end-to-end:
 * liveness -> DB connectivity -> login -> an authenticated read -> token
 * refresh -> logout. Uses only native `fetch` (Node 18+) — no dependencies,
 * so it can run standalone without `npm install`.
 *
 * Usage:
 *   node scripts/smoke-test.js https://your-backend.vercel.app/api "your-shop-password"
 *
 * Exits non-zero on any failure, with a clear message about which step
 * failed — safe to wire into a CI check after a deploy if you want one.
 */

/* eslint-disable no-console -- this CLI script's entire job is printing
   progress/results to whoever runs it; unlike runtime app code it
   deliberately doesn't use the structured pino logger (see below) since it
   has no dependency on this project's own environment configuration at
   all — it's a pure HTTP client against a URL passed on the command line. */

import crypto from 'node:crypto';

const BASE_URL = process.argv[2];
const PASSWORD = process.argv[3];

if (!BASE_URL || !PASSWORD) {
  console.error('Usage: node scripts/smoke-test.js <base-url> "<shop-password>"');
  console.error('Example: node scripts/smoke-test.js https://system1-backend.vercel.app/api "my-password"');
  process.exit(1);
}

const deviceId = `smoke-test-${crypto.randomUUID()}`;
let passed = 0;
let failed = 0;

async function step(name, fn, { critical = false } = {}) {
  process.stdout.write(`- ${name} ... `);
  try {
    await fn();
    console.log('OK');
    passed += 1;
    return true;
  } catch (err) {
    console.log('FAILED');
    console.log(`  ${err.message}`);
    failed += 1;
    if (critical) {
      console.log('\nStopping here — the remaining checks would only fail the same way.');
      console.log(`\n${passed} passed, ${failed} failed.`);
      process.exit(1);
    }
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  console.log(`Smoke-testing ${BASE_URL}\n`);

  let accessToken;
  let refreshToken;

  await step('GET /health responds without touching the database', async () => {
    const { status, json } = await request('/health');
    assert(status === 200, `expected 200, got ${status}`);
    assert(json?.success === true && json?.status === 'ok', 'unexpected body shape');
  });

  await step('GET /health/db reports a connected database', async () => {
    const { status, json } = await request('/health/db');
    assert(status === 200, `expected 200, got ${status}`);
    assert(
      json?.db === 'connected',
      `db is "${json?.db}" — check MONGODB_URI and Atlas network access (see DEPLOYMENT.md section 4)`,
    );
  }, { critical: true });

  await step('POST /auth/login succeeds with the given password', async () => {
    const { status, json } = await request('/auth/login', {
      method: 'POST',
      body: { password: PASSWORD, deviceId, deviceLabel: 'smoke-test' },
    });
    if (status === 403 && json?.error?.details?.code === 'DEVICE_LIMIT_REACHED') {
      throw new Error(
        'Login rejected: device limit reached (2/2 already registered). '
        + 'Revoke a device in Settings first, or accept this is expected if '
        + 'you already have 2 devices actively using this account.',
      );
    }
    assert(status === 200, `expected 200, got ${status}: ${json?.error?.message || ''}`);
    assert(json?.data?.accessToken && json?.data?.refreshToken, 'missing tokens in response');
    accessToken = json.data.accessToken;
    refreshToken = json.data.refreshToken;
  }, { critical: true });

  await step('An authenticated request succeeds with the issued access token', async () => {
    const { status, json } = await request('/products?limit=1', { token: accessToken });
    assert(status === 200, `expected 200, got ${status}`);
    assert(json?.success === true, 'unexpected body shape');
  });

  await step('An authenticated request WITHOUT a token is rejected', async () => {
    const { status } = await request('/products?limit=1');
    assert(status === 401, `expected 401, got ${status}`);
  });

  await step('POST /auth/refresh issues a new access token', async () => {
    const { status, json } = await request('/auth/refresh', {
      method: 'POST',
      body: { refreshToken, deviceId },
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(json?.data?.accessToken, 'missing new access token');
    accessToken = json.data.accessToken;
  });

  await step('POST /auth/logout succeeds, cleaning up this test device session', async () => {
    const { status } = await request('/auth/logout', { method: 'POST', token: accessToken });
    assert(status === 200, `expected 200, got ${status}`);
  });

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke test crashed unexpectedly:', err);
  process.exit(1);
});
