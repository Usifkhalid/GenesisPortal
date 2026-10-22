/**
 * app.js — builds the IT Helpdesk's Express application (D144). No listening
 * happens here, so tests can drive the app with supertest without binding a
 * port.
 *
 * The same shape as the portal's, from the same shared parts
 * (packages/shared/server/lib/http-app.js): request ID and log line, security
 * headers, compression, rate limits, the health probes, the session with its
 * two lifetimes and its CSRF check, the sign-in routes, then the guard that
 * turns away anyone not signed in, then the helpdesk's API, then the static
 * frontend (apps/helpdesk/frontend over packages/shared/web) and the 404 and
 * error handlers.
 *
 * Who may do what:
 *   everyone signed in   raise a ticket, follow their own, reply, confirm and
 *                        rate a resolution (D143); their notifications
 *   the IT team          the queue, every ticket, reports; leads the settings
 *                        (the ticket service and requireIt decide, D99, D135)
 *   HoldingAdmin         Administration: who is on the IT team, companies and
 *                        their mail domains. The helpdesk's first administrators
 *                        come from INITIAL_HELPDESK_ADMINS (D136).
 *
 * /api is closed by default: a route is public only if it is mounted above the
 * guard. Every route mounted here is listed in app.locals.routes, which
 * backend/tests/authz-matrix.test.js checks its table against.
 */

import express from 'express';
import session from 'express-session';

import { FRONTEND_DIRS, env, isProduction, isTest } from './config/env.js';
import { describeHelpdeskMe } from './modules/me/service.js';
import { adminRoutes } from './modules/admin/routes.js';
import { createCompanyService } from './modules/admin/service.js';
import { createMemoryCompanyStore } from './modules/admin/store-memory.js';
import { createPrismaCompanyStore } from './modules/admin/store-prisma.js';
import { createMemoryOutbox } from '@mg/shared/server/integrations/graph/mock-mail.js';
import { createGraph, graph } from '@mg/shared/server/integrations/graph/index.js';
import { createSyncRunner } from '@mg/shared/server/jobs/syncUsers.js';
import {
  createMemoryScanStore,
  createPrismaScanStore,
  createScannedStorage,
  createScanner,
} from '@mg/shared/server/lib/file-scan.js';
import {
  createRouteTable,
  frontMiddleware,
  probeRoutes,
  sessionRoutes,
} from '@mg/shared/server/lib/http-app.js';
import { createNotifier } from '@mg/shared/server/lib/notify.js';
import { getPrisma } from '@mg/shared/server/lib/prisma.js';
import { serviceWorkerRoute, workerEnabledFor } from '@mg/shared/server/lib/service-worker.js';
import { PrismaSessionStore } from '@mg/shared/server/lib/session.js';
import { serveFrontend } from '@mg/shared/server/lib/static-site.js';
import { defaultStorage } from '@mg/shared/server/lib/storage.js';
import { noTelemetry } from '@mg/shared/server/lib/telemetry.js';
import { loadUser, requireAuth } from '@mg/shared/server/middleware/auth.js';
import {
  apiNotFound,
  errorHandler,
  pageNotFound,
} from '@mg/shared/server/middleware/errors.js';
import { accountLimiter } from '@mg/shared/server/middleware/rate-limit.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';
import { createPrismaUserRepo } from '@mg/shared/server/modules/auth/repo.js';
import { meRoutes, publicAuthRoutes } from '@mg/shared/server/modules/auth/routes.js';
import { createDirectoryService } from '@mg/shared/server/modules/directory/service.js';
import { createMemoryDirectoryStore } from '@mg/shared/server/modules/directory/store-memory.js';
import { createPrismaDirectoryStore } from '@mg/shared/server/modules/directory/store-prisma.js';
import {
  helpdeskRoutes,
  helpdeskSettingsRoutes,
  itTeamRoutes,
} from '@mg/shared/server/modules/helpdesk/routes.js';
import {
  devOutboxRoutes,
  notificationRoutes,
} from '@mg/shared/server/modules/notifications/routes.js';
import { createNotificationService } from '@mg/shared/server/modules/notifications/service.js';
import { createMemoryNotificationStore } from '@mg/shared/server/modules/notifications/store-memory.js';
import { createPrismaNotificationStore } from '@mg/shared/server/modules/notifications/store-prisma.js';
import { createHelpdeskAdminService } from '@mg/shared/server/modules/tickets/admin-service.js';
import { createReportService } from '@mg/shared/server/modules/tickets/reports.js';
import { ticketRoutes } from '@mg/shared/server/modules/tickets/routes.js';
import { createTicketService } from '@mg/shared/server/modules/tickets/service.js';
import { createMemoryTicketStore } from '@mg/shared/server/modules/tickets/store-memory.js';
import { createPrismaTicketStore } from '@mg/shared/server/modules/tickets/store-prisma.js';

/**
 * @param {object} [options]  the portal's createApp options, for the parts the
 *   helpdesk has: rateLimit, authRateLimit, routes, protectedRoutes, config,
 *   userRepo, companyStore, storage, scanner, scanStore, telemetry,
 *   checkDatabase, directoryStore, ticketStore, graph, notificationStore, now,
 *   sessionStore, msalClient, profileGraph
 */
export function createApp(options = {}) {
  const app = express();
  const config = { ...env, ...options.config };

  // SQL Server when one is configured, memory otherwise and always under
  // test (seed-data.js's fake people), never a mix (D84).
  const useDatabase = config.hasDatabase && config.NODE_ENV !== 'test' && !isTest;
  const repo =
    options.userRepo ?? (useDatabase ? createPrismaUserRepo() : createMemoryUserRepo());
  const store =
    options.sessionStore ??
    (useDatabase ? new PrismaSessionStore() : new session.MemoryStore());
  const inMemory = Boolean(repo.companies);
  const telemetry = options.telemetry ?? noTelemetry;

  // Graph: mail (GRAPH_MAIL_MODE) and the directory (GRAPH_DIRECTORY_MODE).
  // Under test the mocked mail is kept in an array (app.locals.mailOutbox).
  const mailOutbox = isTest ? createMemoryOutbox() : undefined;
  let graphClient = options.graph ? Promise.resolve(options.graph) : null;
  const getGraph = () => {
    graphClient ??= inMemory
      ? createGraph({ memoryCalendar: repo.mockCalendarEvents, outbox: mailOutbox })
      : graph();
    return graphClient;
  };

  // The bell and email: one notifier for everything that has something to say.
  const notificationStore =
    options.notificationStore ??
    (inMemory ? createMemoryNotificationStore(repo) : createPrismaNotificationStore());
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

  // Ticket attachments, behind the malware-scan gate (lib/file-scan.js).
  const files = createScannedStorage({
    storage: options.storage ?? defaultStorage(config),
    scans:
      options.scanStore ?? (inMemory ? createMemoryScanStore(repo) : createPrismaScanStore()),
    scanner: options.scanner ?? createScanner(config),
    notify,
    now: options.now,
  });

  // People: the nightly sync from Microsoft 365 and the search the IT team and
  // the administrators pick people with.
  const directoryStore =
    options.directoryStore ??
    (inMemory ? createMemoryDirectoryStore(repo) : createPrismaDirectoryStore());
  const syncRunner = createSyncRunner({ store: directoryStore, getGraph, now: options.now });
  const directory = createDirectoryService({ store: directoryStore, syncRunner });

  const ticketStore =
    options.ticketStore ??
    (inMemory ? createMemoryTicketStore(repo) : createPrismaTicketStore());
  // Every ticket, the requester's and IT's, opens on this app's one page.
  const tickets = createTicketService({
    store: ticketStore,
    storage: files,
    now: options.now,
    notify,
    staffPage: '',
  });
  const helpdeskAdmin = createHelpdeskAdminService({ store: ticketStore });
  const reports = createReportService({ store: ticketStore, tickets, now: options.now });
  const companies = createCompanyService({
    store:
      options.companyStore ??
      (inMemory ? createMemoryCompanyStore(repo) : createPrismaCompanyStore()),
  });

  app.locals.sessionStore = store;
  app.locals.tickets = tickets;
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

  sessionRoutes(app, { config, store });

  // Sign-in: everyone lands on the helpdesk's one page.
  mount(
    '',
    publicAuthRoutes({
      config,
      repo,
      msalClient: options.msalClient,
      profileGraph: options.profileGraph,
      accounts: accountLimiter(options.authRateLimit, config),
      landing: () => '/',
    })
  );

  // The guard. Below this line every /api route has a req.user.
  app.use('/api', loadUser(repo, config), requireAuth);

  mount('', meRoutes({ config, repo, describe: describeHelpdeskMe }));

  mount('/api/tickets', ticketRoutes(tickets));
  mount('/api/helpdesk/settings', helpdeskSettingsRoutes(helpdeskAdmin));
  mount('/api/helpdesk', helpdeskRoutes({ reports, directory }));
  mount('/api/notifications', notificationRoutes(notifications));

  // Administration: the IT team and the companies, HoldingAdmin only.
  mount('/api/admin/it-team', itTeamRoutes(helpdeskAdmin));
  mount('/api/admin', adminRoutes({ companies, directory }));

  // What the mocked Graph "sent": for developers, never in production.
  if (!isProduction && !app.locals.production) mount('/api/dev', devOutboxRoutes(getGraph));

  options.protectedRoutes?.(app);

  app.use(apiNotFound);

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
