/**
 * schedule.js — which timed jobs the portal's process starts (server.js).
 *
 * The portal runs no helpdesk jobs: the SLA watch and the confirmation
 * reminders belong to the IT Helpdesk app (D146).
 */

import { startPinnedAnnouncements } from './pinnedAnnouncements.js';
import { startSessionPruning } from '@mg/shared/server/jobs/prune-sessions.js';
import { startFileScanSweep } from '@mg/shared/server/jobs/scanFiles.js';
import { startNightlySync } from '@mg/shared/server/jobs/syncUsers.js';

const STARTERS = {
  startSessionPruning,
  startNightlySync,
  startPinnedAnnouncements,
  startFileScanSweep,
};

/**
 * @param {object} options
 * @param {import('express').Express} options.app  createApp()'s, for its services
 * @param {{ info: Function, warn: Function }} options.log
 * @param {object} options.jobOptions  lease and telemetry (lib/serve.js)
 * @param {Partial<typeof STARTERS>} [options.starters]  stand-ins, for tests
 * @returns {{ stop: () => void }[]}
 */
export function startPortalJobs({ app, log, jobOptions, starters = {} }) {
  const start = { ...STARTERS, ...starters };
  return [
    // Expired sessions: removed now, then hourly (jobs/prune-sessions.js).
    start.startSessionPruning(app.locals.sessionStore, log, jobOptions),
    // Directory sync at 02:00 Cairo time (jobs/syncUsers.js).
    start.startNightlySync(app.locals.syncRunner, log, jobOptions),
    // Scheduled pinned announcements are announced when they go live.
    start.startPinnedAnnouncements(app.locals.announcements, log, jobOptions),
    // Uploads still waiting for a malware-scan verdict, every minute (jobs/scanFiles.js).
    start.startFileScanSweep(app.locals.files, log, jobOptions),
  ].filter(Boolean);
}
