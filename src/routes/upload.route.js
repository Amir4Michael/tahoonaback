import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as controller from '../controllers/upload.controller.js';

const router = Router();

router.use(requireAuth);

// No POST/upload route here on purpose — the actual image bytes go
// directly from the browser to Cloudinary's own API, never through this
// backend. This endpoint only ever hands out a short-lived signature.
router.get('/signature', controller.getSignature);

export default router;
