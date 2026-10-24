/**
 * The IT Helpdesk as an app of its own (D144), on fake people only
 * (seed-data.js, in memory): signing in, who sees which tickets, the IT team's
 * roles, the requester's confirmation and rating (D143), SLA, reports,
 * notifications and Administration. The ticket rules themselves are the
 * portal's and are tested in depth there (apps/portal/backend/tests); these
 * tests prove the helpdesk wires them up the same way, with its own links,
 * people and administrators.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import request from 'supertest';

import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import {
  bootstrapHoldingAdmin,
  createProfileFromToken,
} from '@mg/shared/server/modules/auth/provision.js';
import { cairo, iso, signIn } from '@mg/shared/server/testing/clients.js';
import {
  DEV,
  START,
  SUNDAY,
  buildApp,
  createTicketWorld,
} from '@mg/shared/server/testing/ticket-world.js';

const world = (options) => createTicketWorld(createApp, options);

/** One person's notification rows, newest last. */
const bell = (w, who) =>
  (w.repo.notifications ?? []).filter((n) => n.userId === who.user.id && n.channel === 'inApp');
const linkOf = (row) => JSON.parse(row.payload).link;

describe('the app', () => {
  test('serves its own page, its sign-in page, the shared design system and its strings', async () => {
    const { app } = buildApp(createApp);
    for (const path of [
      '/',
      '/login.html',
      '/offline.html',
      '/manifest.webmanifest',
      '/assets/js/app.js',
      '/assets/js/pages/requests.js',
      '/assets/css/tokens.css',
      '/assets/js/pages/tickets/new.js',
      '/assets/i18n/common.en.json',
      '/assets/i18n/helpdesk.ar.json',
    ]) {
      assert.equal((await request(app).get(path)).status, 200, path);
    }
    // The portal's own pages are not here.
    assert.equal((await request(app).get('/assets/js/pages/rooms.js')).status, 404);
    assert.equal((await request(app).get('/helpdesk.html')).status, 404);

    const page = await request(app).get('/');
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.match(page.text, /content="common helpdesk"/);
  });

  test('its session cookie is its own, so it never signs the portal out on one machine', async () => {
    const { app } = buildApp(createApp);
    const res = await request(app).get('/api/auth/config');
    assert.match(String(res.headers['set-cookie']), /^mgh\.sid=/);
  });

  test('the environment: port 3001, HELPDESK_DATA, and production refuses anything mocked', () => {
    const dev = loadEnv({});
    assert.equal(dev.PORT, 3001);
    assert.equal(dev.HELPDESK_DATA, 'demo');
    assert.equal(dev.APP_BASE_URL, 'http://localhost:3001');
    assert.equal(dev.sessionCookieName, 'mgh.sid');
    assert.deepEqual(
      loadEnv({ INITIAL_HELPDESK_ADMINS: ' A@x.eg, b@Y.eg ' }).INITIAL_HELPDESK_ADMINS,
      ['a@x.eg', 'b@y.eg']
    );

    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: 'sqlserver://db;database=mghelpdesk',
      SESSION_SECRET: 'x'.repeat(40),
      APP_BASE_URL: 'https://helpdesk.mgholding.example',
      AUTH_MODE: 'entra',
      GRAPH_MAIL_MODE: 'real',
      GRAPH_DIRECTORY_MODE: 'real',
      NOREPLY_MAILBOX: 'it@mgholding.eg',
      ENTRA_TENANT_ID: 't',
      ENTRA_CLIENT_ID: 'c',
      ENTRA_CLIENT_SECRET: 's',
      STORAGE_DRIVER: 'azure',
      AZURE_STORAGE_ACCOUNT_URL: 'https://acct.blob.core.windows.net',
      SCAN_MODE: 'defender',
    };
    assert.equal(loadEnv(production).HELPDESK_DATA, 'live');
    assert.throws(() => loadEnv({ ...production, AUTH_MODE: 'mock' }), /AUTH_MODE/);
    assert.throws(() => loadEnv({ ...production, GRAPH_MAIL_MODE: 'mock' }), /GRAPH_MAIL_MODE/);
    assert.throws(
      () => loadEnv({ ...production, GRAPH_DIRECTORY_MODE: 'mock' }),
      /GRAPH_DIRECTORY_MODE/
    );
    assert.throws(() => loadEnv({ ...production, HELPDESK_DATA: 'demo' }), /HELPDESK_DATA/);
    assert.throws(() => loadEnv({ ...production, PORTAL_URL: 'not a url' }), /PORTAL_URL/);
    // Live data on a developer's machine needs real people and real sign-in.
    assert.throws(() => loadEnv({ HELPDESK_DATA: 'live' }), /HELPDESK_DATA=live/);
  });
});

describe('signing in', () => {
  test('everyone lands on the helpdesk; GET /api/me says which areas are theirs', async () => {
    const w = await world({
      config: {
        NODE_ENV: 'development',
        AUTH_MODE: 'mock',
        PORTAL_URL: 'https://portal.example',
      },
    });
    const me = async (who) => (await who.get('/api/me')).body;

    for (const who of [w.gen, w.lead, w.ha]) assert.equal(who.redirectTo, '/');

    const user = await me(w.gen);
    assert.equal(user.helpdesk, null);
    assert.equal(user.admin, false);
    assert.equal(user.company.code, 'GEN');
    assert.equal(user.portalUrl, 'https://portal.example');
    assert.equal(user.nav, undefined, 'no portal navigation here');

    assert.deepEqual((await me(w.agent)).helpdesk, { role: 'Agent' });
    assert.deepEqual((await me(w.lead)).helpdesk, { role: 'Lead' });

    const admin = await me(w.ha);
    assert.equal(admin.admin, true);
    assert.equal(admin.helpdesk, null, 'an administrator is not on the IT team for it');
  });

  test('no PORTAL_URL, no link back to the portal', async () => {
    // Whatever apps/helpdesk/.env says: this test is about the setting being absent.
    const { app, repo } = buildApp(createApp, {
      config: { ...DEV, PORTAL_URL: undefined },
    });
    const salma = await signIn(
      app,
      repo.users.find((u) => u.email.startsWith('salma'))
    );
    assert.equal((await salma.get('/api/me')).body.portalUrl, null);
  });

  test('not signed in: 401 on the API', async () => {
    const { app } = buildApp(createApp);
    assert.equal((await request(app).get('/api/me')).status, 401);
    assert.equal((await request(app).get('/api/tickets/mine')).status, 401);
  });

  test('Entra: a new person is placed by their email domain; an unknown domain gets nothing', async () => {
    const { repo } = buildApp(createApp);
    const req = { ip: '127.0.0.1', log: null };
    const placed = await createProfileFromToken(req, repo, {
      oid: '6f1c2a54-1d1e-4c39-9b3a-1c2d3e4f5a6b',
      email: 'new.person@masar.eg',
      name: 'New Person',
    });
    assert.equal(placed.person.companyId, repo.companies.find((c) => c.code === 'MSR').id);

    const refused = await createProfileFromToken(req, repo, {
      oid: '7f1c2a54-1d1e-4c39-9b3a-1c2d3e4f5a6b',
      email: 'someone@elsewhere.eg',
      name: 'Someone',
    });
    assert.deepEqual(refused, { refused: 'company_not_set_up' });
  });

  test('INITIAL_HELPDESK_ADMINS makes the first administrator, while there is no real one', async () => {
    const { repo } = buildApp(createApp);
    const config = loadEnv({ INITIAL_HELPDESK_ADMINS: 'new.person@masar.eg' });
    const req = { ip: '127.0.0.1', log: null };
    const { person } = await createProfileFromToken(req, repo, {
      oid: '6f1c2a54-1d1e-4c39-9b3a-1c2d3e4f5a6b',
      email: 'new.person@masar.eg',
      name: 'New Person',
    });
    const other = repo.users.find((u) => u.email === 'salma.ibrahim@genesismining-eg.com');

    assert.equal(await bootstrapHoldingAdmin(req, repo, config, other, other.email), false);
    assert.equal(
      await bootstrapHoldingAdmin(req, repo, config, person, 'new.person@masar.eg'),
      true
    );
    assert.ok(
      (await repo.getSessionUser(person.id)).roles.some((r) => r.role === 'HoldingAdmin')
    );
  });
});

describe('whose tickets', () => {
  test('a requester sees their own, never a colleague’s or another company’s', async () => {
    const w = await world();
    const mine = await w.raise(w.gen);
    const theirs = await w.raise(w.msr, { subject: 'Masar printer' });

    assert.equal((await w.msr.get(`/api/tickets/${mine.id}`)).status, 404);
    assert.equal((await w.gen2.get(`/api/tickets/${mine.id}`)).status, 404);
    assert.equal((await w.gen.get(`/api/tickets/${theirs.id}`)).status, 404);

    const list = (await w.gen.get('/api/tickets/mine')).body.items.map((t) => t.id);
    assert.deepEqual(list, [mine.id]);
    assert.equal((await w.gen.get('/api/tickets/queue')).status, 403);
  });

  test('the IT team sees every company’s; the administrator only their own', async () => {
    const w = await world();
    const gen = await w.raise(w.gen);
    const msr = await w.raise(w.msr);

    for (const id of [gen.id, msr.id]) {
      assert.equal((await w.agent.get(`/api/tickets/${id}`)).status, 200);
    }
    const queue = (await w.agent.get('/api/tickets/queue')).body.items.map(
      (t) => t.company.code
    );
    assert.deepEqual(queue.sort(), ['GEN', 'MSR']);

    assert.equal((await w.ha.get(`/api/tickets/${gen.id}`)).status, 404);
    assert.equal((await w.ha.get('/api/tickets/queue')).status, 403);
    const own = await w.raise(w.ha, { subject: 'My own laptop' });
    assert.equal((await w.ha.get(`/api/tickets/${own.id}`)).status, 200);
  });
});

describe('the IT team', () => {
  test('agents work the queue and reports; only leads keep the settings', async () => {
    const w = await world();
    assert.equal((await w.agent.get('/api/helpdesk/reports')).status, 200);
    assert.equal((await w.agent.get('/api/helpdesk/settings/categories')).status, 403);
    assert.equal((await w.lead.get('/api/helpdesk/settings/categories')).status, 200);
    assert.equal((await w.gen.get('/api/helpdesk/reports')).status, 403);
    assert.equal((await w.ha.get('/api/helpdesk/settings/teams')).status, 403);
  });

  test('the administrator puts someone on the team; they see the IT pages from their next sign-in', async () => {
    const w = await world();
    // The session's privileges are recorded on its first request (session 28).
    assert.equal((await w.gen.get('/api/me')).body.helpdesk, null);
    const put = await w.ha.put(
      `/api/admin/it-team/teams/${w.team.id}/members/${w.gen.user.id}`,
      {
        role: 'Agent',
      }
    );
    assert.equal(put.status, 200, JSON.stringify(put.body));
    // A change of privilege ends the old session (D126).
    assert.equal((await w.gen.get('/api/me')).status, 401);
    const again = await signIn(w.app, w.gen.user);
    assert.deepEqual((await again.get('/api/me')).body.helpdesk, { role: 'Agent' });
    assert.equal((await again.get('/api/tickets/queue')).status, 200);
    assert.ok(w.repo.auditLogs.some((row) => row.action.startsWith('helpdesk.member.')));
  });
});

describe('SLA', () => {
  test('due dates count business hours; Pending stops the clock', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    // P3 from Sunday 11:00: 8 business hours (09:00–17:00 days) to answer.
    assert.equal(iso(ticket.sla.firstResponseDueAt), iso(cairo('2026-10-12', '10:00')));
    assert.equal(iso(ticket.sla.resolveDueAt), iso(cairo('2026-10-13', '17:00')));

    w.give(ticket.id, w.agent);
    w.at(SUNDAY, '12:00');
    await w.change(w.agent, ticket.id, { status: 'Pending' });
    w.at('2026-10-12', '12:00');
    await w.say(w.gen, ticket.id, 'Here is the photo you asked for.');
    const back = await w.ticket(w.gen, ticket.id);
    // A whole working day waited on the requester, so resolution moves a day.
    assert.equal(iso(back.ticket.sla.resolveDueAt), iso(cairo('2026-10-14', '17:00')));
  });
});

describe('confirmation and rating (D143)', () => {
  test('IT resolves, the requester confirms with a rating, the ticket closes and reports count it', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    w.give(ticket.id, w.agent);
    await w.change(w.agent, ticket.id, { status: 'Resolved' });

    const asked = bell(w, w.gen).at(-1);
    assert.equal(asked.templateKey, 'ticket.resolved');
    assert.equal(
      linkOf(asked),
      `#tickets/${ticket.id}`,
      'the helpdesk’s own page, no /helpdesk'
    );

    assert.equal(
      (await w.agent.post(`/api/tickets/${ticket.id}/solved`, { rating: 5 })).status,
      403
    );
    const solved = await w.gen.post(`/api/tickets/${ticket.id}/solved`, {
      rating: 4,
      feedback: 'Quick, thank you.',
    });
    assert.equal(solved.status, 200, JSON.stringify(solved.body));
    assert.equal(solved.body.ticket.status, 'Closed');
    assert.equal(bell(w, w.agent).at(-1).templateKey, 'ticket.confirmed');

    const report = (await w.lead.get(`/api/helpdesk/reports?from=${SUNDAY}&to=${SUNDAY}`)).body;
    assert.equal(report.satisfaction.rated, 1);
    assert.equal(report.satisfaction.satisfiedPercent, 100);
    assert.equal(report.satisfaction.confirmed, 1);
  });

  test('"not solved" needs a reason and reopens it for the assignee', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    w.give(ticket.id, w.agent);
    await w.change(w.agent, ticket.id, { status: 'Resolved' });
    assert.equal((await w.gen.post(`/api/tickets/${ticket.id}/not-solved`, {})).status, 400);
    const res = await w.gen.post(`/api/tickets/${ticket.id}/not-solved`, {
      reason: 'It still shows a black screen.',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ticket.status, 'Open');
    assert.equal(bell(w, w.agent).at(-1).templateKey, 'ticket.notSolved');
  });
});

describe('reports', () => {
  test('counts by company and status, and a CSV of the same tickets', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    await w.raise(w.msr);
    const report = (await w.agent.get(`/api/helpdesk/reports?from=${SUNDAY}&to=${SUNDAY}`))
      .body;
    assert.equal(report.total, 2);
    assert.deepEqual(report.byCompany.map((c) => c.code).sort(), ['GEN', 'MSR']);
    assert.equal(report.byStatus.find((s) => s.status === 'New').count, 2);

    const csv = await w.agent.get(
      `/api/helpdesk/reports/export.csv?from=${SUNDAY}&to=${SUNDAY}`
    );
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.ok(csv.text.includes(ticket.number));
  });
});

describe('notifications', () => {
  test('a new ticket tells the leads, in the bell and by email, with the helpdesk’s own links', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);

    const told = bell(w, w.lead).at(-1);
    assert.equal(told.templateKey, 'ticket.created');
    assert.equal(linkOf(told), `#tickets/${ticket.id}`);

    const mail = (await w.app.locals.mailOutbox.list()).find((m) =>
      m.to.includes(w.lead.user.email)
    );
    assert.ok(mail, 'the lead was emailed');
    assert.ok(mail.html.includes(`http://localhost:3001/#tickets/${ticket.id}`));
    assert.ok(mail.html.includes('http://localhost:3001/#notifications/preferences'));
    assert.match(mail.html, /Open in the IT Helpdesk/);
  });

  test('an IT reply tells the requester; a resolved ticket reminds them every 24 hours', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    w.give(ticket.id, w.agent);
    await w.say(w.agent, ticket.id, 'Please restart it with the power button held.');
    assert.equal(bell(w, w.gen).at(-1).templateKey, 'ticket.comment');

    await w.change(w.agent, ticket.id, { status: 'Resolved' });
    const reminders = () =>
      bell(w, w.gen).filter((n) => n.templateKey === 'ticket.confirmReminder');
    w.clock.now = new Date(START.getTime() + 24 * 3_600_000);
    assert.equal(await w.app.locals.tickets.remindResolved(), 1);
    assert.equal(reminders().length, 1);
    assert.equal(await w.app.locals.tickets.remindResolved(), 0, 'once per 24 hours');
  });

  test('the bell lists only the person’s own', async () => {
    const w = await world();
    await w.raise(w.gen);
    const lead = (await w.lead.get('/api/notifications')).body;
    assert.ok(lead.items.length >= 1);
    assert.equal((await w.msr.get('/api/notifications')).body.items.length, 0);
  });
});

describe('raised on behalf of someone', () => {
  const FIELDS = (w) => ({
    subject: 'Cannot print',
    description: 'Phoned the desk.',
    categoryId: w.category('Printer / scanner').id,
  });

  test('an IT agent raises it for an employee: theirs to follow, theirs to be told, audited', async () => {
    const w = await world();
    const ticket = await w.raise(w.agent, { requesterId: w.gen.user.id, source: 'phone' });

    // The employee is the requester; the agent is only who typed it in.
    assert.equal(ticket.requester.id, w.gen.user.id);
    assert.equal(ticket.createdBy.id, w.agent.user.id);
    assert.equal(ticket.source, 'phone');
    assert.equal((await w.agent.get('/api/tickets/mine')).body.total, 0);
    const theirs = (await w.gen.get('/api/tickets/mine')).body;
    assert.deepEqual(
      theirs.items.map((row) => row.number),
      [ticket.number]
    );

    // Their bell and, with an account, their mail say so; the agent gets neither.
    assert.equal(bell(w, w.gen).at(-1).templateKey, 'ticket.created');
    const mail = (await w.app.locals.mailOutbox.list()).filter((m) =>
      m.to.includes(w.gen.user.email)
    );
    assert.equal(mail.length, 1);
    assert.equal(bell(w, w.agent).filter((n) => n.templateKey === 'ticket.created').length, 0);

    // One audit row names the agent, the ticket and the employee.
    const rows = w.repo.auditLogs.filter((row) => row.action === 'ticket.create_on_behalf');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actorId, w.agent.user.id);
    assert.equal(rows[0].entity, 'Ticket');
    assert.equal(rows[0].entityId, ticket.id);
    assert.equal(rows[0].companyId, w.gen.user.companyId);
    const after = JSON.parse(rows[0].after);
    assert.equal(after.requesterId, w.gen.user.id);
    assert.equal(after.createdById, w.agent.user.id);
    assert.equal(after.number, ticket.number);
  });

  test('a ticket people raise for themselves writes no such row, and an employee cannot raise for others', async () => {
    const w = await world();
    await w.raise(w.gen);
    await w.raise(w.agent);
    // An agent naming themselves is not "on behalf of" anyone.
    await w.raise(w.agent, { requesterId: w.agent.user.id });
    assert.equal(
      w.repo.auditLogs.filter((row) => row.action === 'ticket.create_on_behalf').length,
      0
    );

    const refused = await w.gen.post('/api/tickets', {
      ...FIELDS(w),
      requesterId: w.gen2.user.id,
    });
    assert.equal(refused.status, 403);
    assert.equal(
      w.repo.auditLogs.filter((row) => row.action === 'ticket.create_on_behalf').length,
      0
    );
  });

  test('the people picker is the helpdesk’s own directory and is for the IT team only', async () => {
    const w = await world();
    const found = await w.agent.get('/api/helpdesk/people?q=sal');
    assert.equal(found.status, 200);
    assert.ok(JSON.stringify(found.body).includes('Salma'));
    assert.equal((await w.gen.get('/api/helpdesk/people?q=sal')).status, 403);
  });
});

describe('Administration: companies and their mail domains', () => {
  test('the administrator lists, adds and changes companies, every change audited', async () => {
    const w = await world();
    const list = (await w.ha.get('/api/admin/companies')).body.items;
    assert.deepEqual(
      list.map((c) => c.code),
      ['GEN', 'HLD', 'MSR']
    );

    const added = await w.ha.post('/api/admin/companies', {
      code: 'NEW',
      nameEn: 'New Co',
      nameAr: 'شركة جديدة',
      domains: ['newco.example', 'NEWCO2.example'],
      accentColor: '#1e5aa8',
    });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.deepEqual(added.body.domains, ['newco.example', 'newco2.example']);

    // A person on the new domain can now be placed at sign-in.
    const placed = await createProfileFromToken({ ip: null }, w.repo, {
      oid: '6f1c2a54-1d1e-4c39-9b3a-1c2d3e4f5a6b',
      email: 'a.person@newco2.example',
      name: 'A Person',
    });
    assert.equal(placed.person.companyId, added.body.id);

    const changed = await w.ha.patch(`/api/admin/companies/${added.body.id}`, {
      updatedAt: added.body.updatedAt,
      domains: ['newco.example'],
      isActive: false,
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.isActive, false);
    const stale = await w.ha.patch(`/api/admin/companies/${added.body.id}`, {
      updatedAt: added.body.updatedAt,
      nameEn: 'Late',
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'stale_record');

    const actions = w.repo.auditLogs.map((row) => row.action);
    assert.ok(actions.includes('company.create'));
    assert.ok(actions.includes('company.deactivate'));
  });

  test('a code or a domain another company has is refused', async () => {
    const w = await world();
    const body = {
      code: 'GEN',
      nameEn: 'Copy',
      nameAr: 'نسخة',
      domains: ['copy.example'],
      accentColor: '#1e5aa8',
    };
    const code = await w.ha.post('/api/admin/companies', body);
    assert.equal(code.body.error.code, 'code_taken');
    const domain = await w.ha.post('/api/admin/companies', {
      ...body,
      code: 'CPY',
      domains: ['masar.eg'],
    });
    assert.equal(domain.status, 409);
    assert.equal(domain.body.error.code, 'domain_taken');
    const bad = await w.ha.post('/api/admin/companies', {
      ...body,
      code: 'CPY',
      domains: ['nope'],
    });
    assert.equal(bad.status, 400);
  });

  test('nobody else administers', async () => {
    const w = await world();
    for (const who of [w.gen, w.agent, w.lead]) {
      assert.equal((await who.get('/api/admin/companies')).status, 403);
      assert.equal((await who.get('/api/admin/it-team/teams')).status, 403);
    }
    const people = await w.ha.get('/api/admin/people?q=salma');
    assert.equal(people.status, 200);
    assert.equal(people.body.items[0].email, 'salma.ibrahim@genesismining-eg.com');
  });
});
