import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

import mongoose from 'mongoose';
import env from './env.js';
import { logger } from './logger.js';

// On Vercel, module-level scope is reused across "warm" invocations of the
// same function instance, but a fresh module registry can also occur between
// deploys/instances. Caching the connection (and in-flight connection promise)
// on `global` — rather than in module-local variables — makes reuse survive
// module reloads within the same process, which is what actually matters for
// avoiding "too many connections" on MongoDB Atlas under serverless.
const cached = global.__mongooseConn || (global.__mongooseConn = { conn: null, promise: null });

/**
 * Connect to MongoDB, reusing an existing (or in-flight) connection instead of
 * opening a new one per call. Safe to call on every request.
 */
export async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured — set it in your environment to connect to MongoDB.');
  }

  if (!cached.promise) {
    mongoose.set('strictQuery', true);
    cached.promise = mongoose
      .connect(env.MONGODB_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 8000,
        // Auto-creating/checking indexes on every connection is fine in dev,
        // but wasted work on every serverless cold start in production —
        // indexes are synced explicitly instead (see src/models/README.md).
        autoIndex: env.NODE_ENV !== 'production',
      })
      .then((mongooseInstance) => {
        logger.info('MongoDB connected');
        return mongooseInstance;
      })
      .catch((err) => {
        // Allow the next call to retry instead of caching a permanent failure.
        cached.promise = null;
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

/** Used by tests and graceful shutdown — not expected to run on Vercel. */
export async function disconnectDB() {
  if (cached.conn) {
    await mongoose.disconnect();
    cached.conn = null;
    cached.promise = null;
  }
}
