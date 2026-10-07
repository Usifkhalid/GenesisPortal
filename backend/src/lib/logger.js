/**
 * logger.js — the process logger. One JSON line per event on stdout, which is
 * what Azure App Service collects.
 *
 * Request-scoped code logs through `req.log` (a child carrying the request ID,
 * attached by middleware/request-log.js); everything else imports `logger`.
 * Never log a request body: bodies carry personal data.
 */

import pino from 'pino';

import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'mg-portal' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
    ],
    remove: true,
  },
});
