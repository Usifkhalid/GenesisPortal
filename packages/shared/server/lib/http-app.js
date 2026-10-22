/**
 * http-app.js — the parts of an Express app that are the same in every MG
 * Holding app (apps/portal, apps/helpdesk): the route table the authorisation
 * matrix tests read, the request log, security headers, compression and rate
 * limits, the health probes, and the session with its two lifetimes and its
 * CSRF check. Each app's backend/src/app.js calls these in this order, then
 * mounts its own routes.
 *
 * CORS is closed: no Access-Control-* header is ever sent, so no other origin
 * can read an answer or send a request that needs a preflight. An app's pages
 * and its API share one origin and need none.
 */

import compression from 'compression';
import express from 'express';
import helmet from 'helmet';

import { csrfProtection } from '../middleware/csrf.js';
import { apiLimiter, authLimiter } from '../middleware/rate-limit.js';
import { requestLog } from '../middleware/request-log.js';
import { sessionLifetime, sessionMiddleware } from './session.js';

/**
 * Every "METHOD /path" the app answers, kept in app.locals.routes for the
 * authorisation matrix test: a route added without an entry there fails it.
 * @param {import('express').Express} app
 */
export function createRouteTable(app) {
  const routes = ['GET /api/health', 'GET /api/ready'];
  app.locals.routes = routes;
  /** Mounts `router` at `prefix` and lists its routes. */
  const mount = (prefix, router) => {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const path = `${prefix}${layer.route.path === '/' ? '' : layer.route.path}`;
      for (const method of Object.keys(layer.route.methods)) {
        routes.push(`${method.toUpperCase()} ${path}`);
      }
    }
    if (prefix) app.use(prefix, router);
    else app.use(router);
  };
  return { routes, mount };
}

/**
 * The headers common to every response, a short policy for /assets and the
 * whole one for pages and the API.
 * @param {{ production: boolean }} options
 */
export function securityHeaders({ production }) {
  const transport = {
    // Set only over HTTPS in production; a dev value would pin localhost.
    strictTransportSecurity: production
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  };
  // Stylesheets, scripts, fonts, images and translation files under /assets
  // are parts of a page, and a browser applies the page's policy to them, not
  // their own. They get one short line (which still stops a file opened on
  // its own from running or being framed) instead of the full policy: forty
  // of them make a first load, and site staff pay for every header byte.
  const assetHeaders = helmet({
    ...transport,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
  });
  const pageHeaders = helmet({
    // The whole policy is written out here; helmet's defaults are not mixed
    // in. Nothing inline and nothing from another origin: scripts and
    // styles are files of this site only. No 'unsafe-inline', no
    // 'unsafe-eval', no nonces to get wrong. Per-element values the pages
    // need (a booking's position, a colour swatch) are set through the CSS
    // object model, which the policy allows (web/assets/js/html.js).
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'"],
        styleSrcAttr: ["'none'"],
        // blob: only for the preview of a file the person just chose (a
        // logo, an announcement cover), made by the page itself; data: for
        // the small images the stylesheets carry.
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        // Development only: the mocked-mail page frames a mail's HTML from
        // /api/dev (never mounted in production, where no frame is allowed).
        ...(production ? { upgradeInsecureRequests: [] } : { frameSrc: ["'self'"] }),
      },
    },
    ...transport,
  });
  return (req, res, next) => {
    if (req.path.startsWith('/assets/')) return assetHeaders(req, res, next);
    // helmet does not set this one. The apps use none of these features, so
    // no page (and nothing injected into one) may ask for them.
    res.set(
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()'
    );
    pageHeaders(req, res, next);
  };
}

/**
 * Proxy trust, the request log, headers, compression, rate limits and JSON
 * bodies: everything before the probes.
 *
 * @param {import('express').Express} app
 * @param {object} options
 * @param {object} options.config  the app's environment
 * @param {{ enabled: boolean, middleware: Function }} options.telemetry
 * @param {{ windowMs?: number, limit?: number }} [options.rateLimit]  for tests
 * @param {object} [options.authRateLimit]  for tests
 */
export function frontMiddleware(app, { config, telemetry, rateLimit, authRateLimit }) {
  // Behind Azure App Service's front end, which is exactly one proxy: the
  // client is the last address it appended to X-Forwarded-For, and anything
  // before that is the client's own claim. Needed for req.secure (Secure
  // cookies) and for rate limiting by the real client (lib/client-ip.js).
  app.set('trust proxy', config.TRUST_PROXY_HOPS > 0 ? config.TRUST_PROXY_HOPS : false);
  app.disable('x-powered-by');

  // First, so that every later failure has an ID and a log line.
  app.use(requestLog);
  if (telemetry.enabled) app.use(telemetry.middleware);

  app.use(securityHeaders({ production: config.NODE_ENV === 'production' }));

  // Site staff are on weak mobile connections: text assets and JSON go out
  // compressed. Fonts and images are already compressed and are skipped by
  // the library's content-type filter.
  app.use(compression());

  app.use('/api', apiLimiter(rateLimit));
  // Entra's routes are /auth/*; the mock ones and sign-out are /api/auth/*.
  app.use(['/api/auth', '/auth'], authLimiter(authRateLimit, config));

  app.use(express.json({ limit: '100kb' }));
}

/**
 * /api/health and /api/ready.
 * @param {import('express').Express} app
 * @param {object} options
 * @param {(() => Promise<void>) | null} options.checkDatabase  null: skipped (memory)
 * @param {{ check: () => Promise<void> }} options.files  the storage to probe
 */
export function probeRoutes(app, { checkDatabase, files }) {
  // Liveness: the process is up. Nothing is checked, so it never flaps.
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: can this instance serve a request right now? App Service's
  // health check points here and takes an instance that answers 503 out of
  // rotation. Says which part failed and nothing more.
  app.get('/api/ready', async (req, res) => {
    const probe = async (check) => {
      if (!check) return 'skipped';
      try {
        await check();
        return 'ok';
      } catch (err) {
        req.log?.warn({ err }, 'readiness check failed');
        return 'failed';
      }
    };
    const [database, storage] = await Promise.all([
      probe(checkDatabase),
      probe(() => files.check()),
    ]);
    const ready = !app.locals.stopping && database !== 'failed' && storage !== 'failed';
    res
      .status(ready ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json({
        status: ready ? 'ready' : app.locals.stopping ? 'stopping' : 'unavailable',
        checks: { database, storage },
      });
  });
}

/**
 * The session on /api and /auth, its absolute lifetime and the CSRF check.
 * Returns the session middleware, for a page gate that reads the session too.
 * @param {import('express').Express} app
 * @param {{ config: object, store: import('express-session').Store }} options
 */
export function sessionRoutes(app, { config, store }) {
  // Only the API and the sign-in routes carry a session: a static file never
  // costs a database read.
  const stateful = ['/api', '/auth'];
  app.use(stateful, (req, res, next) => {
    // Everything from here on is one person's data.
    res.set('Cache-Control', 'no-store');
    next();
  });
  const sessions = sessionMiddleware(config, store);
  app.use(stateful, sessions);
  // Twelve hours after sign-in the session ends, however active (lib/session.js).
  app.use(stateful, sessionLifetime(config));
  // Signing out is never refused: a stale token (a restarted server, a second
  // tab) must not keep anyone signed in. Forcing a sign-out is harmless.
  const logoutPaths = new Set(['/api/auth/logout', '/auth/logout']);
  app.use(stateful, (req, res, next) =>
    req.method === 'POST' && logoutPaths.has(req.originalUrl.split('?')[0])
      ? next()
      : csrfProtection(req, res, next)
  );
  return sessions;
}
