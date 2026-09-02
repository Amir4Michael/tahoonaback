import 'dotenv/config';
import { z } from 'zod';

// Fail fast on startup with a clear message rather than surfacing a confusing
// crash later (e.g. mid-request) when a required variable turns out missing.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  CORS_ORIGINS: z.string().trim().optional().default(''),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Authentication (single shop-wide login, see src/models/ShopAuth.js)
  JWT_ACCESS_SECRET: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAX_DEVICES_PER_ACCOUNT: z.coerce.number().int().positive().default(2),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  // Product image uploads (see src/config/cloudinary.js). Optional at
  // startup — unlike Mongo/JWT, the app still runs without these, just
  // without the "upload a product image" feature; the upload endpoint
  // itself returns a clear error if a request needs them and they're
  // missing, rather than the whole server refusing to start.
  CLOUDINARY_CLOUD_NAME: z.string().trim().optional(),
  CLOUDINARY_API_KEY: z.string().trim().optional(),
  CLOUDINARY_API_SECRET: z.string().trim().optional(),
  CLOUDINARY_UPLOAD_FOLDER: z.string().trim().optional().default('system1/products'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === 'production' && !env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is required when NODE_ENV=production');
  process.exit(1);
}

if (env.NODE_ENV === 'production' && !env.JWT_ACCESS_SECRET) {
  console.error('❌ JWT_ACCESS_SECRET is required when NODE_ENV=production');
  process.exit(1);
}

export const CORS_ORIGINS = env.CORS_ORIGINS
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export default env;
