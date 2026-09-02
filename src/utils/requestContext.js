import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Runs `fn` with `context` available to anything it calls — however deep,
 * across `await`s — via `getRequestContext()`. Used to make the acting
 * device's id available to audit logging without threading it as an extra
 * parameter through every controller → service call in the codebase; only
 * the one place that actually knows it (`requireAuth`) needs to set it up.
 */
export function runWithContext(context, fn) {
  return storage.run(context, fn);
}

/**
 * Returns the context set by the nearest enclosing `runWithContext()` call
 * in the current async chain, or `undefined` outside one (a script, a test
 * that didn't set one up, the unauthenticated login/refresh routes) — always
 * safe to call, never throws.
 */
export function getRequestContext() {
  return storage.getStore();
}

export default { runWithContext, getRequestContext };
