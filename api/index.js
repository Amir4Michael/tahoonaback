import { createApp } from '../src/app.js';
import { connectDB } from '../src/config/db.js';
import { logger } from '../src/config/logger.js';

const app = createApp();

/**
 * Vercel invokes this handler per request. `connectDB()` reuses a cached
 * connection across warm invocations of the same instance instead of opening
 * a new one every time — critical for not exhausting MongoDB Atlas's
 * connection limit under serverless.
 */
export default async function handler(req, res) {
  try {
    if (process.env.MONGODB_URI) {
      await connectDB();
    }
  } catch (err) {
    logger.error({ err }, 'MongoDB connection failed for this invocation');
    // Continue anyway — /api/health stays usable, and DB-dependent routes
    // will surface a clear error instead of the whole function crashing.
  }
  return app(req, res);
}
