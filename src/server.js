import env from './config/env.js';
import { logger } from './config/logger.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';

async function start() {
  if (env.MONGODB_URI) {
    try {
      await connectDB();
    } catch (err) {
      logger.error({ err }, 'Failed to connect to MongoDB on startup');
      // Don't crash the whole process on a DB hiccup at boot — /api/health
      // stays up, and any route that actually needs the DB will fail with a
      // clear per-request error instead of the whole server refusing to start.
    }
  } else {
    logger.warn('MONGODB_URI not set — starting without a database connection.');
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
