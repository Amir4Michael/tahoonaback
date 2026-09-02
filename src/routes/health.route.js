import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

// Liveness probe — intentionally never touches the database, so it stays
// fast and reliable (used by uptime checks / Vercel) even during a DB outage.
router.get('/', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe — reports current DB connection state without throwing,
// useful while wiring up MONGODB_URI to confirm it actually works.
router.get('/db', (req, res) => {
  res.json({
    success: true,
    db: READY_STATES[mongoose.connection.readyState] || 'unknown',
  });
});

export default router;
