/**
 * rate-limit.js — per-IP request caps.
 *
 * Two limiters: a generous one across /api, and a strict one for the sign-in
 * routes under /api/auth and /auth. Counters are in memory, which is correct for a
 * single App Service instance; scaling out needs a shared store.
 */

import { rateLimit } from 'express-rate-limit';

import { env } from '../config/env.js';
import { HttpError } from './errors.js';

function limiter({ windowMs, limit, skip }) {
  return rateLimit({
    windowMs,
    limit,
    skip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Through the central error handler, so a 429 has the same shape as
    // every other failure.
    handler: (req, res, next) =>
      next(new HttpError(429, 'rate_limited', 'Too many requests. Try again shortly.')),
  });
}

/**
 * @param {{ windowMs?: number, limit?: number }} [options] overrides, for tests
 */
export function apiLimiter(options = {}) {
  return limiter({
    windowMs: options.windowMs ?? env.RATE_LIMIT_WINDOW_MS,
    limit: options.limit ?? env.RATE_LIMIT_MAX,
    // The App Service health probe must never be turned away.
    skip: (req) => req.path === '/health',
  });
}

/**
 * Mock sign-in is development only, and testers switch between users all day,
 * so its limit is far higher. Production never runs mock sign-in, and its limit
 * is exactly AUTH_RATE_LIMIT_MAX.
 */
export const DEV_AUTH_RATE_LIMIT_MAX = 1000;

export function authLimitFor(config = env) {
  const mockDev = config.AUTH_MODE === 'mock' && config.NODE_ENV === 'development';
  return mockDev
    ? Math.max(config.AUTH_RATE_LIMIT_MAX, DEV_AUTH_RATE_LIMIT_MAX)
    : config.AUTH_RATE_LIMIT_MAX;
}

/** The requests that start a sign-in. Nothing else counts toward the cap. */
const SIGN_IN_ATTEMPTS = new Set([
  'POST /api/auth/mock-login',
  'GET /auth/login',
  'GET /auth/callback',
]);

/**
 * Only sign-in attempts are counted: signing out, drawing the login page and
 * reading the config never are, so nobody is locked out of ending a session.
 *
 * @param {{ windowMs?: number, limit?: number }} [options] overrides, for tests
 * @param {object} [config] the environment, or a test's version of it
 */
export function authLimiter(options = {}, config = env) {
  return limiter({
    windowMs: options.windowMs ?? config.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: options.limit ?? authLimitFor(config),
    skip: (req) => !SIGN_IN_ATTEMPTS.has(`${req.method} ${req.originalUrl.split('?')[0]}`),
  });
}
