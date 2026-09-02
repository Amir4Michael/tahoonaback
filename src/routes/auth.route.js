import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import * as controller from '../controllers/auth.controller.js';

const router = Router();

// Stricter than the app-wide limiter: the whole shop shares one password, so
// brute-force protection here matters more than on general API traffic.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'محاولات دخول كثيرة، حاول مرة أخرى بعد قليل' } },
});

const deviceIdSchema = z.string().trim().min(1).max(200);

const loginSchema = z.object({
  password: z.string().min(1),
  deviceId: deviceIdSchema,
  deviceLabel: z.string().trim().max(200).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  deviceId: deviceIdSchema,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  // Kept permissive on purpose — this is a shared shop passcode (the current
  // frontend mock even uses a plain "123456"), not a per-employee account
  // password, so no complexity rules are imposed beyond a sane minimum length.
  newPassword: z.string().min(4).max(100),
});

router.post('/login', loginLimiter, validateBody(loginSchema), controller.login);
router.post('/refresh', validateBody(refreshSchema), controller.refresh);
router.post('/logout', requireAuth, controller.logout);
router.get('/devices', requireAuth, controller.listDevices);
router.delete('/devices/:id', requireAuth, controller.revokeDevice);
router.patch('/password', requireAuth, validateBody(changePasswordSchema), controller.changePassword);

export default router;
