import pino from 'pino';
import env from './env.js';

// Never let secrets or credentials leak into logs, even by accident (e.g. a
// route that echoes req.body for debugging). Redaction happens at the pino
// level so it applies uniformly wherever a log call touches these shapes.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.accessCode',
  'req.body.loginPassword',
  'req.body.token',
  'req.body.refreshToken',
  '*.password',
  '*.accessCode',
  '*.token',
  '*.refreshToken',
  '*.secret',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' } } }
    : {}),
});

export default logger;
