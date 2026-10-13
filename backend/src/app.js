/**
 * app.js — builds the Express application. No listening happens here, so tests
 * can drive the app with supertest without binding a port.
 *
 * Shape: request ID and log line, security headers, compression, rate limits,
 * the health probes, the session (with its two lifetimes) and its CSRF check,
 * the sign-in routes, then a guard that turns away anyone not signed in, then
 * every other API route, then the static frontend and the 404 and error
 * handlers. The frontend is plain files with no
 * build step, so this server is the only thing that has to run.
 *
 * /api is closed by default: a route is public only if it is mounted above the
 * guard. A new module cannot forget to ask for a session.
 *
 * CORS is closed: no Access-Control-* header is ever sent, so no other origin
 * can read an answer or send a request that needs a preflight. The portal's
 * pages and its API share one origin and need none.
 *
 * Every route mounted here is listed in app.locals.routes, which is what
 * tests/authz-matrix.test.js checks its table against: a route added without
 * an entry there fails that test.
 */

import compression from 'compression';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';

import { FRONTEND_DIR, env, isProduction, isTest } from './config/env.js';
import { PrismaSessionStore, sessionLifetime, sessionMiddleware } from './lib/session.js';
import { loadUser, requireAuth } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { apiNotFound, errorHandler, pageNotFound } from './middleware/errors.js';
import { accountLimiter, apiLimiter, authLimiter } from './middleware/rate-limit.js';
import { requestLog } from './middleware/request-log.js';
import { createMemoryOutbox } from './integrations/graph/mock-mail.js';
import {
  createMemoryScanStore,
  createPrismaScanStore,
  createScannedStorage,
  createScanner,
} from './lib/file-scan.js';
import { createNotifier } from './lib/notify.js';
import { getPrisma } from './lib/prisma.js';
import { noTelemetry } from './lib/telemetry.js';
import { precompressedStatic } from './lib/precompressed-static.js';
import { serviceWorkerRoute, workerEnabledFor } from './lib/service-worker.js';
import { defaultStorage } from './lib/storage.js';
import { adminRoutes, logoRoutes } from './modules/admin/routes.js';
import { createAdminService } from './modules/admin/service.js';
import { createMemoryAdminStore } from './modules/admin/store-memory.js';
import { createPrismaAdminStore } from './modules/admin/store-prisma.js';
import { adminAnnouncementRoutes, readerRoutes } from './modules/announcements/routes.js';
import { createAnnouncementService } from './modules/announcements/service.js';
import { createMemoryAnnouncementStore } from './modules/announcements/store-memory.js';
import { createPrismaAnnouncementStore } from './modules/announcements/store-prisma.js';
import { createMemoryUserRepo } from './modules/auth/repo-memory.js';
import { devOutboxRoutes, notificationRoutes } from './modules/notifications/routes.js';
import { createNotificationService } from './modules/notifications/service.js';
import { createMemoryNotificationStore } from './modules/notifications/store-memory.js';
import { createPrismaNotificationStore } from './modules/notifications/store-prisma.js';
import {
  adminDirectoryRoutes,
  readerRoutes as directoryRoutes,
} from './modules/directory/routes.js';
import { createDirectoryService } from './modules/directory/service.js';
import { createMemoryDirectoryStore } from './modules/directory/store-memory.js';
import { createPrismaDirectoryStore } from './modules/directory/store-prisma.js';
import { createGraph, graph } from './integrations/graph/index.js';
import { createSyncRunner } from './jobs/syncUsers.js';
import { createPrismaUserRepo } from './modules/auth/repo.js';
import { meRoutes, publicAuthRoutes } from './modules/auth/routes.js';
import {
  adminBookingRoutes,
  adminRoomRoutes,
  bookingRoutes,
  roomRoutes,
} from './modules/rooms/routes.js';
import { createRoomService } from './modules/rooms/service.js';
import { createMemoryRoomStore } from './modules/rooms/store-memory.js';
import { createPrismaRoomStore } from './modules/rooms/store-prisma.js';
import { createHelpdeskAdminService } from './modules/tickets/admin-service.js';
import { helpdeskAdminRoutes, ticketRoutes } from './modules/tickets/routes.js';
import { createTicketService } from './modules/tickets/service.js';
import { createMemoryTicketStore } from './modules/tickets/store-memory.js';
import { createPrismaTicketStore } from './modules/tickets/store-prisma.js';

/**
 * @param {object} [options]
 * @param {{ windowMs?: number, limit?: number }} [options.rateLimit]  /api cap, for tests
 * @param {{ windowMs?: number, limit?: number, accountLimit?: number }} [options.authRateLimit]
 *   sign-in caps (per address, per account), for tests
 * @param {(app: import('express').Express) => void} [options.routes]  extra routes
 *   outside the session, CSRF check and sign-in guard, for tests
 * @param {(app: import('express').Express) => void} [options.protectedRoutes]  extra
 *   routes behind all three, for tests
 * @param {Partial<typeof env>} [options.config]  overrides of the environment, for tests
 * @param {object} [options.userRepo]  see modules/auth/repo.js
 * @param {object} [options.adminStore]  see modules/admin/store-prisma.js
 * @param {object} [options.announcementStore]  see modules/announcements/store-prisma.js
 * @param {object} [options.storage]  see lib/storage.js; the configured adapter by default
 * @param {object} [options.scanner]  see lib/file-scan.js; the configured scanner by default
 * @param {object} [options.scanStore]  see lib/file-scan.js
 * @param {object} [options.telemetry]  see lib/telemetry.js; none by default
 * @param {() => Promise<void>} [options.checkDatabase]  /api/ready's database check, for tests
 * @param {object} [options.directoryStore]  see modules/directory/store-prisma.js
 * @param {object} [options.roomStore]  see modules/rooms/store-prisma.js
 * @param {object} [options.ticketStore]  see modules/tickets/store-prisma.js
 * @param {object} [options.graph]  a Graph client in place of the configured one, for tests
 * @param {object} [options.notificationStore]  see modules/notifications/store-prisma.js
 * @param {() => Date} [options.now]  the clock the announcements, rooms, tickets and sync read, for tests
 * @param {import('express-session').Store} [options.sessionStore]
 * @param {object} [options.msalClient]  a stand-in for the MSAL client, for tests
 */
export function createApp(options = {}) {
  const app = express();
  const config = { ...env, ...options.config };

  // Sessions and users live in SQL Server. Without one configured (and always
  // under test, so a test never writes to a developer's database) both are
  // held in memory instead. Production cannot get here without a database.
  // `isTest` is the process's own NODE_ENV: the API tests pass
  // config.NODE_ENV 'development' to reach mock sign-in, and must still keep
  // their sessions out of the shared test database, which another run empties
  // (docs/DECISIONS.md D84).
  const useDatabase = config.hasDatabase && config.NODE_ENV !== 'test' && !isTest;
  const repo =
    options.userRepo ?? (useDatabase ? createPrismaUserRepo() : createMemoryUserRepo());
  const store =
    options.sessionStore ??
    (useDatabase ? new PrismaSessionStore() : new session.MemoryStore());
  // The admin module works on the same people as sign-in: the in-memory ones
  // when the user repo is the in-memory one (which exposes its rows), the
  // database otherwise. Never a mix, so a test cannot reach a real database.
  const adminStore =
    options.adminStore ??
    (repo.companies ? createMemoryAdminStore(repo) : createPrismaAdminStore());
  const telemetry = options.telemetry ?? noTelemetry;
  const directoryStore =
    options.directoryStore ??
    (repo.companies ? createMemoryDirectoryStore(repo) : createPrismaDirectoryStore());
  // One Graph client for the app. In memory the mocked calendar is kept in
  // memory too, beside the rooms and bookings that refer to it.
  // Under test the mocked mail is kept in an array (app.locals.mailOutbox),
  // never written to backend/mock/outbox/.
  const mailOutbox = isTest ? createMemoryOutbox() : undefined;
  let graphClient = options.graph ? Promise.resolve(options.graph) : null;
  const getGraph = () => {
    graphClient ??= repo.mockCalendarEvents
      ? createGraph({ memoryCalendar: repo.mockCalendarEvents, outbox: mailOutbox })
      : graph();
    return graphClient;
  };

  // Notifications: one notifier for every module that has something to say.
  const notificationStore =
    options.notificationStore ??
    (repo.companies ? createMemoryNotificationStore(repo) : createPrismaNotificationStore());
  const notify = createNotifier({
    store: notificationStore,
    getGraph,
    config,
    now: options.now,
  });
  const notifications = createNotificationService({
    store: notificationStore,
    now: options.now,
  });
  // Uploaded files: the configured adapter, behind the malware-scan gate.
  // Every module is handed this one object, so none can read a file that has
  // not been found clean (lib/file-scan.js).
  const files = createScannedStorage({
    storage: options.storage ?? defaultStorage(config),
    scans:
      options.scanStore ??
      (repo.companies ? createMemoryScanStore(repo) : createPrismaScanStore()),
    scanner: options.scanner ?? createScanner(config),
    notify,
    now: options.now,
  });
  const admin = createAdminService({ store: adminStore, storage: files });
  const announcements = createAnnouncementService({
    store:
      options.announcementStore ??
      (repo.companies ? createMemoryAnnouncementStore(repo) : createPrismaAnnouncementStore()),
    storage: files,
    now: options.now,
    notify,
  });
  const syncRunner = createSyncRunner({
    store: directoryStore,
    getGraph,
    now: options.now,
  });
  const directory = createDirectoryService({ store: directoryStore, syncRunner });
  const rooms = createRoomService({
    store:
      options.roomStore ??
      (repo.companies ? createMemoryRoomStore(repo) : createPrismaRoomStore()),
    storage: files,
    getGraph,
    now: options.now,
    notify,
  });
  const ticketStore =
    options.ticketStore ??
    (repo.companies ? createMemoryTicketStore(repo) : createPrismaTicketStore());
  const tickets = createTicketService({
    store: ticketStore,
    storage: files,
    now: options.now,
    notify,
  });
  const helpdeskAdmin = createHelpdeskAdminService({ store: ticketStore });
  app.locals.sessionStore = store;
  app.locals.tickets = tickets;
  app.locals.announcements = announcements;
  app.locals.notify = notify;
  app.locals.mailOutbox = mailOutbox;
  app.locals.syncRunner = syncRunner;
  app.locals.inMemory = !useDatabase;
  app.locals.files = files;
  app.locals.telemetry = telemetry;
  /** Set by server.js when the process is stopping: /api/ready then says no. */
  app.locals.stopping = false;
  app.locals.production = config.NODE_ENV === 'production';

  /** Every "METHOD /path" the app answers, for the authorisation matrix test. */
  const routes = ['GET /api/health', 'GET /api/ready'];
  app.locals.routes = routes;
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

  // Behind Azure App Service's front end, which is exactly one proxy: the
  // client is the last address it appended to X-Forwarded-For, and anything
  // before that is the client's own claim. Needed for req.secure (Secure
  // cookies) and for rate limiting by the real client (lib/client-ip.js).
  app.set('trust proxy', config.TRUST_PROXY_HOPS > 0 ? config.TRUST_PROXY_HOPS : false);
  app.disable('x-powered-by');

  // First, so that every later failure has an ID and a log line.
  app.use(requestLog);
  if (telemetry.enabled) app.use(telemetry.middleware);

  const production = config.NODE_ENV === 'production';
  // The headers common to every response, whatever it is.
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
    // object model, which the policy allows (frontend/assets/js/html.js).
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
  app.use((req, res, next) => {
    if (req.path.startsWith('/assets/')) return assetHeaders(req, res, next);
    // helmet does not set this one. The portal uses none of these features,
    // so no page (and nothing injected into one) may ask for them.
    res.set(
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()'
    );
    pageHeaders(req, res, next);
  });

  // Site staff are on weak mobile connections: text assets and JSON go out
  // compressed. Fonts and images are already compressed and are skipped by
  // the library's content-type filter.
  app.use(compression());

  app.use('/api', apiLimiter(options.rateLimit));
  // Entra's routes are /auth/*; the mock ones and sign-out are /api/auth/*.
  app.use(['/api/auth', '/auth'], authLimiter(options.authRateLimit, config));

  app.use(express.json({ limit: '100kb' }));

  // Liveness: the process is up. Nothing is checked, so it never flaps.
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: can this instance serve a request right now? App Service's
  // health check points here and takes an instance that answers 503 out of
  // rotation. Says which part failed and nothing more.
  const checkDatabase =
    options.checkDatabase ??
    (useDatabase
      ? async () => {
          await (await getPrisma()).company.findFirst({ select: { id: true } });
        }
      : null);
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

  mount(
    '',
    publicAuthRoutes({
      config,
      repo,
      msalClient: options.msalClient,
      accounts: accountLimiter(options.authRateLimit, config),
    })
  );

  // The guard. Below this line every /api route has a req.user.
  app.use('/api', loadUser(repo, config), requireAuth);

  mount('', meRoutes({ config, repo }));

  mount('/api/admin', adminRoutes(admin));
  mount('', logoRoutes(admin));

  mount('/api/admin/announcements', adminAnnouncementRoutes(announcements));
  mount('/api/announcements', readerRoutes(announcements));

  mount('/api/admin/directory', adminDirectoryRoutes(directory));
  mount('/api/directory', directoryRoutes(directory));

  mount('/api/admin/rooms', adminRoomRoutes(rooms));
  mount('/api/admin/bookings', adminBookingRoutes(rooms));
  mount('/api/rooms', roomRoutes(rooms));
  mount('/api/bookings', bookingRoutes(rooms));

  mount('/api/admin/helpdesk', helpdeskAdminRoutes(helpdeskAdmin));
  mount('/api/tickets', ticketRoutes(tickets));

  mount('/api/notifications', notificationRoutes(notifications));
  // What the mocked Graph "sent": for developers, never in production.
  if (!isProduction && !production) mount('/api/dev', devOutboxRoutes(getGraph));

  // Module routers mount here as they are built.
  options.protectedRoutes?.(app);

  app.use(apiNotFound);

  // Before the static files, so the template with its placeholders is never
  // served as it is on disk.
  app.get(
    '/sw.js',
    serviceWorkerRoute({
      frontendDir: FRONTEND_DIR,
      enabled: (req) => workerEnabledFor(req, config),
      fixed: isProduction,
    })
  );

  if (config.staticPrecompress) {
    const precompressed = precompressedStatic(FRONTEND_DIR, {
      cacheControl: isProduction ? 'public, max-age=3600' : 'public, max-age=0',
      skip: ['/sw.js'],
    });
    app.use(precompressed);
    // In the background: the first phone should not pay for the best setting.
    if (!isTest) setImmediate(() => precompressed.warm().catch(() => {}));
  }

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
