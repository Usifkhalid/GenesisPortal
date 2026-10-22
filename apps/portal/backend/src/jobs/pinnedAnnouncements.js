/**
 * pinnedAnnouncements.js — a pinned announcement that was scheduled goes live
 * on its date with nobody clicking anything, so something has to tell people.
 * Once at startup and then every five minutes this asks the announcement
 * service (`notifyPinned`) to announce pinned posts that have just gone live.
 * A post already announced (at publish, or by an earlier run) tells nobody
 * twice: the notification carries a key per announcement.
 */

import { runLeased } from '@mg/shared/server/lib/job-lease.js';

export const PINNED_INTERVAL_MS = 5 * 60 * 1000;

/**
 * @param {{ notifyPinned: () => Promise<number> }} announcements  the service
 * @param {{ info: Function, warn: Function }} log
 * @param {{ intervalMs?: number, lease?: object, telemetry?: object }} [options]  `lease`
 *   (lib/job-lease.js) makes the job run on one app instance per round
 * @returns {{ ready: Promise<void>, stop: () => void }}
 */
export function startPinnedAnnouncements(
  announcements,
  log,
  { intervalMs = PINNED_INTERVAL_MS, lease, telemetry } = {}
) {
  if (typeof announcements?.notifyPinned !== 'function') {
    return { ready: Promise.resolve(), stop() {} };
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const told = await runLeased(
        { name: 'pinned-announcements', periodMs: intervalMs, lease, telemetry, log },
        () => announcements.notifyPinned()
      );
      if (told > 0) log.info({ told }, 'pinned announcement notifications sent');
    } catch (err) {
      log.warn({ err }, 'pinned announcement sweep failed');
    } finally {
      running = false;
    }
  };

  const ready = run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { ready, stop: () => clearInterval(timer) };
}
