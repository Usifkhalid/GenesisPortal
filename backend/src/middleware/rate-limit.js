/**
 * rate-limit.js — request caps.
 *
 * Three of them:
 *   apiLimiter      per client address across /api (generous)
 *   authLimiter     per client address on sign-in attempts: a high ceiling,
 *                   because all of HQ reaches the portal from one public
 *                   address and a low cap would lock out the whole office
 *   accountLimiter  per account on sign-in attempts: the low cap, which is
 *                   what actually stops someone hammering one identity
 *
 * The client address is lib/client-ip.js (Azure's proxy trusted for exactly
 * one hop, port removed). Counters are in memory, per process: with two App
 * Service instances each counts its own share, so the effective caps are at
 * most twice the configured ones. A shared store is only needed if that
 * margin ever matters.
 */

import { rateLimit } from 'express-rate-limit';

import { env } from '../config/env.js';
import { clientKey } from '../lib/client-ip.js';
import { HttpError } from './errors.js';

const tooMany = () =>
  new HttpError(429, 'rate_limited', 'Too many requests. Try again shortly.');

function limiter({ windowMs, limit, skip }) {
  return rateLimit({
    windowMs,
    limit,
    skip,
    keyGenerator: clientKey,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // The key is built by lib/client-ip.js, which has already dealt with what
    // these start-up checks look for (proxy headers, ports, IPv6 ranges).
    validate: { xForwardedForHeader: false, trustProxy: false, ip: false },
    // Through the central error handler, so a 429 has the same shape as
    // every other failure.
    handler: (req, res, next) => next(tooMany()),
  });
}

/** Never turned away: App Service probes these to decide whether to route here. */
const PROBES = new Set(['/health', '/ready']);

/**
 * @param {{ windowMs?: number, limit?: number }} [options] overrides, for tests
 */
export function apiLimiter(options = {}) {
  return limiter({
    windowMs: options.windowMs ?? env.RATE_LIMIT_WINDOW_MS,
    limit: options.limit ?? env.RATE_LIMIT_MAX,
    skip: (req) => PROBES.has(req.path),
  });
}

/**
 * Mock sign-in is development only, and testers switch between users all day,
 * so its limits are far higher. Production never runs mock sign-in, and its
 * limits are exactly the configured ones.
 */
export const DEV_AUTH_RATE_LIMIT_MAX = 1000;

const isMockDev = (config) => config.AUTH_MODE === 'mock' && config.NODE_ENV === 'development';

/** The per-address ceiling on sign-in attempts. */
export function authLimitFor(config = env) {
  return isMockDev(config)
    ? Math.max(config.AUTH_RATE_LIMIT_MAX, DEV_AUTH_RATE_LIMIT_MAX)
    : config.AUTH_RATE_LIMIT_MAX;
}

/** The per-account cap on sign-in attempts. */
export function accountLimitFor(config = env) {
  return isMockDev(config)
    ? Math.max(config.AUTH_ACCOUNT_RATE_LIMIT_MAX, DEV_AUTH_RATE_LIMIT_MAX)
    : config.AUTH_ACCOUNT_RATE_LIMIT_MAX;
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

/** Above this many live keys the expired ones are swept before a new one is added. */
const SWEEP_AT = 10_000;

/**
 * Counts sign-in attempts per account, whatever address they come from. The
 * sign-in routes call `hit` once they know which account is being signed in
 * (the mock user id; the Entra object id or address after the code exchange),
 * successful attempts included: ten sign-ins in a quarter of an hour is far
 * more than a person makes.
 *
 * @param {{ windowMs?: number, limit?: number, accountLimit?: number }} [options]
 *   overrides, for tests
 * @param {object} [config]
 * @param {() => number} [clock]
 */
export function accountLimiter(options = {}, config = env, clock = Date.now) {
  const windowMs = options.windowMs ?? config.AUTH_RATE_LIMIT_WINDOW_MS;
  const limit = options.accountLimit ?? accountLimitFor(config);
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  return {
    limit,
    /** Counts one attempt on `account`; throws a 429 once the cap is passed. */
    hit(account) {
      const key = String(account ?? '').toLowerCase();
      if (!key) return;
      const at = clock();

      let entry = hits.get(key);
      if (!entry || entry.resetAt <= at) {
        if (hits.size >= SWEEP_AT) {
          for (const [k, v] of hits) if (v.resetAt <= at) hits.delete(k);
        }
        entry = { count: 0, resetAt: at + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > limit) throw tooMany();
    },
  };
}
