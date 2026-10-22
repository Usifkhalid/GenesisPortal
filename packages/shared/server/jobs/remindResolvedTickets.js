/**
 * remindResolvedTickets.js — reminds the requester of every ticket IT has
 * marked Resolved and that still waits for their answer ("Is your problem
 * solved?"), once at startup and then every hour. A ticket is reminded once
 * for each 24 hours it has waited; the rule, the dedupe and the words are the
 * ticket service's (`remindResolved`). Nothing here closes a ticket: the
 * auto-close rule is gone (D143).
 */

import { runLeased } from '../lib/job-lease.js';

export const REMINDER_INTERVAL_MS = 60 * 60 * 1000;

/**
 * @param {{ remindResolved: () => Promise<number> }} tickets  the ticket service
 * @param {{ info: Function, warn: Function }} log
 * @param {{ intervalMs?: number, lease?: object, telemetry?: object }} [options]  `lease`
 *   (lib/job-lease.js) makes the job run on one app instance per round
 * @returns {{ ready: Promise<void>, stop: () => void }} `ready` settles when the
 *   startup run has finished; it never rejects
 */
export function startConfirmationReminders(
  tickets,
  log,
  { intervalMs = REMINDER_INTERVAL_MS, lease, telemetry } = {}
) {
  if (typeof tickets?.remindResolved !== 'function') {
    return { ready: Promise.resolve(), stop() {} };
  }

  const run = () =>
    runLeased(
      { name: 'ticket-confirmation-reminders', periodMs: intervalMs, lease, telemetry, log },
      () => tickets.remindResolved()
    ).then(
      (count) => {
        if (count > 0) log.info({ count }, 'resolved tickets reminded');
      },
      (err) => log.warn({ err }, 'ticket confirmation reminders failed')
    );

  const ready = run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { ready, stop: () => clearInterval(timer) };
}
