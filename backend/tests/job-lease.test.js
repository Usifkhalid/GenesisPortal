import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import { env } from '../src/config/env.js';
import { startTicketAutoClose } from '../src/jobs/closeResolvedTickets.js';
import { startSessionPruning } from '../src/jobs/prune-sessions.js';
import { startFileScanSweep } from '../src/jobs/scanFiles.js';
import { startSlaWatch } from '../src/jobs/slaWatch.js';
import { startNightlySync } from '../src/jobs/syncUsers.js';
import { startPinnedAnnouncements } from '../src/jobs/pinnedAnnouncements.js';
import { createJobLease, noLease, runLeased } from '../src/lib/job-lease.js';
import { disconnectPrisma, getPrisma } from '../src/lib/prisma.js';

/**
 * A background job runs once per round with two app instances
 * (lib/job-lease.js): first against a small stand-in for the JobLease table,
 * then against SQL Server, where the race is real.
 */

const quiet = { info() {}, warn() {}, error() {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The three Prisma calls the lease makes, over one Map, atomically. */
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    jobLease: {
      async updateMany({ where, data }) {
        const row = rows.get(where.name);
        if (!row) return { count: 0 };
        if (where.lockedUntil && !(row.lockedUntil <= where.lockedUntil.lte))
          return { count: 0 };
        if (where.holder && row.holder !== where.holder) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      async count({ where }) {
        return rows.has(where.name) ? 1 : 0;
      },
      async create({ data }) {
        if (rows.has(data.name)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        rows.set(data.name, { ...data });
        return data;
      },
    },
  };
}

/** Two "instances" over one table and one clock. */
function twoInstances() {
  const db = fakeDb();
  const clock = { at: new Date('2026-10-13T08:00:00Z') };
  const make = (holder) =>
    createJobLease({ getDb: async () => db, holder, now: () => new Date(clock.at) });
  return { db, clock, a: make('instance-a'), b: make('instance-b') };
}

describe('job lease', () => {
  test('of two instances asking at once, one runs the round', async () => {
    const { a, b, db } = twoInstances();
    const got = await Promise.all([
      a.acquire('sla-watch', 300_000),
      b.acquire('sla-watch', 300_000),
    ]);
    assert.deepEqual([...got].sort(), [false, true]);
    assert.equal(db.rows.size, 1);
  });

  test('the lease is held for the period, then anyone may take the next round', async () => {
    const { a, b, clock } = twoInstances();
    assert.equal(await a.acquire('job', 60_000), true);
    assert.equal(
      await b.acquire('job', 60_000),
      false,
      'a moment later, on the other instance'
    );

    clock.at = new Date(clock.at.getTime() + 30_000);
    assert.equal(await b.acquire('job', 60_000), false, 'half way through the period');
    assert.equal(await a.acquire('job', 60_000), false, 'not even the holder runs it twice');

    clock.at = new Date(clock.at.getTime() + 30_000);
    assert.equal(
      await b.acquire('job', 60_000),
      true,
      'the next round goes to whoever asks first'
    );
    assert.equal(await a.acquire('job', 60_000), false);
  });

  test('a holder that died does not block the job for longer than one period', async () => {
    const { a, b, clock } = twoInstances();
    assert.equal(await a.acquire('job', 60_000), true);
    // instance-a is gone; nothing is released.
    clock.at = new Date(clock.at.getTime() + 60_000);
    assert.equal(await b.acquire('job', 60_000), true);
  });

  test('different jobs do not hold each other up', async () => {
    const { a, b } = twoInstances();
    assert.equal(await a.acquire('one', 60_000), true);
    assert.equal(await b.acquire('two', 60_000), true);
  });

  test('runLeased runs the work for the holder only and records the outcome', async () => {
    const { a, b, db } = twoInstances();
    const runs = [];
    const telemetry = { jobRun: (run) => runs.push(run) };
    const work = (who) => async () => who;

    const results = await Promise.all([
      runLeased({ name: 'job', periodMs: 60_000, lease: a, telemetry }, work('a')),
      runLeased({ name: 'job', periodMs: 60_000, lease: b, telemetry }, work('b')),
    ]);
    assert.equal(results.filter((r) => r !== undefined).length, 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].name, 'job');
    assert.equal(runs[0].outcome, 'ok');
    assert.equal(db.rows.get('job').lastResult, 'ok');
  });

  test('a failed run is recorded as failed and still surfaces its error', async () => {
    const { a, db } = twoInstances();
    const runs = [];
    await assert.rejects(
      () =>
        runLeased(
          {
            name: 'job',
            periodMs: 60_000,
            lease: a,
            telemetry: { jobRun: (r) => runs.push(r) },
          },
          async () => {
            throw new Error('kaput');
          }
        ),
      /kaput/
    );
    assert.equal(runs[0].outcome, 'failed');
    assert.equal(db.rows.get('job').lastResult, 'failed');
  });

  test('when the lease cannot be read the round is skipped, not run unguarded', async () => {
    let ran = false;
    const lease = {
      acquire: async () => {
        throw new Error('database away');
      },
      finish: async () => {},
    };
    const result = await runLeased(
      { name: 'job', periodMs: 1000, lease, log: quiet },
      async () => {
        ran = true;
      }
    );
    assert.equal(result, undefined);
    assert.equal(ran, false);
  });

  test('without a database there is one process and every round is its own', async () => {
    assert.equal(await noLease.acquire('job', 1000), true);
    assert.equal(await runLeased({ name: 'job', periodMs: 1000 }, async () => 7), 7);
  });
});

describe('every job, started on two instances, works once per round', () => {
  /** Starts the same job on both instances and counts how often the work ran. */
  async function race(start) {
    const { a, b } = twoInstances();
    let calls = 0;
    const count = async () => {
      calls += 1;
      return { atRisk: 0, breached: 0, clean: 0, infected: 0, pending: 0 };
    };
    const jobs = [start(count, a), start(count, b)];
    await Promise.all(jobs.map((job) => job.ready));
    await wait(40);
    jobs.forEach((job) => job.stop());
    return calls;
  }
  // A long interval: the startup run is the round being raced for.
  const options = (lease) => ({ intervalMs: 3_600_000, lease });

  test('session pruning', async () => {
    assert.equal(
      await race((work, lease) => startSessionPruning({ prune: work }, quiet, options(lease))),
      1
    );
  });
  test('ticket auto-close', async () => {
    assert.equal(
      await race((work, lease) =>
        startTicketAutoClose({ closeResolved: work }, quiet, options(lease))
      ),
      1
    );
  });
  test('SLA watch', async () => {
    assert.equal(
      await race((work, lease) => startSlaWatch({ watchSla: work }, quiet, options(lease))),
      1
    );
  });
  test('pinned announcements', async () => {
    assert.equal(
      await race((work, lease) =>
        startPinnedAnnouncements({ notifyPinned: work }, quiet, options(lease))
      ),
      1
    );
  });
  test('file scan sweep', async () => {
    assert.equal(
      await race((work, lease) => startFileScanSweep({ sweep: work }, quiet, options(lease))),
      1
    );
  });
  test('nightly user sync', async () => {
    const { a, b } = twoInstances();
    let starts = 0;
    const runner = { start: async () => void (starts += 1) };
    // 02:10 in Cairo (UTC+3 in October 2026? the job only reads the hour it is given).
    const at = new Date('2026-10-13T23:10:00Z');
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        hour: '2-digit',
        hour12: false,
      }).format(at)
    );
    const jobs = [a, b].map((lease) =>
      startNightlySync(runner, quiet, { hour, checkMs: 3_600_000, now: () => at, lease })
    );
    await Promise.all(jobs.map((job) => job.tick()));
    jobs.forEach((job) => job.stop());
    assert.equal(starts, 1);
  });
});

async function findDatabase() {
  if (!env.hasDatabase) return { reason: 'DATABASE_URL is not configured' };
  try {
    const prisma = await getPrisma();
    await prisma.jobLease.count();
    return { prisma };
  } catch {
    await disconnectPrisma();
    return { reason: 'the database is unreachable or not migrated' };
  }
}

describe('job lease against SQL Server', async () => {
  const { prisma, reason } = await findDatabase();
  const prefix = `t-${randomUUID().slice(0, 8)}`;

  after(async () => {
    await prisma?.jobLease.deleteMany({ where: { name: { startsWith: prefix } } });
    await disconnectPrisma();
  });

  test('twelve instances race for one round: exactly one wins', { skip: reason }, async () => {
    const name = `${prefix}-race`;
    const leases = Array.from({ length: 12 }, (_, i) =>
      createJobLease({ holder: `inst-${i}` })
    );

    // The very first round (no row yet), then a later one (the row exists).
    const first = await Promise.all(leases.map((lease) => lease.acquire(name, 400)));
    assert.equal(first.filter(Boolean).length, 1, JSON.stringify(first));

    await wait(450);
    const second = await Promise.all(leases.map((lease) => lease.acquire(name, 60_000)));
    assert.equal(second.filter(Boolean).length, 1, JSON.stringify(second));

    const row = await prisma.jobLease.findUnique({ where: { name } });
    assert.equal(row.holder, `inst-${second.indexOf(true)}`);
  });

  test('the outcome is written by the holder and nobody else', { skip: reason }, async () => {
    const name = `${prefix}-finish`;
    const mine = createJobLease({ holder: 'mine' });
    const other = createJobLease({ holder: 'other' });
    assert.equal(await mine.acquire(name, 60_000), true);
    await other.finish(name, 'failed');
    assert.equal((await prisma.jobLease.findUnique({ where: { name } })).lastResult, null);
    await mine.finish(name, 'ok');
    const row = await prisma.jobLease.findUnique({ where: { name } });
    assert.equal(row.lastResult, 'ok');
    assert.ok(row.lastFinishedAt);
  });
});
