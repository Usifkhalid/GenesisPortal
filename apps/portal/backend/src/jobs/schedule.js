/**
 * schedule.js — which timed jobs the portal's process starts (server.js).
 *
 * PORTAL_HELPDESK_JOBS=off leaves out the portal's helpdesk jobs, the SLA
 * watch and the confirmation reminders: once the tickets have moved to the IT
 * Helpdesk app (D145) that app runs them on its own copy, and two copies of a
 * job on two databases would tell everyone twice. The rest always run.
 */

import { startPinnedAnnouncements } from './pinnedAnnouncements.js';
import { startSessionPruning } from '@mg/shared/server/jobs/prune-sessions.js';
import { startConfirmationReminders } from '@mg/shared/server/jobs/remindResolvedTickets.js';
import { startFileScanSweep } from '@mg/shared/server/jobs/scanFiles.js';
import { startSlaWatch } from '@mg/shared/server/jobs/slaWatch.js';
import { startNightlySync } from '@mg/shared/server/jobs/syncUsers.js';

const STARTERS = {
  startSessionPruning,
  startNightlySync,
  startConfirmationReminders,
  startSlaWatch,
  startPinnedAnnouncements,
  startFileScanSweep,
};

/**
 * @param {object} options
 * @param {import('express').Express} options.app  createApp()'s, for its services
 * @param {{ PORTAL_HELPDESK_JOBS: 'on' | 'off' }} options.env
 * @param {{ info: Function, warn: Function }} options.log
 * @param {object} options.jobOptions  lease and telemetry (lib/serve.js)
 * @param {Partial<typeof STARTERS>} [options.starters]  stand-ins, for tests
 * @returns {{ stop: () => void }[]}
 */
export function startPortalJobs({ app, env, log, jobOptions, starters = {} }) {
  const start = { ...STARTERS, ...starters };
  const helpdesk = env.PORTAL_HELPDESK_JOBS !== 'off';
  if (!helpdesk) {
    log.info(
      'PORTAL_HELPDESK_JOBS=off: no SLA alerts or confirmation reminders from the portal'
    );
  }
  return [
    // Expired sessions: removed now, then hourly (jobs/prune-sessions.js).
    start.startSessionPruning(app.locals.sessionStore, log, jobOptions),
    // Directory sync at 02:00 Cairo time (jobs/syncUsers.js).
    start.startNightlySync(app.locals.syncRunner, log, jobOptions),
    // Resolved tickets remind their requester every 24 hours; nothing closes
    // them (jobs/remindResolvedTickets.js, D143).
    helpdesk && start.startConfirmationReminders(app.locals.tickets, log, jobOptions),
    // Alerts at 75% and 100% of a ticket's SLA, every five minutes (jobs/slaWatch.js).
    helpdesk && start.startSlaWatch(app.locals.tickets, log, jobOptions),
    // Scheduled pinned announcements are announced when they go live.
    start.startPinnedAnnouncements(app.locals.announcements, log, jobOptions),
    // Uploads still waiting for a malware-scan verdict, every minute (jobs/scanFiles.js).
    start.startFileScanSweep(app.locals.files, log, jobOptions),
  ].filter(Boolean);
}
