/**
 * logger.js — the process logger. One JSON line per event on stdout, which is
 * what Azure App Service collects.
 *
 * Request-scoped code logs through `req.log` (a child carrying the request ID,
 * attached by middleware/request-log.js); everything else imports `logger`.
 * Never log a request body: bodies carry personal data.
 *
 * What a log line may hold: ids (request, user, company, record), route
 * paths without their query string, status codes, error names, messages and
 * stacks. What it may not: cookies, tokens, secrets, connection strings,
 * bodies, names, addresses, search terms. The redaction list below is the
 * safety net for the day a caller logs an object that carries one of these
 * anyway; it removes the value wherever it sits one or two levels down.
 *
 * Retention is the platform's, not this file's: see docs/SECURITY-CHECKLIST.md
 * (application logs 90 days in Log Analytics; the AuditLog table is kept).
 */

import pino from 'pino';

import { env } from '../config/env.js';

/** Keys whose values never reach a log line. */
const SECRET_KEYS = [
  'password',
  'secret',
  'clientSecret',
  'client_secret',
  'token',
  'accessToken',
  'access_token',
  'idToken',
  'id_token',
  'refreshToken',
  'refresh_token',
  'authorization',
  'cookie',
  'csrfToken',
  'connectionString',
  'DATABASE_URL',
  'SESSION_SECRET',
  'ENTRA_CLIENT_SECRET',
];

/** Exported for tests. */
export const loggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'mg-portal' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      ...SECRET_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
    ],
    remove: true,
  },
};

export const logger = pino(loggerOptions);
