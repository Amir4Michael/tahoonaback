import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionMocks = vi.hoisted(() => ({ startSession: vi.fn() }));
vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, startSession: (...args) => sessionMocks.startSession(...args) } };
});

import { withTransaction } from '../../src/utils/transactions.js';

function makeFakeSession() {
  return {
    withTransaction: vi.fn(async (fn) => fn()),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
}

function transientError() {
  const err = new Error('write conflict');
  err.hasErrorLabel = (label) => label === 'TransientTransactionError';
  return err;
}

let session;
beforeEach(() => {
  vi.clearAllMocks();
  session = makeFakeSession();
  sessionMocks.startSession.mockResolvedValue(session);
});

describe('withTransaction', () => {
  it('returns the callback result on success and ends the session', async () => {
    const result = await withTransaction(async () => 'ok');
    expect(result).toBe('ok');
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('passes the session into the callback', async () => {
    await withTransaction(async (s) => {
      expect(s).toBe(session);
    });
  });

  it('propagates a non-transient (business-rule) error immediately, with no retry', async () => {
    const businessError = Object.assign(new Error('لا يوجد مخزون كافٍ'), { statusCode: 400, isOperational: true });
    let calls = 0;
    await expect(
      withTransaction(async () => {
        calls += 1;
        throw businessError;
      }),
    ).rejects.toBe(businessError);
    expect(calls).toBe(1); // never retried
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('retries a transient transaction error and succeeds on a later attempt', async () => {
    let calls = 0;
    const result = await withTransaction(async () => {
      calls += 1;
      if (calls < 3) throw transientError();
      return 'succeeded-on-retry';
    });
    expect(result).toBe('succeeded-on-retry');
    expect(calls).toBe(3);
  });

  it('gives up after maxAttempts and throws the last transient error', async () => {
    let calls = 0;
    await expect(
      withTransaction(
        async () => {
          calls += 1;
          throw transientError();
        },
        { maxAttempts: 3 },
      ),
    ).rejects.toThrow('write conflict');
    expect(calls).toBe(3);
    expect(session.endSession).toHaveBeenCalledTimes(1); // still cleaned up once, not once per attempt
  });

  it('always ends the session exactly once, even across multiple retries', async () => {
    let calls = 0;
    await withTransaction(async () => {
      calls += 1;
      if (calls < 2) throw transientError();
      return 'ok';
    });
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
