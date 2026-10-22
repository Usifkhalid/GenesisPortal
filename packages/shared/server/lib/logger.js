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

import { appEnvOrNull, runtime } from '../config/runtime.js';

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

/** Exported for tests. The level and the service name are the running app's. */
export const loggerOptions = {
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

/** Before any app has configured itself (a bare unit test): quiet under test. */
const fallbackLevel = () =>
  process.env.LOG_LEVEL ?? (process.env.NODE_TEST_CONTEXT ? 'silent' : 'info');

let instance;

/**
 * Made on first use, not at import: the shared code is imported before the
 * app's env.js has said which app this is and at what level it logs.
 */
function real() {
  if (!instance) {
    const env = appEnvOrNull();
    instance = pino({
      ...loggerOptions,
      level: env?.LOG_LEVEL ?? fallbackLevel(),
      base: { service: env ? `mg-${runtime().appName}` : 'mg' },
    });
  }
  return instance;
}

/** The process logger: pino's own object, made when first asked for. */
export const logger = new Proxy(
  {},
  {
    get(_target, key) {
      const target = real();
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(_target, key, value) {
      return Reflect.set(real(), key, value);
    },
    has: (_target, key) => key in real(),
  }
);
