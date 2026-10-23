/**
 * Which jobs the portal starts (src/jobs/schedule.js), and what it says about
 * its link to the IT Helpdesk (src/config/startup-notes.js, D146). The portal
 * runs no helpdesk job: the SLA watch and the reminders are the helpdesk app's.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { loadEnv } from '../src/config/env.js';
import { logHelpdeskLinkNotes } from '../src/config/startup-notes.js';
import { startPortalJobs } from '../src/jobs/schedule.js';

describe('the portal’s timed jobs (D146)', () => {
  test('four jobs start, none of them the helpdesk’s', () => {
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
    const jobs = startPortalJobs({
      app: { locals: {} },
      log: { info() {}, warn() {} },
      jobOptions: {},
      starters: Object.fromEntries(names.map((n) => [n, stand(n)])),
    });
    assert.equal(jobs.length, 4);
    assert.deepEqual(started, [
      'startSessionPruning',
      'startNightlySync',
      'startPinnedAnnouncements',
      'startFileScanSweep',
    ]);
  });
});

describe('HELPDESK_URL', () => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'sqlserver://db.example.com:1433;database=mgportal_live;user=u;password=p',
    SESSION_SECRET: 'a'.repeat(40),
    APP_BASE_URL: 'https://portal.example.com',
    AUTH_MODE: 'entra',
    GRAPH_MODE: 'real',
    GRAPH_DIRECTORY_MODE: 'real',
    PORTAL_DATA: 'live',
    STORAGE_DRIVER: 'azure',
    AZURE_STORAGE_ACCOUNT_URL: 'https://acct.blob.core.windows.net',
    SCAN_MODE: 'defender',
    ENTRA_TENANT_ID: 'tenant',
    ENTRA_CLIENT_ID: 'client',
    ENTRA_CLIENT_SECRET: 'secret',
    NOREPLY_MAILBOX: 'noreply@portal.example.com',
  };

  test('is optional, and must be an address', () => {
    assert.equal(loadEnv({}).HELPDESK_URL, undefined);
    assert.equal(
      loadEnv({ HELPDESK_URL: 'http://localhost:3001' }).HELPDESK_URL,
      'http://localhost:3001'
    );
    assert.throws(() => loadEnv({ HELPDESK_URL: 'helpdesk' }), /HELPDESK_URL/);
  });

  test('production wants https', () => {
    assert.throws(
      () => loadEnv({ ...production, HELPDESK_URL: 'http://helpdesk.example.com' }),
      /HELPDESK_URL: must be an https/
    );
    assert.equal(
      loadEnv({ ...production, HELPDESK_URL: 'https://helpdesk.example.com' }).HELPDESK_URL,
      'https://helpdesk.example.com'
    );
  });

  test('a missing one is warned about at boot; a leftover PORTAL_HELPDESK_JOBS is noted', () => {
    const lines = [];
    const log = { info: (m) => lines.push(`info ${m}`), warn: (m) => lines.push(`warn ${m}`) };
    logHelpdeskLinkNotes({ env: {}, source: { PORTAL_HELPDESK_JOBS: 'off' }, log });
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^info PORTAL_HELPDESK_JOBS is ignored/);
    assert.match(lines[1], /^warn HELPDESK_URL is not set/);

    lines.length = 0;
    logHelpdeskLinkNotes({ env: { HELPDESK_URL: 'https://h.example.com' }, source: {}, log });
    assert.deepEqual(lines, []);
  });
});
