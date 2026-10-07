/**
 * errors.js — the handlers that close every request chain.
 *
 * API routes answer with JSON. What a client may read from a failure is decided
 * here and nowhere else: an HttpError's own code and message, a validation
 * summary, or a fixed sentence. Anything unexpected is logged in full against
 * the request ID and answered with that ID and nothing more.
 */

import { ZodError } from 'zod';

import { isProduction } from '../config/env.js';
import { logger } from '../lib/logger.js';

/** An error with an HTTP status attached, for routes to throw. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code  stable machine-readable token, e.g. 'not_found'
   * @param {string} [message]  safe to show a caller: no internals
   * @param {unknown} [details]  safe, structured extras, e.g. field issues
   */
  constructor(status, code, message, details) {
    super(message ?? code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const DEFAULTS = {
  400: ['bad_request', 'The request could not be read.'],
  401: ['unauthenticated', 'Sign in to continue.'],
  403: ['forbidden', 'You do not have access to this.'],
  404: ['not_found', 'Not found.'],
  409: ['conflict', 'This conflicts with an existing record.'],
  413: ['payload_too_large', 'The request is too large.'],
  429: ['rate_limited', 'Too many requests. Try again shortly.'],
  500: ['internal_error', 'Something went wrong.'],
};

// Prisma's known request errors that are the caller's doing, not ours.
const PRISMA_STATUS = { P2025: 404, P2002: 409, P2003: 409 };

/**
 * Reduces any thrown value to what may leave the server.
 * @returns {{ status: number, code: string, message: string, details?: unknown }}
 */
export function toResponse(err) {
  if (err instanceof HttpError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'validation_failed',
      message: 'Some fields are not valid.',
      // The path and zod's message only: never the rejected value.
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }

  let status = 500;
  if (err?.name === 'PrismaClientKnownRequestError' && PRISMA_STATUS[err.code]) {
    status = PRISMA_STATUS[err.code];
  } else if (err?.expose === true && err.status >= 400 && err.status < 500) {
    // body-parser and friends: a malformed or oversized body.
    status = err.status;
  }

  const [code, message] = DEFAULTS[status] ?? DEFAULTS[status >= 500 ? 500 : 400];
  return { status, code, message };
}

/** Unmatched /api/* paths. Mounted after all API routes, before the frontend. */
export function apiNotFound(req, res, next) {
  if (!req.path.startsWith('/api/') && req.path !== '/api') return next();
  next(new HttpError(404, 'not_found', 'No such endpoint.'));
}

/** Anything the static frontend did not serve. Mounted after it. */
export function pageNotFound(req, res) {
  res.status(404).type('text/plain').send('404');
}

/**
 * Last handler in the chain. Express 5 forwards rejected async handlers here
 * automatically, so routes need no try/catch around awaits.
 */
// `_next` is unused but required: Express identifies an error handler by its
// four-parameter signature.
export function errorHandler(err, req, res, _next) {
  const { status, code, message, details } = toResponse(err);
  const log = req.log ?? logger;

  if (status >= 500) log.error({ err }, 'request failed');
  else log.debug({ code, status }, 'request rejected');

  // Headers already on the wire: nothing coherent can be added.
  if (res.headersSent) return res.destroy();

  const error = { code, message, requestId: req.id };
  if (details !== undefined) error.details = details;
  // The real cause, for the developer at the keyboard only.
  if (status >= 500 && !isProduction && err?.message) error.debug = err.message;

  res.status(status).json({ error });
}
