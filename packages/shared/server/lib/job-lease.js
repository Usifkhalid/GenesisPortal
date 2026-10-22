/**
 * job-lease.js — a background job runs once per round, however many copies of
 * the app are running.
 *
 * Every instance keeps its own timers (jobs/*.js). Before a job's work
 * starts, the instance tries to take the job's row in JobLease by moving
 * `lockedUntil` forward, in one UPDATE that only succeeds while the old value
 * has passed. SQL Server lets exactly one of two simultaneous UPDATEs match;
 * the other instance sees zero rows changed and skips the round.
 *
 * The lease is not given back when the work ends: it is held for (almost) the
 * job's whole period, so the second instance's timer, firing a moment later,
 * does not run the same job again. If the holder dies mid-run, the next round
 * is simply taken by whoever asks first.
 *
 *   const lease = createJobLease();
 *   if (await lease.acquire('sla-watch', 5 * 60_000)) { …work… }
 *
 * Without a database (tests, development in memory) there is one process and
 * `noLease` always says yes.
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { getPrisma } from './prisma.js';

/**
 * Taken off the period, so a holder whose own next timer fires a little
 * early (timers drift, clocks differ slightly between machines) is not shut
 * out by its own lease.
 */
const SLACK = 0.1;

/** This process, in the lease row and the log. */
export const INSTANCE =
  `${process.env.WEBSITE_INSTANCE_ID?.slice(0, 12) ?? hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`.slice(
    0,
    100
  );

/**
 * @param {object} [options]
 * @param {() => Promise<object>} [options.getDb]
 * @param {string} [options.holder]
 * @param {() => Date} [options.now]
 */
export function createJobLease({
  getDb = getPrisma,
  holder = INSTANCE,
  now = () => new Date(),
} = {}) {
  return {
    holder,

    /**
     * True when this instance may run `name` now; nobody else can for the
     * next `periodMs` (less the slack).
     */
    async acquire(name, periodMs) {
      const db = await getDb();
      const at = now();
      const data = {
        lockedUntil: new Date(at.getTime() + Math.round(periodMs * (1 - SLACK))),
        holder,
        lastStartedAt: at,
      };

      const taken = await db.jobLease.updateMany({
        where: { name, lockedUntil: { lte: at } },
        data,
      });
      if (taken.count === 1) return true;

      // No row yet: the first run ever. Of two instances creating it at once,
      // the primary key lets one through.
      if ((await db.jobLease.count({ where: { name } })) > 0) return false;
      try {
        await db.jobLease.create({ data: { name, ...data } });
        return true;
      } catch (err) {
        if (err?.code === 'P2002') return false;
        throw err;
      }
    },

    /** Notes how the run ended. Only the holder's note is kept. */
    async finish(name, result) {
      const db = await getDb();
      await db.jobLease.updateMany({
        where: { name, holder },
        data: { lastFinishedAt: now(), lastResult: result },
      });
    },
  };
}

/** One process, no database: every round is ours. */
export const noLease = Object.freeze({
  holder: 'single',
  acquire: async () => true,
  finish: async () => {},
});

/**
 * Wraps a job's work: take the lease, run, note the outcome, report the run.
 * Returns what the work returned, or `undefined` when the round was skipped
 * (another instance has it) — a job's own "nothing to do" is never undefined.
 *
 * @param {object} deps
 * @param {string} deps.name
 * @param {number} deps.periodMs
 * @param {{ acquire: Function, finish: Function }} [deps.lease]
 * @param {{ jobRun: Function }} [deps.telemetry]
 * @param {{ warn: Function }} [deps.log]
 * @param {() => Promise<unknown>} work
 */
export async function runLeased({ name, periodMs, lease = noLease, telemetry, log }, work) {
  let mine;
  try {
    mine = await lease.acquire(name, periodMs);
  } catch (err) {
    // The database is away: skip the round rather than run unguarded.
    log?.warn({ err, job: name }, 'job lease could not be taken');
    return undefined;
  }
  if (!mine) return undefined;

  const started = Date.now();
  let outcome = 'ok';
  try {
    return await work();
  } catch (err) {
    outcome = 'failed';
    throw err;
  } finally {
    telemetry?.jobRun({ name, outcome, durationMs: Date.now() - started });
    await lease.finish(name, outcome).catch(() => {});
  }
}
