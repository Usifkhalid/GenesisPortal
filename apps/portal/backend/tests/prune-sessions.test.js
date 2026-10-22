import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { startSessionPruning } from '@mg/shared/server/jobs/prune-sessions.js';

const quiet = { info() {}, warn() {} };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('session pruning job', () => {
  test('prunes at startup, then on every interval, until stopped', async () => {
    let calls = 0;
    const store = { prune: async () => ++calls };

    const job = startSessionPruning(store, quiet, { intervalMs: 20 });
    await job.ready;
    assert.equal(calls, 1, 'one run before the first interval');

    await wait(110);
    job.stop();
    assert.ok(calls >= 3, `expected repeated runs, got ${calls}`);

    const after = calls;
    await wait(60);
    assert.equal(calls, after, 'no runs after stop');
  });

  test('a failing prune is logged and the schedule carries on', async () => {
    const warnings = [];
    let calls = 0;
    const store = {
      prune: async () => {
        calls += 1;
        throw new Error('database down');
      },
    };

    const job = startSessionPruning(
      store,
      { info() {}, warn: (...a) => warnings.push(a) },
      { intervalMs: 20 }
    );
    await job.ready;
    await wait(70);
    job.stop();

    assert.ok(calls >= 2);
    assert.equal(warnings.length, calls);
  });

  test('a store without prune (in memory) is left alone', async () => {
    const job = startSessionPruning({}, quiet, { intervalMs: 10 });
    await job.ready;
    job.stop();
  });

  test('removes expired sessions from a store and keeps live ones', async () => {
    const { PrismaSessionStore } = await import('@mg/shared/server/lib/session.js');
    const rows = [
      { sid: 'old', expiresAt: new Date(Date.now() - 1000) },
      { sid: 'live', expiresAt: new Date(Date.now() + 60_000) },
    ];
    const db = {
      session: {
        deleteMany: async ({ where }) => {
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].expiresAt < where.expiresAt.lt) rows.splice(i, 1);
          }
          return { count: before - rows.length };
        },
      },
    };
    const job = startSessionPruning(new PrismaSessionStore({ getDb: async () => db }), quiet, {
      intervalMs: 60_000,
    });
    await job.ready;
    job.stop();
    assert.deepEqual(
      rows.map((r) => r.sid),
      ['live']
    );
  });
});
