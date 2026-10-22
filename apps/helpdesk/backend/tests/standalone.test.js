/**
 * The helpdesk runs on its own, with the portal switched off (D145): nothing
 * the server loads reaches the portal's code or its database, and a whole
 * day's work (sign-in, a ticket raised, worked, resolved and rated, the
 * notifications, the SLA watch, the reminders and the scan sweep) opens no
 * connection to the portal's address and makes no HTTP call at all.
 * `npm run migrate:from-portal` is the one exception, and the server never
 * loads it.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, relative, resolve, sep } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import request from 'supertest';

import { createApp } from '../src/app.js';
import { startConfirmationReminders } from '@mg/shared/server/jobs/remindResolvedTickets.js';
import { startFileScanSweep } from '@mg/shared/server/jobs/scanFiles.js';
import { startSlaWatch } from '@mg/shared/server/jobs/slaWatch.js';
import { DEV, createTicketWorld } from '@mg/shared/server/testing/ticket-world.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));
const SHARED = resolve(REPO, 'packages/shared');

const IMPORTS =
  /(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;])import\s+['"]([^'"]+)['"]/g;

/** Every file of ours the server loads, following static and dynamic imports. */
function loadedFiles(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    if (!file.endsWith('.js')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORTS)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec));
      else if (spec.startsWith('@mg/shared/')) queue.push(resolve(SHARED, spec.slice(11)));
      // Anything else is a package from node_modules.
    }
  }
  return [...seen].map((f) => relative(REPO, f).split(sep).join('/'));
}

describe('the helpdesk with the portal switched off (D145)', () => {
  test('the server loads no portal code and nothing that opens its database', () => {
    const files = loadedFiles(SERVER);
    assert.ok(files.length > 50, 'the walk found the app');
    assert.ok(files.includes('packages/shared/server/modules/tickets/service.js'));
    assert.deepEqual(
      files.filter((f) => f.startsWith('apps/portal/')),
      [],
      'no file of the portal'
    );
    assert.deepEqual(
      files.filter(
        (f) => f.includes('/modules/migration/') || f.includes('migrate-from-portal')
      ),
      [],
      'the migration is a script of its own'
    );
    // Only env.js names the portal's database, to validate it for the script.
    assert.deepEqual(
      files.filter((f) => /PORTAL_SOURCE_/.test(readFileSync(resolve(REPO, f), 'utf8'))),
      ['apps/helpdesk/backend/src/config/env.js']
    );
  });

  test('a day’s work and every job, without a single call to the portal', async () => {
    const PORTAL = { host: '127.0.0.1', port: 3999 };
    const connections = [];
    const connect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
      const options = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
      connections.push({ port: Number(options.port), host: options.host });
      return connect.apply(this, args);
    };
    const fetches = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetches.push(String(args[0]));
      throw new Error('no HTTP calls expected');
    };
    after(() => {
      net.Socket.prototype.connect = connect;
      globalThis.fetch = realFetch;
    });

    const w = await createTicketWorld(createApp, {
      config: {
        ...DEV,
        PORTAL_URL: `http://${PORTAL.host}:${PORTAL.port}`,
        // Even when set, the server never opens it.
        PORTAL_SOURCE_DATABASE_URL:
          'sqlserver://portal.invalid:1433;database=mgportal_live;user=x;password=CHANGE_ME',
      },
    });

    assert.equal((await request(w.app).get('/api/health')).status, 200);
    assert.equal((await request(w.app).get('/api/ready')).status, 200);
    const me = (await w.gen.get('/api/me')).body;
    assert.equal(me.portalUrl, `http://${PORTAL.host}:${PORTAL.port}`, 'only a link');

    const ticket = await w.raise(w.gen);
    await w.say(w.lead, ticket.id, 'Looking at it.');
    w.give(ticket.id, w.agent);
    await w.change(w.agent, ticket.id, { status: 'Resolved' });
    const solved = await w.gen.post(`/api/tickets/${ticket.id}/solved`, { rating: 5 });
    assert.equal(solved.status, 200, JSON.stringify(solved.body));
    assert.equal((await w.gen.get('/api/notifications')).status, 200);
    assert.equal((await w.lead.get('/api/helpdesk/reports')).status, 200);

    // The jobs the helpdesk runs for itself: one round each.
    const log = { info() {}, warn() {}, error() {} };
    const jobs = [
      startSlaWatch(w.app.locals.tickets, log, { intervalMs: 3_600_000 }),
      startConfirmationReminders(w.app.locals.tickets, log, { intervalMs: 3_600_000 }),
      startFileScanSweep(w.app.locals.files, log, { intervalMs: 3_600_000 }),
    ];
    await Promise.all(jobs.map((j) => j.ready));
    for (const j of jobs) j.stop();

    assert.deepEqual(fetches, [], 'no HTTP calls');
    assert.deepEqual(
      connections.filter((c) => c.port === PORTAL.port || c.port === 3000),
      [],
      'no connection to the portal'
    );
    assert.ok(connections.length > 0, 'the requests themselves were seen');
  });
});
