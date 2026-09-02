import { describe, it, expect } from 'vitest';
import { runWithContext, getRequestContext } from '../../src/utils/requestContext.js';

describe('runWithContext / getRequestContext', () => {
  it('returns undefined outside any context', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('makes the context available synchronously inside the callback', () => {
    runWithContext({ deviceId: 'd1' }, () => {
      expect(getRequestContext()).toEqual({ deviceId: 'd1' });
    });
  });

  it('propagates the context across await boundaries inside the callback', async () => {
    await runWithContext({ deviceId: 'd1' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getRequestContext()).toEqual({ deviceId: 'd1' });
    });
  });

  it('propagates into functions called (however deeply) from inside the callback, with no explicit passing', async () => {
    async function deeplyNested() {
      await Promise.resolve();
      return getRequestContext();
    }
    async function middleLayer() {
      return deeplyNested();
    }

    const result = await runWithContext({ deviceId: 'd-deep' }, () => middleLayer());
    expect(result).toEqual({ deviceId: 'd-deep' });
  });

  it('isolates concurrent contexts from each other', async () => {
    const [a, b] = await Promise.all([
      runWithContext({ deviceId: 'A' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getRequestContext();
      }),
      runWithContext({ deviceId: 'B' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return getRequestContext();
      }),
    ]);
    expect(a).toEqual({ deviceId: 'A' });
    expect(b).toEqual({ deviceId: 'B' });
  });

  it('does not leak the context after the callback returns', async () => {
    await runWithContext({ deviceId: 'd1' }, () => Promise.resolve());
    expect(getRequestContext()).toBeUndefined();
  });

  it('returns the callback\'s return value', () => {
    const result = runWithContext({ deviceId: 'd1' }, () => 42);
    expect(result).toBe(42);
  });
});
