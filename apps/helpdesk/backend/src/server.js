/**
 * server.js — the IT Helpdesk's process entry point (port 3001 by default).
 * `npm run dev` runs this under node --watch. Start-up, the jobs' leases and
 * graceful shutdown are the portal's (packages/shared/server/lib/serve.js).
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
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
  title: 'MG Holding IT Helpdesk',
  facts: {
    auth: env.AUTH_MODE,
    mail: env.GRAPH_MAIL_MODE,
    directory: env.GRAPH_DIRECTORY_MODE,
    data: env.HELPDESK_DATA,
    storage: env.STORAGE_DRIVER,
    scan: env.SCAN_MODE,
  },
  jobs: (jobOptions) => [
    // Expired sessions: removed now, then hourly.
    startSessionPruning(app.locals.sessionStore, logger, jobOptions),
    // The helpdesk's own copy of the people, from Microsoft 365 at 02:00 Cairo time.
    startNightlySync(app.locals.syncRunner, logger, jobOptions),
    // Resolved tickets remind their requester every 24 hours; nothing closes them (D143).
    startConfirmationReminders(app.locals.tickets, logger, jobOptions),
    // Alerts at 75% and 100% of a ticket's SLA, every five minutes.
    startSlaWatch(app.locals.tickets, logger, jobOptions),
    // Attachments still waiting for a malware-scan verdict, every minute.
    startFileScanSweep(app.locals.files, logger, jobOptions),
  ],
});
