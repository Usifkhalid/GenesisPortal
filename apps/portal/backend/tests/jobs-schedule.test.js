/**
 * Which jobs the portal starts (src/jobs/schedule.js): PORTAL_HELPDESK_JOBS=off
 * leaves out the SLA watch and the confirmation reminders, once the tickets
 * live in the IT Helpdesk app (D145), and nothing else.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { loadEnv } from '../src/config/env.js';
import { startPortalJobs } from '../src/jobs/schedule.js';

function run(PORTAL_HELPDESK_JOBS) {
  const started = [];
  const stand = (name) => () => {
    started.push(name);
    return { stop() {} };
  };
  const names = [
    'startSessionPruning',
    'startNightlySync',
    'startConfirmationReminders',
    'startSlaWatch',
    'startPinnedAnnouncements',
    'startFileScanSweep',
  ];
  const logged = [];
  const jobs = startPortalJobs({
    app: { locals: {} },
    env: loadEnv({ PORTAL_HELPDESK_JOBS }),
    log: { info: (m) => logged.push(m), warn() {} },
    jobOptions: {},
    starters: Object.fromEntries(names.map((n) => [n, stand(n)])),
  });
  return { started, jobs, logged };
}

describe('the portal’s timed jobs (D145)', () => {
  test('by default every job starts, the helpdesk’s included', () => {
    const { started, jobs } = run(undefined);
    assert.equal(jobs.length, 6);
    assert.ok(started.includes('startSlaWatch'));
    assert.ok(started.includes('startConfirmationReminders'));
  });

  test('PORTAL_HELPDESK_JOBS=off: no SLA alerts and no reminders, the rest as before', () => {
    const { started, jobs, logged } = run('off');
    assert.deepEqual(started, [
      'startSessionPruning',
      'startNightlySync',
      'startPinnedAnnouncements',
      'startFileScanSweep',
    ]);
    assert.equal(jobs.length, 4);
    assert.match(logged.join('\n'), /PORTAL_HELPDESK_JOBS=off/);
  });

  test('only on or off', () => {
    assert.throws(() => loadEnv({ PORTAL_HELPDESK_JOBS: 'no' }), /PORTAL_HELPDESK_JOBS/);
  });
});
