import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unit-test the connection-caching pattern in isolation from a real MongoDB
// server: what matters for serverless correctness is that mongoose.connect()
// is called exactly once across repeated connectDB() calls (proving reuse),
// not that a live database is reachable from this test environment.
vi.mock('mongoose', () => {
  const connection = { readyState: 0 };
  const connect = vi.fn(async () => {
    connection.readyState = 1;
    return { connection };
  });
  const disconnect = vi.fn(async () => {
    connection.readyState = 0;
  });
  return { default: { connect, disconnect, connection, set: vi.fn() } };
});

describe('connectDB caching', () => {
  const ORIGINAL_URI = process.env.MONGODB_URI;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete global.__mongooseConn;
    process.env.MONGODB_URI = 'mongodb://fake-uri-for-unit-test/db';
  });

  afterEach(() => {
    process.env.MONGODB_URI = ORIGINAL_URI;
  });

  it('opens a single underlying connection and reuses it across repeated calls', async () => {
    const mongoose = (await import('mongoose')).default;
    const { connectDB } = await import('../src/config/db.js');

    const first = await connectDB();
    const second = await connectDB();
    const third = await connectDB();

    expect(mongoose.connect).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('de-duplicates concurrent connectDB() calls into a single connect attempt', async () => {
    const mongoose = (await import('mongoose')).default;
    const { connectDB } = await import('../src/config/db.js');

    // Simulate several requests arriving before the first connection resolves.
    const [a, b, c] = await Promise.all([connectDB(), connectDB(), connectDB()]);

    expect(mongoose.connect).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('clears the cache on disconnectDB so a later call reconnects', async () => {
    const mongoose = (await import('mongoose')).default;
    const { connectDB, disconnectDB } = await import('../src/config/db.js');

    await connectDB();
    await disconnectDB();
    await connectDB();

    expect(mongoose.connect).toHaveBeenCalledTimes(2);
    expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('connectDB without MONGODB_URI configured', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete global.__mongooseConn;
    delete process.env.MONGODB_URI;
  });

  it('throws a clear, actionable error instead of calling mongoose', async () => {
    const mongoose = (await import('mongoose')).default;
    const { connectDB } = await import('../src/config/db.js');

    await expect(connectDB()).rejects.toThrow(/MONGODB_URI/);
    expect(mongoose.connect).not.toHaveBeenCalled();
  });
});
