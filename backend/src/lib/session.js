/**
 * session.js — the server-side session (express-session) and its SQL Server
 * store.
 *
 * The browser holds one signed, httpOnly cookie carrying a session id and
 * nothing else: no token, no user data. The session itself is a row in the
 * Session table. Two clocks end it (both configurable, config/env.js):
 *
 *   idle      eight hours without a request; every request pushes the end of
 *             that window forward, in the row and in the cookie
 *   absolute  twelve hours after sign-in, however active the person is
 *
 * The absolute clock starts at sign-in (`startedAt`, written by
 * modules/auth/service.js) and is enforced here on every request, on the
 * server: the cookie's own expiry is only a courtesy to the browser.
 */

import { randomBytes } from 'node:crypto';
import session from 'express-session';

import { getPrisma } from './prisma.js';

/** Idle timeout when nothing is configured: a session unused for this long is gone. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Absolute lifetime when nothing is configured. */
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

/** Prisma's code for a unique constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * express-session store over the Session table.
 * `getDb` is injectable so the store can be tested without SQL Server.
 */
export class PrismaSessionStore extends session.Store {
  /**
   * @param {object} [options]
   * @param {() => Promise<{ session: object }>} [options.getDb]
   * @param {number} [options.ttlMs]
   */
  constructor({ getDb = getPrisma, ttlMs = SESSION_TTL_MS } = {}) {
    super();
    this.getDb = getDb;
    this.ttlMs = ttlMs;
  }

  // express-session speaks callbacks; everything here is a promise.
  #run(work, callback) {
    work().then(
      (value) => callback?.(null, value),
      (err) => callback?.(err)
    );
  }

  #expiry(sess) {
    const expires = sess?.cookie?.expires;
    return expires ? new Date(expires) : new Date(Date.now() + this.ttlMs);
  }

  get(sid, callback) {
    this.#run(async () => {
      const db = await this.getDb();
      const row = await db.session.findUnique({ where: { sid } });
      if (!row) return null;

      if (row.expiresAt.getTime() <= Date.now()) {
        await db.session.deleteMany({ where: { sid } });
        return null;
      }
      return JSON.parse(row.data);
    }, callback);
  }

  set(sid, sess, callback) {
    this.#run(async () => {
      const db = await this.getDb();
      const values = {
        data: JSON.stringify(sess),
        expiresAt: this.#expiry(sess),
        userId: sess.userId ?? null,
      };

      // Not upsert: on SQL Server Prisma runs it as a SELECT then a write, and
      // the same new sid saved twice at once fails with a unique violation.
      // Here the loser of the INSERT updates instead.
      const save = () => db.session.updateMany({ where: { sid }, data: values });
      if ((await save()).count > 0) return;
      try {
        await db.session.create({ data: { sid, ...values } });
      } catch (err) {
        if (err?.code !== UNIQUE_VIOLATION) throw err;
        await save();
      }
    }, callback);
  }

  /** Called on a request that read the session without changing it. */
  touch(sid, sess, callback) {
    this.#run(async () => {
      const db = await this.getDb();
      await db.session.updateMany({ where: { sid }, data: { expiresAt: this.#expiry(sess) } });
    }, callback);
  }

  destroy(sid, callback) {
    this.#run(async () => {
      const db = await this.getDb();
      // deleteMany: ending a session that is already gone is not an error.
      await db.session.deleteMany({ where: { sid } });
    }, callback);
  }

  /** Removes expired rows. Nothing reads them; this only keeps the table small. */
  async prune() {
    const db = await this.getDb();
    const { count } = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return count;
  }
}

/**
 * The cookie's name and attributes, shared by the middleware and by sign-out,
 * which must clear the cookie with the attributes it was set with.
 * @param {{ NODE_ENV: string }} config
 */
export function sessionCookie(config) {
  const production = config.NODE_ENV === 'production';
  return {
    // __Host- pins the cookie to this exact origin: Secure, Path=/, no Domain.
    name: production ? '__Host-mgp.sid' : 'mgp.sid',
    options: { httpOnly: true, secure: production, sameSite: 'lax', path: '/' },
  };
}

/**
 * @param {{ NODE_ENV: string, SESSION_SECRET?: string, SESSION_SECRET_PREVIOUS?: string,
 *   sessionIdleMs?: number }} config
 * @param {import('express-session').Store} store
 */
export function sessionMiddleware(config, store) {
  const { name, options } = sessionCookie(config);
  // Production cannot boot without SESSION_SECRET (config/env.js). The first
  // secret signs; the previous one still verifies, so a rotation signs nobody out.
  const secrets = [
    config.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    config.SESSION_SECRET_PREVIOUS,
  ].filter(Boolean);

  return session({
    name,
    store,
    secret: secrets,
    resave: false,
    // No row and no cookie until something is put in the session.
    saveUninitialized: false,
    // Idle, not absolute: each response renews the cookie and the row.
    rolling: true,
    cookie: { ...options, maxAge: config.sessionIdleMs ?? SESSION_TTL_MS },
  });
}

/**
 * Ends a signed-in session twelve hours after sign-in, and until then keeps
 * the idle window from reaching past that moment. Mounted straight after the
 * session middleware. A signed-in session with no start time (it cannot have
 * come from startSession) is ended too.
 *
 * @param {{ NODE_ENV: string, sessionIdleMs?: number, sessionAbsoluteMs?: number }} config
 * @param {() => number} [clock]  for tests
 */
export function sessionLifetime(config, clock = Date.now) {
  const cookie = sessionCookie(config);
  const idleMs = config.sessionIdleMs ?? SESSION_TTL_MS;
  const absoluteMs = config.sessionAbsoluteMs ?? SESSION_ABSOLUTE_MS;

  return async (req, res, next) => {
    if (!req.session?.userId) return next();

    const startedAt = Number(req.session.startedAt);
    const left = Number.isFinite(startedAt) ? startedAt + absoluteMs - clock() : 0;
    if (left <= 0) {
      await destroySession(req);
      res.clearCookie(cookie.name, cookie.options);
      req.log?.info('session ended: absolute lifetime reached');
      return next();
    }

    // express-session renews the cookie to originalMaxAge on every response.
    const window = Math.min(idleMs, left);
    req.session.cookie.originalMaxAge = window;
    req.session.cookie.maxAge = window;
    next();
  };
}

/** Swaps the session for a fresh one with a new id. Used at sign-in. */
export function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/** Ends the session and removes its row. */
export function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}
