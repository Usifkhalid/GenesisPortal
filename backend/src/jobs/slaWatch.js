/**
 * slaWatch.js — tells people when a ticket's clock is running out: once at
 * startup and then every five minutes. The assignee and the team's leads hear
 * once when 75% of the target is used and once when all of it is. The rule,
 * the recipients and the "once" (a dedupe key per ticket, target and
 * threshold) are the ticket service's `watchSla`; this is only the timer.
 *
 * Five minutes is the finest an alert is late by. A run that finds nothing new
 * costs one indexed query (Ticket's team/status/slaActive/nextDueAt index).
 */

import { runLeased } from '../lib/job-lease.js';

export const SLA_WATCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * @param {{ watchSla: () => Promise<{ atRisk: number, breached: number }> }} tickets
 *   the ticket service
 * @param {{ info: Function, warn: Function }} log
 * @param {{ intervalMs?: number, lease?: object, telemetry?: object }} [options]  `lease`
 *   (lib/job-lease.js) makes the job run on one app instance per round
 * @returns {{ ready: Promise<void>, stop: () => void }} `ready` settles when the
 *   startup run has finished; it never rejects
 */
export function startSlaWatch(
  tickets,
  log,
  { intervalMs = SLA_WATCH_INTERVAL_MS, lease, telemetry } = {}
) {
  if (typeof tickets?.watchSla !== 'function') {
    return { ready: Promise.resolve(), stop() {} };
  }

  let running = false;
  const run = async () => {
    // A slow run is not started again on top of itself.
    if (running) return;
    running = true;
    try {
      const sent = await runLeased(
        { name: 'sla-watch', periodMs: intervalMs, lease, telemetry, log },
        () => tickets.watchSla()
      );
      if (sent && sent.atRisk + sent.breached > 0) {
        log.info({ atRisk: sent.atRisk, breached: sent.breached }, 'SLA alerts sent');
      }
    } catch (err) {
      log.warn({ err }, 'SLA watch failed');
    } finally {
      running = false;
    }
  };

  const ready = run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { ready, stop: () => clearInterval(timer) };
}
