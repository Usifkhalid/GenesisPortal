/**
 * session.js — the server-side session (express-session) and its SQL Server
 * store.
 *
 * The browser holds one signed, httpOnly cookie carrying a session id and
 * nothing else: no token, no user data. The session itself is a row in the
 * Session table. It lives for eight hours of idleness; every request pushes
 * the end of that window forward, in the row and in the cookie.
 */

import { randomBytes } from 'node:crypto';
import session from 'express-session';

import { getPrisma } from './prisma.js';

/** Idle timeout: a session unused for this long is gone. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

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
      await db.session.upsert({ where: { sid }, update: values, create: { sid, ...values } });
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
 * @param {{ NODE_ENV: string, SESSION_SECRET?: string }} config
 * @param {import('express-session').Store} store
 */
export function sessionMiddleware(config, store) {
  const { name, options } = sessionCookie(config);

  return session({
    name,
    store,
    // Production cannot boot without SESSION_SECRET (config/env.js).
    secret: config.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    resave: false,
    // No row and no cookie until something is put in the session.
    saveUninitialized: false,
    // Idle, not absolute: each response renews the cookie and the row.
    rolling: true,
    cookie: { ...options, maxAge: SESSION_TTL_MS },
  });
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
