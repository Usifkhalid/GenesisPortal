/**
 * prune-sessions.js — deletes expired rows from the Session table, once at
 * startup and then every hour. Nothing reads an expired session; this only
 * keeps the table small.
 */

import { runLeased } from '../lib/job-lease.js';

export const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * @param {{ prune?: () => Promise<number> }} store a store without prune (the
 *   in-memory one) is left alone
 * @param {{ info: Function, warn: Function }} log
 * @param {{ intervalMs?: number, lease?: object, telemetry?: object }} [options]  `lease`
 *   (lib/job-lease.js) makes the job run on one app instance per round
 * @returns {{ ready: Promise<void>, stop: () => void }} `ready` settles when the
 *   startup run has finished; it never rejects
 */
export function startSessionPruning(
  store,
  log,
  { intervalMs = PRUNE_INTERVAL_MS, lease, telemetry } = {}
) {
  if (typeof store?.prune !== 'function') return { ready: Promise.resolve(), stop() {} };

  const run = () =>
    runLeased({ name: 'prune-sessions', periodMs: intervalMs, lease, telemetry, log }, () =>
      store.prune()
    ).then(
      (count) => {
        if (count > 0) log.info({ count }, 'expired sessions removed');
      },
      (err) => log.warn({ err }, 'session prune failed')
    );

  const ready = run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { ready, stop: () => clearInterval(timer) };
}
