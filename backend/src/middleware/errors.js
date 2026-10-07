/**
 * errors.js — the two handlers that close every request chain.
 *
 * API routes answer with JSON; anything else is a page request, so an unknown
 * path under /api is a 404 document and an unknown path elsewhere is left to
 * the static handler's own 404.
 */

import { isProduction } from '../config/env.js';

/** An error with an HTTP status attached, for routes to throw. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code  stable machine-readable token, e.g. 'not_found'
   * @param {string} [message]
   */
  constructor(status, code, message) {
    super(message ?? code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/** Unmatched /api/* paths. Mounted after all API routes. */
export function notFound(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } });
}

/**
 * Last handler in the chain. Express 5 forwards rejected async handlers here
 * automatically, so routes need no try/catch around awaits.
 */
// `_next` is unused but required: Express identifies an error handler by its
// four-parameter signature.
export function errorHandler(err, req, res, _next) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const code = err?.code ?? 'internal_error';

  if (status >= 500) console.error(err);

  // A 500 message can carry internals, so only its code is sent in production.
  const message = status >= 500 && isProduction ? 'Something went wrong.' : err?.message;

  res.status(status).json({ error: { code, message } });
}
