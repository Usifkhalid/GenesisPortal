/**
 * The portal's link to the IT Helpdesk app (D146): the "IT Support" menu entry
 * only when HELPDESK_URL is set, the old /helpdesk addresses sent on, no
 * helpdesk API left, no old ticket notifications, and IT staff using the portal
 * like everyone else.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import request from 'supertest';

import { createApp } from '../src/app.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';
import { signIn } from '@mg/shared/server/testing/clients.js';

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };
const HELPDESK = 'https://helpdesk.example.com';

function build(config = {}) {
  // The in-memory repo still carries the demo IT team (the helpdesk app's data).
  const repo = createMemoryUserRepo({ supportTeams: false });
  const app = createApp({
    config: { ...DEV, HELPDESK_URL: undefined, ...config },
    userRepo: repo,
    authRateLimit: { limit: 10_000 },
    rateLimit: { limit: 100_000 },
  });
  const person = (email) => repo.users.find((u) => u.email === email);
  return { app, repo, person };
}

const SALMA = 'salma.ibrahim@genesismining-eg.com';
const IT_LEAD = 'omar.fahmy@mgholding.example';

describe('the "IT Support" entry', () => {
  test('is listed, with its address, when HELPDESK_URL is set', async () => {
    const { app, person } = build({ HELPDESK_URL: `${HELPDESK}/` });
    const me = (await (await signIn(app, person(SALMA))).get('/api/me')).body;
    assert.ok(me.nav.some((n) => n.key === 'itSupport' && n.group === 'main'));
    assert.equal(me.helpdeskUrl, HELPDESK);
    assert.ok(!me.nav.some((n) => n.key === 'tickets'));
  });

  test('is left out when HELPDESK_URL is not set', async () => {
    const { app, person } = build();
    const me = (await (await signIn(app, person(SALMA))).get('/api/me')).body;
    assert.ok(!me.nav.some((n) => n.key === 'itSupport'));
    assert.equal(me.helpdeskUrl, null);
  });
});

describe('old addresses', () => {
  test('/helpdesk and its pages go to the helpdesk app, with no session needed', async () => {
    const { app } = build({ HELPDESK_URL: HELPDESK });
    for (const path of ['/helpdesk', '/helpdesk.html', '/helpdesk/queue']) {
      const res = await request(app).get(path);
      assert.equal(res.status, 302, path);
      assert.equal(res.headers.location, `${HELPDESK}/`, path);
    }
  });

  test('without HELPDESK_URL they are not found', async () => {
    const { app } = build();
    assert.equal((await request(app).get('/helpdesk')).status, 404);
    assert.equal((await request(app).get('/helpdesk.html')).status, 404);
  });
});

describe('no helpdesk API in the portal', () => {
  test('the ticket, helpdesk and IT team routes answer 404 to a signed-in person', async () => {
    const { app, person } = build({ HELPDESK_URL: HELPDESK });
    const lead = await signIn(app, person(IT_LEAD));
    for (const path of [
      '/api/tickets/mine',
      '/api/tickets/counts',
      '/api/helpdesk/reports',
      '/api/helpdesk/people',
      '/api/admin/it-team/teams',
    ]) {
      assert.equal((await lead.get(path)).status, 404, path);
    }
    assert.equal((await lead.post('/api/tickets', {})).status, 404);
  });
});

describe('IT staff are ordinary portal users (D146)', () => {
  test('a person on the IT team in the old data is not sent away or refused', async () => {
    const { app, repo, person } = build({ HELPDESK_URL: HELPDESK });
    // The old data still says they are on the team; the portal does not read it.
    const lead = person(IT_LEAD);
    assert.ok(repo.helpdesk.member.some((m) => m.userId === lead.id));
    const client = await signIn(app, lead);
    assert.equal(client.redirectTo, '/');
    const me = (await client.get('/api/me')).body;
    assert.equal(me.home, undefined);
    assert.equal(me.helpdesk, undefined);
    assert.deepEqual(
      me.nav.map((n) => n.key),
      ['home', 'announcements', 'rooms', 'directory', 'itSupport']
    );
    assert.equal((await client.get('/api/rooms')).status, 200);
    assert.equal((await client.get('/api/announcements')).status, 200);
    assert.equal((await client.get('/api/directory/people')).status, 200);
  });
});

describe('notifications', () => {
  test('old ticket notifications are hidden; the others stay', async () => {
    const { app, repo, person } = build();
    const salma = person(SALMA);
    const { notify } = app.locals;
    await notify([salma.id], 'ticket.assigned', {
      link: '#tickets/abc',
      number: 'IT-2026-00001',
      subject: 'Laptop',
    });
    await notify([salma.id], 'booking.cancelled', { link: '#rooms', room: 'Boardroom' });
    assert.equal(
      repo.notifications.filter((n) => n.userId === salma.id && n.channel === 'inApp').length,
      2
    );

    const client = await signIn(app, salma);
    const list = (await client.get('/api/notifications')).body;
    assert.deepEqual(
      list.items.map((n) => n.templateKey),
      ['booking.cancelled']
    );
    assert.equal(list.total, 1);
    assert.equal(list.unread, 1);
    assert.equal((await client.get('/api/notifications/unread-count')).body.unread, 1);

    // "Mark all read" touches only what the portal shows.
    assert.equal((await client.post('/api/notifications/read-all')).body.marked, 1);
  });

  test('the settings offer no "tickets" switch, and refuse one', async () => {
    const { app, person } = build();
    const client = await signIn(app, person(SALMA));
    const prefs = (await client.get('/api/notifications/preferences')).body;
    assert.deepEqual(prefs.categories, ['bookings', 'announcements']);
    assert.ok(prefs.items.every((i) => i.category !== 'tickets'));
    const refused = await client.put('/api/notifications/preferences', {
      items: [{ category: 'tickets', channel: 'email', enabled: false }],
    });
    assert.equal(refused.status, 400);
  });
});
