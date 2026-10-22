/**
 * app.js — builds the Express application. No listening happens here, so tests
 * can drive the app with supertest without binding a port.
 *
 * Shape: request ID and log line, security headers, compression, rate limits,
 * the health probes, the session (with its two lifetimes) and its CSRF check
 * (all shared with the IT Helpdesk: packages/shared/server/lib/http-app.js),
 * the sign-in routes, then a guard that turns away anyone not signed in, then
 * every other API route, then the static frontend and the 404 and error
 * handlers. The frontend is plain files with no build step (the portal's own
 * over packages/shared/web), so this server is the only thing that has to run.
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

import express from 'express';
import session from 'express-session';

import { FRONTEND_DIR, FRONTEND_DIRS, env, isProduction, isTest } from './config/env.js';
import { PrismaSessionStore, sessionLifetime } from '@mg/shared/server/lib/session.js';
import {
  createRouteTable,
  frontMiddleware,
  probeRoutes,
  sessionRoutes,
} from '@mg/shared/server/lib/http-app.js';
import { helpdeskOnly, loadUser, requireAuth } from '@mg/shared/server/middleware/auth.js';
import {
  apiNotFound,
  errorHandler,
  pageNotFound,
} from '@mg/shared/server/middleware/errors.js';
import { accountLimiter } from '@mg/shared/server/middleware/rate-limit.js';
import { createMemoryOutbox } from '@mg/shared/server/integrations/graph/mock-mail.js';
import {
  createMemoryScanStore,
  createPrismaScanStore,
  createScannedStorage,
  createScanner,
} from '@mg/shared/server/lib/file-scan.js';
import { createNotifier } from '@mg/shared/server/lib/notify.js';
import { getPrisma } from '@mg/shared/server/lib/prisma.js';
import { noTelemetry } from '@mg/shared/server/lib/telemetry.js';
import { serveFrontend } from '@mg/shared/server/lib/static-site.js';
import { serviceWorkerRoute, workerEnabledFor } from '@mg/shared/server/lib/service-worker.js';
import { defaultStorage } from '@mg/shared/server/lib/storage.js';
import { adminRoutes, logoRoutes } from './modules/admin/routes.js';
import { createAdminService } from './modules/admin/service.js';
import { createMemoryAdminStore } from './modules/admin/store-memory.js';
import { createPrismaAdminStore } from './modules/admin/store-prisma.js';
import { adminAnnouncementRoutes, readerRoutes } from './modules/announcements/routes.js';
import { createAnnouncementService } from './modules/announcements/service.js';
import { createMemoryAnnouncementStore } from './modules/announcements/store-memory.js';
import { createPrismaAnnouncementStore } from './modules/announcements/store-prisma.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';
import {
  devOutboxRoutes,
  notificationRoutes,
} from '@mg/shared/server/modules/notifications/routes.js';
import { createNotificationService } from '@mg/shared/server/modules/notifications/service.js';
import { createMemoryNotificationStore } from '@mg/shared/server/modules/notifications/store-memory.js';
import { createPrismaNotificationStore } from '@mg/shared/server/modules/notifications/store-prisma.js';
import {
  adminDirectoryRoutes,
  readerRoutes as directoryRoutes,
} from './modules/directory/routes.js';
import { createDirectoryService } from '@mg/shared/server/modules/directory/service.js';
import { createMemoryDirectoryStore } from '@mg/shared/server/modules/directory/store-memory.js';
import { createPrismaDirectoryStore } from '@mg/shared/server/modules/directory/store-prisma.js';
import { createGraph, graph } from '@mg/shared/server/integrations/graph/index.js';
import { createSyncRunner } from '@mg/shared/server/jobs/syncUsers.js';
import { createPrismaUserRepo } from '@mg/shared/server/modules/auth/repo.js';
import { meRoutes, publicAuthRoutes } from '@mg/shared/server/modules/auth/routes.js';
import {
  adminBookingRoutes,
  adminRoomRoutes,
  bookingRoutes,
  roomRoutes,
} from './modules/rooms/routes.js';
import { createRoomService } from './modules/rooms/service.js';
import { createMemoryRoomStore } from './modules/rooms/store-memory.js';
import { createPrismaRoomStore } from './modules/rooms/store-prisma.js';
import {
  helpdeskRoutes,
  helpdeskSettingsRoutes,
  itTeamRoutes,
} from '@mg/shared/server/modules/helpdesk/routes.js';
import { helpdeskPages } from './modules/helpdesk/pages.js';
import { createHelpdeskAdminService } from '@mg/shared/server/modules/tickets/admin-service.js';
import { createReportService } from '@mg/shared/server/modules/tickets/reports.js';
import { ticketRoutes } from '@mg/shared/server/modules/tickets/routes.js';
import { createTicketService } from '@mg/shared/server/modules/tickets/service.js';
import { createMemoryTicketStore } from '@mg/shared/server/modules/tickets/store-memory.js';
import { createPrismaTicketStore } from '@mg/shared/server/modules/tickets/store-prisma.js';

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
 * @param {object} [options.profileGraph]  a stand-in for integrations/graph/delegated.js, for tests
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
  const reports = createReportService({ store: ticketStore, tickets, now: options.now });
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

  const { mount } = createRouteTable(app);

  // Request log, headers, compression, rate limits, JSON bodies (lib/http-app.js).
  frontMiddleware(app, {
    config,
    telemetry,
    rateLimit: options.rateLimit,
    authRateLimit: options.authRateLimit,
  });

  probeRoutes(app, {
    checkDatabase:
      options.checkDatabase ??
      (useDatabase
        ? async () => {
            await (await getPrisma()).company.findFirst({ select: { id: true } });
          }
        : null),
    files,
  });

  options.routes?.(app);

  // The session, its lifetime and the CSRF check on /api and /auth. One
  // instance, shared with the IT Helpdesk's page gate below.
  const sessions = sessionRoutes(app, { config, store });

  mount(
    '',
    publicAuthRoutes({
      config,
      repo,
      msalClient: options.msalClient,
      profileGraph: options.profileGraph,
      accounts: accountLimiter(options.authRateLimit, config),
    })
  );

  // The guard. Below this line every /api route has a req.user. IT team
  // members are kept to the Helpdesk's part of it (D135).
  app.use('/api', loadUser(repo, config), requireAuth, helpdeskOnly);

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

  // The IT Helpdesk (D135): its settings for IT Leads, its reports and people
  // search for the IT team, and who is on the team for the HoldingAdmin.
  mount('/api/helpdesk/settings', helpdeskSettingsRoutes(helpdeskAdmin));
  mount('/api/helpdesk', helpdeskRoutes({ reports, directory }));
  mount('/api/admin/it-team', itTeamRoutes(helpdeskAdmin));
  mount('/api/tickets', ticketRoutes(tickets));

  mount('/api/notifications', notificationRoutes(notifications));
  // What the mocked Graph "sent": for developers, never in production.
  if (!isProduction && !app.locals.production) mount('/api/dev', devOutboxRoutes(getGraph));

  // Module routers mount here as they are built.
  options.protectedRoutes?.(app);

  app.use(apiNotFound);

  // The IT Helpdesk's page is for the IT team (D135): anyone else asking for
  // /helpdesk is shown that it is not theirs. The API enforces it as well.
  app.use(
    helpdeskPages({
      frontendDir: FRONTEND_DIR,
      session: [sessions, sessionLifetime(config), loadUser(repo, config)],
    })
  );

  // Before the static files, so the template with its placeholders is never
  // served as it is on disk.
  app.get(
    '/sw.js',
    serviceWorkerRoute({
      frontendDir: FRONTEND_DIRS,
      enabled: (req) => workerEnabledFor(req, config),
      fixed: isProduction,
    })
  );

  serveFrontend(app, { frontendDirs: FRONTEND_DIRS, config, isProduction, isTest });

  app.use(pageNotFound);
  app.use(errorHandler);

  return app;
}
