/**
 * rate-limit.js — per-IP request caps.
 *
 * Two limiters: a generous one across /api, and a strict one for the sign-in
 * routes under /api/auth. Counters are in memory, which is correct for a
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
 * @param {{ windowMs?: number, limit?: number }} [options] overrides, for tests
 */
export function authLimiter(options = {}) {
  return limiter({
    windowMs: options.windowMs ?? env.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: options.limit ?? env.AUTH_RATE_LIMIT_MAX,
  });
}
