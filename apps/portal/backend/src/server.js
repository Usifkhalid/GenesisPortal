/**
 * server.js — the portal's process entry point. `npm run dev` runs this under
 * node --watch. Start-up, the jobs' leases and graceful shutdown are shared
 * with the IT Helpdesk (packages/shared/server/lib/serve.js).
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import { startPinnedAnnouncements } from './jobs/pinnedAnnouncements.js';
import { startSessionPruning } from '@mg/shared/server/jobs/prune-sessions.js';
import { startConfirmationReminders } from '@mg/shared/server/jobs/remindResolvedTickets.js';
import { startFileScanSweep } from '@mg/shared/server/jobs/scanFiles.js';
import { startSlaWatch } from '@mg/shared/server/jobs/slaWatch.js';
import { startNightlySync } from '@mg/shared/server/jobs/syncUsers.js';
import { logger } from '@mg/shared/server/lib/logger.js';
import { serve } from '@mg/shared/server/lib/serve.js';
import { createTelemetry } from '@mg/shared/server/lib/telemetry.js';

// Application Insights, when configured; otherwise an object that does nothing.
const telemetry = await createTelemetry(env);

const app = createApp({ telemetry });

await serve({
  app,
  env,
  telemetry,
  title: 'MG Holding Portal',
  facts: {
    auth: env.AUTH_MODE,
    graph: env.GRAPH_MODE,
    directory: env.GRAPH_DIRECTORY_MODE,
    data: env.PORTAL_DATA,
    storage: env.STORAGE_DRIVER,
    scan: env.SCAN_MODE,
  },
  jobs: (jobOptions) => [
    // Expired sessions: removed now, then hourly (jobs/prune-sessions.js).
    startSessionPruning(app.locals.sessionStore, logger, jobOptions),
    // Directory sync at 02:00 Cairo time (jobs/syncUsers.js).
    startNightlySync(app.locals.syncRunner, logger, jobOptions),
    // Resolved tickets remind their requester every 24 hours; nothing closes
    // them (jobs/remindResolvedTickets.js, D143).
    startConfirmationReminders(app.locals.tickets, logger, jobOptions),
    // Alerts at 75% and 100% of a ticket's SLA, every five minutes (jobs/slaWatch.js).
    startSlaWatch(app.locals.tickets, logger, jobOptions),
    // Scheduled pinned announcements are announced when they go live.
    startPinnedAnnouncements(app.locals.announcements, logger, jobOptions),
    // Uploads still waiting for a malware-scan verdict, every minute (jobs/scanFiles.js).
    startFileScanSweep(app.locals.files, logger, jobOptions),
  ],
});
