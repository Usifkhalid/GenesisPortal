/**
 * server.js — the process entry point. `npm run dev` runs this under
 * node --watch.
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startTicketAutoClose } from './jobs/closeResolvedTickets.js';
import { startPinnedAnnouncements } from './jobs/pinnedAnnouncements.js';
import { startSessionPruning } from './jobs/prune-sessions.js';
import { startSlaWatch } from './jobs/slaWatch.js';
import { startNightlySync } from './jobs/syncUsers.js';
import { disconnectPrisma, warmPrisma } from './lib/prisma.js';

const app = createApp();

// The port opens only once the database has answered, so "listening" (and the
// health check that deploys and the e2e runner wait on) means ready to serve.
if (!app.locals.inMemory) await warmPrisma(logger);

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, auth: env.AUTH_MODE, graph: env.GRAPH_MODE },
    `MG Holding Portal listening on http://localhost:${env.PORT}`
  );
  if (app.locals.inMemory) {
    logger.warn(
      'DATABASE_URL is missing or still a placeholder: users come from prisma/seed-data.js and sessions are held in memory. Both are lost on restart.'
    );
  }
});

// Expired sessions: removed now, then hourly (jobs/prune-sessions.js).
const pruning = startSessionPruning(app.locals.sessionStore, logger);

// Directory sync at 02:00 Cairo time (jobs/syncUsers.js).
const nightlySync = startNightlySync(app.locals.syncRunner, logger);

// Resolved tickets close after three working days (jobs/closeResolvedTickets.js).
const autoClose = startTicketAutoClose(app.locals.tickets, logger);

// Alerts at 75% and 100% of a ticket's SLA, every five minutes (jobs/slaWatch.js).
const slaWatch = startSlaWatch(app.locals.tickets, logger);

// Scheduled pinned announcements are announced when they go live.
const pinned = startPinnedAnnouncements(app.locals.announcements, logger);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      pruning.stop();
      nightlySync.stop();
      autoClose.stop();
      slaWatch.stop();
      pinned.stop();
      await disconnectPrisma();
      process.exit(0);
    });
  });
}

// Log and exit: after an unknown failure the process state cannot be trusted,
// and App Service restarts it.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    logger.fatal({ err }, event);
    process.exit(1);
  });
}
