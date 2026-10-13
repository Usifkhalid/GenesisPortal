/**
 * scanFiles.js — settles uploads that are still waiting for their malware-scan
 * verdict, at startup and then every minute. With Microsoft Defender for
 * Storage the verdict arrives on the blob a little after the upload; this is
 * what picks it up for files nobody has asked for yet, deletes an infected
 * one and tells its uploader and the IT leads. The rule is lib/file-scan.js's
 * `sweep`; this is only the timer. With the mock scanner there is never
 * anything pending.
 */

import { runLeased } from '../lib/job-lease.js';

export const SCAN_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * @param {{ sweep?: () => Promise<{ clean: number, infected: number, pending: number }> }} files
 *   the scanned storage
 * @param {{ info: Function, warn: Function }} log
 * @param {{ intervalMs?: number, lease?: object, telemetry?: object }} [options]
 * @returns {{ ready: Promise<void>, stop: () => void }}
 */
export function startFileScanSweep(
  files,
  log,
  { intervalMs = SCAN_SWEEP_INTERVAL_MS, lease, telemetry } = {}
) {
  if (typeof files?.sweep !== 'function') return { ready: Promise.resolve(), stop() {} };

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const done = await runLeased(
        { name: 'file-scan-sweep', periodMs: intervalMs, lease, telemetry, log },
        () => files.sweep()
      );
      if (done && done.clean + done.infected > 0) log.info(done, 'file scans settled');
    } catch (err) {
      log.warn({ err }, 'file scan sweep failed');
    } finally {
      running = false;
    }
  };

  const ready = run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { ready, stop: () => clearInterval(timer) };
}
