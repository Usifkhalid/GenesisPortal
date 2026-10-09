/**
 * app.js — builds the Express application. No listening happens here, so tests
 * can drive the app with supertest without binding a port.
 *
 * Shape: request ID and log line, security headers, compression, rate limits,
 * the session and its CSRF check, the sign-in routes, then a guard that turns
 * away anyone not signed in, then every other API route, then the static
 * frontend and the 404 and error handlers. The frontend is plain files with no
 * build step, so this server is the only thing that has to run.
 *
 * /api is closed by default: a route is public only if it is mounted above the
 * guard. A new module cannot forget to ask for a session.
 */

import compression from 'compression';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';

import { FRONTEND_DIR, env, isProduction } from './config/env.js';
import { PrismaSessionStore, sessionMiddleware } from './lib/session.js';
import { loadUser, requireAuth } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { apiNotFound, errorHandler, pageNotFound } from './middleware/errors.js';
import { apiLimiter, authLimiter } from './middleware/rate-limit.js';
import { requestLog } from './middleware/request-log.js';
import { createMemoryUserRepo } from './modules/auth/repo-memory.js';
import { createPrismaUserRepo } from './modules/auth/repo.js';
import { meRoutes, publicAuthRoutes } from './modules/auth/routes.js';

/**
 * @param {object} [options]
 * @param {{ windowMs?: number, limit?: number }} [options.rateLimit]  /api cap, for tests
 * @param {{ windowMs?: number, limit?: number }} [options.authRateLimit]  /api/auth cap, for tests
 * @param {(app: import('express').Express) => void} [options.routes]  extra routes
 *   outside the session, CSRF check and sign-in guard, for tests
 * @param {(app: import('express').Express) => void} [options.protectedRoutes]  extra
 *   routes behind all three, for tests
 * @param {Partial<typeof env>} [options.config]  overrides of the environment, for tests
 * @param {object} [options.userRepo]  see modules/auth/repo.js
 * @param {import('express-session').Store} [options.sessionStore]
 * @param {object} [options.msalClient]  a stand-in for the MSAL client, for tests
 */
export function createApp(options = {}) {
  const app = express();
  const config = { ...env, ...options.config };

  // Sessions and users live in SQL Server. Without one configured (and always
  // under test, so a test never writes to a developer's database) both are
  // held in memory instead. Production cannot get here without a database.
  const useDatabase = config.hasDatabase && config.NODE_ENV !== 'test';
  const repo =
    options.userRepo ?? (useDatabase ? createPrismaUserRepo() : createMemoryUserRepo());
  const store =
    options.sessionStore ??
    (useDatabase ? new PrismaSessionStore() : new session.MemoryStore());
  app.locals.sessionStore = store;
  app.locals.inMemory = !useDatabase;

  // Behind Azure App Service's proxy: needed for correct protocol detection on
  // Secure cookies and for rate limiting by real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // First, so that every later failure has an ID and a log line.
  app.use(requestLog);

  app.use(
    helmet({
      // The frontend sets a handful of custom properties through style
      // attributes, which helmet's default style-src already permits; scripts
      // are all external modules, so script-src stays 'self' with no inline
      // allowance.
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          scriptSrc: ["'self'"],
          // Nothing is loaded from outside: helmet's default allowance of any
          // https: origin for stylesheets is dropped.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
      // Set only over HTTPS in production; a dev value would pin localhost.
      strictTransportSecurity: isProduction,
      crossOriginEmbedderPolicy: false,
    })
  );

  // Site staff are on weak mobile connections: text assets and JSON go out
  // compressed. Fonts and images are already compressed and are skipped by
  // the library's content-type filter.
  app.use(compression());

  app.use('/api', apiLimiter(options.rateLimit));
  // Entra's routes are /auth/*; the mock ones and sign-out are /api/auth/*.
  app.use(['/api/auth', '/auth'], authLimiter(options.authRateLimit));

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  options.routes?.(app);

  // Only the API and the sign-in routes carry a session: a static file never
  // costs a database read.
  const stateful = ['/api', '/auth'];
  app.use(stateful, (req, res, next) => {
    // Everything from here on is one person's data.
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(stateful, sessionMiddleware(config, store));
  app.use(stateful, csrfProtection);

  app.use(publicAuthRoutes({ config, repo, msalClient: options.msalClient }));

  // The guard. Below this line every /api route has a req.user.
  app.use('/api', loadUser(repo), requireAuth);

  app.use(meRoutes({ config, repo }));

  // Module routers mount here as they are built:
  //   app.use('/api/announcements', announcementRoutes);
  options.protectedRoutes?.(app);

  app.use(apiNotFound);

  app.use(
    express.static(FRONTEND_DIR, {
      extensions: ['html'],
      // Fingerprinted asset names do not exist yet, so assets are revalidated
      // rather than held; site staff on weak connections still get 304s.
      maxAge: isProduction ? '1h' : 0,
    })
  );

  app.use(pageNotFound);
  app.use(errorHandler);

  return app;
}
