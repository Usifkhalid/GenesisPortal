/**
 * csrf.js — CSRF protection for the cookie session (synchroniser token).
 *
 * The session holds a random token. The frontend reads it from
 * GET /api/auth/config or GET /api/me and sends it back in X-CSRF-Token on
 * every request that changes state. Another site can make the browser send the
 * cookie, but it can neither read the token nor set a custom header without a
 * CORS preflight, which this server never answers.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { HttpError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The session's token, made on first use. Putting it there starts the session. */
export function csrfToken(req) {
  req.session.csrfToken ??= randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

function sameToken(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Refuses any state-changing request that does not carry the session's token. */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session?.csrfToken;
  const sent = req.get('x-csrf-token');
  if (!expected || !sent || !sameToken(sent, expected)) {
    throw new HttpError(403, 'csrf_invalid', 'Missing or invalid CSRF token.');
  }
  next();
}
