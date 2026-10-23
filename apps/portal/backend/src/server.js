/**
 * server.js — the portal's process entry point. `npm run dev` runs this under
 * node --watch. Start-up, the jobs' leases and graceful shutdown are shared
 * with the IT Helpdesk (packages/shared/server/lib/serve.js).
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logHelpdeskLinkNotes } from './config/startup-notes.js';
import { startPortalJobs } from './jobs/schedule.js';
import { logger } from '@mg/shared/server/lib/logger.js';
import { serve } from '@mg/shared/server/lib/serve.js';
import { createTelemetry } from '@mg/shared/server/lib/telemetry.js';

// Application Insights, when configured; otherwise an object that does nothing.
const telemetry = await createTelemetry(env);

logHelpdeskLinkNotes({ env, source: process.env, log: logger });

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
  jobs: (jobOptions) => startPortalJobs({ app, log: logger, jobOptions }),
});
