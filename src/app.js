import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import env, { CORS_ORIGINS } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';

/**
 * Builds a fresh Express app instance. Kept as a factory (rather than a
 * module-level singleton) so tests can create isolated instances, and so the
 * Vercel serverless entrypoint and the local dev server share the exact same
 * app wiring.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Required behind Vercel's proxy / any reverse proxy so req.ip and
  // rate-limiting see the real client IP instead of the proxy's.
  app.set('trust proxy', 1);

  app.use(helmet());

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header (server-to-server calls, curl, health checks) is
        // allowed through; browser requests are checked against the allowlist.
        if (!origin || CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(
    pinoHttp({
      logger,
      autoLogging: env.NODE_ENV !== 'test',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    }),
  );

  // Conservative baseline limiter for all API traffic. Sensitive routes
  // (login, etc.) will get their own stricter limiter once they exist.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
