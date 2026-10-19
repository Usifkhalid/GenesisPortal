/**
 * server.js — the process entry point. `npm run dev` runs this under
 * node --watch.
 *
 * Migrations are never run from here: they are a separate deploy step with
 * its own database login (docs/DEPLOY.md), and this process's login cannot
 * change the schema.
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import { createJobLease, noLease } from './lib/job-lease.js';
import { logger } from './lib/logger.js';
import { startTicketAutoClose } from './jobs/closeResolvedTickets.js';
import { startPinnedAnnouncements } from './jobs/pinnedAnnouncements.js';
import { startSessionPruning } from './jobs/prune-sessions.js';
import { startFileScanSweep } from './jobs/scanFiles.js';
import { startSlaWatch } from './jobs/slaWatch.js';
import { startNightlySync } from './jobs/syncUsers.js';
import { disconnectPrisma, warmPrisma } from './lib/prisma.js';
import { createTelemetry } from './lib/telemetry.js';

// Application Insights, when configured; otherwise an object that does nothing.
const telemetry = await createTelemetry(env);

const app = createApp({ telemetry });

// The port opens only once the database has answered, so "listening" (and the
// health check that deploys and the e2e runner wait on) means ready to serve.
if (!app.locals.inMemory) await warmPrisma(logger);

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      auth: env.AUTH_MODE,
      graph: env.GRAPH_MODE,
      directory: env.GRAPH_DIRECTORY_MODE,
      data: env.PORTAL_DATA,
      storage: env.STORAGE_DRIVER,
      scan: env.SCAN_MODE,
      telemetry: telemetry.enabled,
    },
    `MG Holding Portal listening on http://localhost:${env.PORT}`
  );
  if (app.locals.inMemory) {
    logger.warn(
      'DATABASE_URL is missing or still a placeholder: users come from prisma/seed-data.js and sessions are held in memory. Both are lost on restart.'
    );
  }
});

// With two app instances every job below still has its timer on both, and a
// row per job in JobLease decides which one works each round (lib/job-lease.js).
const jobOptions = { lease: app.locals.inMemory ? noLease : createJobLease(), telemetry };

const jobs = [
  // Expired sessions: removed now, then hourly (jobs/prune-sessions.js).
  startSessionPruning(app.locals.sessionStore, logger, jobOptions),
  // Directory sync at 02:00 Cairo time (jobs/syncUsers.js).
  startNightlySync(app.locals.syncRunner, logger, jobOptions),
  // Resolved tickets close after three working days (jobs/closeResolvedTickets.js).
  startTicketAutoClose(app.locals.tickets, logger, jobOptions),
  // Alerts at 75% and 100% of a ticket's SLA, every five minutes (jobs/slaWatch.js).
  startSlaWatch(app.locals.tickets, logger, jobOptions),
  // Scheduled pinned announcements are announced when they go live.
  startPinnedAnnouncements(app.locals.announcements, logger, jobOptions),
  // Uploads still waiting for a malware-scan verdict, every minute (jobs/scanFiles.js).
  startFileScanSweep(app.locals.files, logger, jobOptions),
];

/**
 * Graceful shutdown. App Service sends SIGTERM before it stops or swaps an
 * instance: say "not ready" so no new traffic is routed here, stop the
 * timers, let requests in flight finish, then close the pool and leave. If
 * they have not finished within SHUTDOWN_GRACE_MS the process leaves anyway.
 */
let stopping = false;
async function shutdown(signal, code = 0) {
  if (stopping) return;
  stopping = true;
  app.locals.stopping = true;
  logger.info({ signal }, 'shutting down');

  const forced = setTimeout(() => {
    logger.warn('shutdown grace period over: closing open connections');
    server.closeAllConnections();
  }, env.SHUTDOWN_GRACE_MS);
  forced.unref();

  for (const job of jobs) job.stop();
  await new Promise((resolve) => {
    server.close(resolve);
    // Keep-alive connections with no request in flight would hold close() open.
    server.closeIdleConnections();
  });
  clearTimeout(forced);

  await telemetry.flush();
  await disconnectPrisma().catch((err) => logger.warn({ err }, 'database pool did not close'));
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}

// Log and exit: after an unknown failure the process state cannot be trusted,
// and App Service restarts it.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    logger.fatal({ err }, event);
    telemetry.error(err, { event });
    telemetry.flush().finally(() => process.exit(1));
  });
}
