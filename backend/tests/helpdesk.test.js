import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { createMemoryStorage } from '../src/lib/storage.js';
import { cairoWallToUtc } from '../src/lib/time.js';
import { createMemoryUserRepo } from '../src/modules/auth/repo-memory.js';
import { targetState } from '../src/modules/tickets/reports.js';

/**
 * The IT Helpdesk as its own workspace (docs/DECISIONS.md D135):
 *   - IT team members (agents and leads) work in /helpdesk and nowhere else;
 *     the main portal's pages send them there and its API refuses them;
 *   - everyone else, administrators included, is refused /helpdesk and the
 *     IT side of the API;
 *   - joining or leaving the team moves a person across from their next
 *     request;
 *   - notifications for the IT team lead to /helpdesk, an employee's to the
 *     portal;
 *   - the reports count what the reader's team serves.
 */

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };
const cairo = (ymd, hhmm) =>
  cairoWallToUtc(ymd, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)));
const SUNDAY = '2026-10-11';

const EMAILS = {
  ha: 'nadia.elsayed@mgholding.example',
  caGen: 'hany.soliman@genesismining-eg.com',
  gen: 'salma.ibrahim@genesismining-eg.com',
  gen2: 'mahmoud.attia@genesismining-eg.com',
  msr: 'yasmine.nabil@masar.eg',
  lead: 'omar.fahmy@mgholding.example',
  agent: 'sherif.awad@mgholding.example',
};

function build() {
  const repo = createMemoryUserRepo();
  const clock = { now: cairo(SUNDAY, '09:00') };
  const app = createApp({
    config: DEV,
    userRepo: repo,
    storage: createMemoryStorage(),
    now: () => clock.now,
    authRateLimit: { limit: 100_000, accountLimit: 100_000 },
    rateLimit: { limit: 100_000 },
  });
  return { app, repo, clock };
}

async function signIn(app, user) {
  const agent = request.agent(app);
  const config = await agent.get('/api/auth/config');
  const login = await agent
    .post('/api/auth/mock-login')
    .set('X-CSRF-Token', config.body.csrfToken)
    .send({ userId: user.id });
  assert.equal(login.status, 200);
  const csrf = login.body.csrfToken;
  const send = (method, path, body) => agent[method](path).set('X-CSRF-Token', csrf).send(body);
  return {
    user,
    redirectTo: login.body.redirectTo,
    get: (path) => agent.get(path),
    post: (path, body = {}) => send('post', path, body),
    patch: (path, body) => send('patch', path, body),
    put: (path, body) => send('put', path, body),
    del: (path) => agent.delete(path).set('X-CSRF-Token', csrf),
  };
}

async function world() {
  const w = build();
  w.person = (key) => w.repo.users.find((u) => u.email === EMAILS[key]);
  for (const key of Object.keys(EMAILS)) w[key] = await signIn(w.app, w.person(key));
  w.team = w.repo.helpdesk.team[0];
  w.category = (nameEn) => w.repo.helpdesk.category.find((c) => c.nameEn === nameEn);
  w.raise = async (as, body = {}) => {
    const res = await as.post('/api/tickets', {
      subject: 'Laptop will not start',
      description: 'It shows the logo and then a black screen.',
      categoryId: w.category('Laptop / PC').id,
      ...body,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.ticket;
  };
  w.member = (key) => `/api/admin/it-team/teams/${w.team.id}/members/${w.person(key).id}`;
  return w;
}

/** Portal routes an IT team member is refused, one per module. */
const PORTAL_API = [
  '/api/announcements',
  '/api/rooms',
  '/api/bookings/mine',
  '/api/directory/people',
  '/api/admin/scope',
];

describe('the IT Helpdesk is the IT team’s, and only theirs (D135)', () => {
  test('pages: /helpdesk is for IT; anyone else is refused it', async () => {
    const w = await world();

    // Not signed in: to the login page.
    const anonymous = await request(w.app).get('/helpdesk');
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.location, '/login.html');

    for (const key of ['agent', 'lead']) {
      const page = await w[key].get('/helpdesk');
      assert.equal(page.status, 200, key);
      assert.match(page.text, /assets\/js\/helpdesk\.js/);
    }

    for (const key of ['ha', 'caGen', 'gen']) {
      const page = await w[key].get('/helpdesk');
      assert.equal(page.status, 403, key);
      assert.match(page.text, /hd\.noAccess\.title/);
      assert.doesNotMatch(page.text, /helpdesk\.js/);
      assert.equal((await w[key].get('/helpdesk.html')).status, 403);
      const portal = await w[key].get('/');
      assert.equal(portal.status, 200, key);
      assert.match(portal.text, /assets\/js\/app\.js/);
    }
  });

  test('sign-in and /api/me: IT lands in the Helpdesk with no portal navigation', async () => {
    const w = await world();
    assert.equal(w.agent.redirectTo, '/helpdesk');
    assert.equal(w.lead.redirectTo, '/helpdesk');
    assert.equal(w.ha.redirectTo, '/');
    assert.equal(w.gen.redirectTo, '/');

    const agent = (await w.agent.get('/api/me')).body;
    assert.deepEqual(
      [agent.home, agent.helpdesk, agent.nav],
      ['/helpdesk', { role: 'Agent' }, []]
    );
    assert.deepEqual((await w.lead.get('/api/me')).body.helpdesk, { role: 'Lead' });
    const ha = (await w.ha.get('/api/me')).body;
    assert.equal(ha.home, '/');
    assert.equal(ha.helpdesk, null);
    assert.ok(ha.nav.some((item) => item.key === 'admin'));
  });

  test('IT team members get 403 from every main-portal API, and keep their own', async () => {
    const w = await world();
    for (const key of ['agent', 'lead']) {
      for (const path of PORTAL_API) {
        const res = await w[key].get(path);
        assert.equal(res.status, 403, `${key} ${path}`);
        assert.equal(res.body.error.code, 'helpdesk_only');
      }
      const booking = await w[key].post('/api/bookings', {});
      assert.equal(booking.body.error.code, 'helpdesk_only');
      for (const path of [
        '/api/me',
        '/api/notifications',
        '/api/tickets/mine',
        '/api/tickets/queue',
        '/api/helpdesk/reports',
        '/api/helpdesk/people?q=sal',
      ]) {
        assert.equal((await w[key].get(path)).status, 200, `${key} ${path}`);
      }
    }
    // They still appear in the directory for everyone else.
    const found = await w.gen.get('/api/directory/people?q=Sherif');
    assert.ok(found.body.items.some((p) => p.id === w.agent.user.id));
  });

  test('an IT team member logs a ticket for themselves in the Helpdesk', async () => {
    const w = await world();
    const own = await w.raise(w.agent, { subject: 'My own monitor flickers' });
    assert.equal(own.requester.id, w.agent.user.id);
    const mine = (await w.agent.get('/api/tickets/mine')).body;
    assert.deepEqual(
      mine.items.map((t) => t.id),
      [own.id]
    );
    // The lead is told, in the Helpdesk.
    const told = w.repo.notifications.find(
      (n) => n.userId === w.lead.user.id && n.templateKey === 'ticket.created'
    );
    assert.equal(JSON.parse(told.payload).link, `/helpdesk#tickets/${own.id}`);
  });

  test('Nadia (HoldingAdmin) cannot open the Helpdesk or any ticket, but staffs the team', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    assert.equal((await w.ha.get('/helpdesk')).status, 403);
    assert.equal((await w.ha.get(`/api/tickets/${t.id}`)).status, 404);
    assert.equal((await w.ha.get('/api/tickets/queue')).status, 403);
    assert.equal((await w.ha.get('/api/helpdesk/reports')).status, 403);
    assert.equal((await w.ha.get('/api/helpdesk/settings/teams')).status, 403);
    assert.equal((await w.ha.patch(`/api/tickets/${t.id}`, { assigneeId: null })).status, 403);

    const added = await w.ha.put(w.member('gen2'), { role: 'Agent' });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.ok(added.body.members.some((m) => m.id === w.gen2.user.id && m.role === 'Agent'));
    // The answer is about people, never tickets.
    assert.equal(JSON.stringify(added.body).includes(t.subject), false);
  });
});

describe('joining and leaving the IT team (D135)', () => {
  test('someone added loses the portal from their next request; removed, they get it back', async () => {
    const w = await world();
    const before = await w.gen2.get('/api/announcements');
    assert.equal(before.status, 200);
    assert.equal((await w.gen2.get('/api/tickets/queue')).status, 403);

    // Added: the session they had ends at once, so the old portal tab stops working.
    assert.equal((await w.ha.put(w.member('gen2'), { role: 'Agent' })).status, 200);
    assert.equal((await w.gen2.get('/api/announcements')).status, 401);
    assert.equal((await w.gen2.get('/helpdesk')).headers.location, '/login.html');

    // Signed in again: the Helpdesk, and no portal.
    let again = await signIn(w.app, w.gen2.user);
    assert.equal(again.redirectTo, '/helpdesk');
    assert.equal((await again.get('/helpdesk')).status, 200);
    assert.equal((await again.get('/api/announcements')).body.error.code, 'helpdesk_only');
    assert.equal((await again.get('/api/tickets/queue')).status, 200);
    assert.deepEqual((await again.get('/api/me')).body.helpdesk, { role: 'Agent' });

    // Made a lead: a change of privilege too.
    assert.equal((await w.ha.put(w.member('gen2'), { role: 'Lead' })).status, 200);
    assert.equal((await again.get('/api/tickets/queue')).status, 401);
    again = await signIn(w.app, w.gen2.user);
    assert.equal((await again.get('/api/helpdesk/settings/teams')).status, 200);

    // Removed: back to the portal from the next request.
    assert.equal((await w.ha.del(w.member('gen2'))).status, 200);
    assert.equal((await again.get('/api/tickets/queue')).status, 401);
    const back = await signIn(w.app, w.gen2.user);
    assert.equal(back.redirectTo, '/');
    assert.equal((await back.get('/helpdesk')).status, 403);
    assert.equal((await back.get('/api/announcements')).status, 200);
    assert.equal((await back.get('/api/tickets/queue')).status, 403);
    assert.equal((await back.get('/api/me')).body.helpdesk, null);
  });

  test('a team that is switched off takes its members back to the portal', async () => {
    const w = await world();
    assert.equal((await w.agent.get('/api/tickets/queue')).status, 200);
    w.team.isActive = false;
    assert.equal((await w.agent.get('/api/tickets/mine')).status, 401);
    const back = await signIn(w.app, w.agent.user);
    assert.equal(back.redirectTo, '/');
    assert.equal((await back.get('/api/announcements')).status, 200);
  });
});

describe('notifications lead IT to the Helpdesk and employees to the portal (D135)', () => {
  test('new, assigned, replies and SLA alerts', async () => {
    const w = await world();
    const linkOf = (userId, key) => {
      const row = w.repo.notifications
        .filter((n) => n.userId === userId && n.templateKey === key && n.channel === 'inApp')
        .at(-1);
      return row ? JSON.parse(row.payload).link : undefined;
    };

    const t = await w.raise(w.gen);
    assert.equal(linkOf(w.lead.user.id, 'ticket.created'), `/helpdesk#tickets/${t.id}`);
    assert.equal(linkOf(w.gen.user.id, 'ticket.created'), `#tickets/${t.id}`);

    const assigned = await w.lead.patch(`/api/tickets/${t.id}`, {
      assigneeId: w.agent.user.id,
    });
    assert.equal(assigned.status, 200);
    assert.equal(linkOf(w.agent.user.id, 'ticket.assigned'), `/helpdesk#tickets/${t.id}`);

    assert.equal(
      (await w.agent.post(`/api/tickets/${t.id}/comments`, { body: 'On it.' })).status,
      201
    );
    assert.equal(linkOf(w.gen.user.id, 'ticket.comment'), `#tickets/${t.id}`);
    assert.equal(
      (await w.gen.post(`/api/tickets/${t.id}/comments`, { body: 'Thanks.' })).status,
      201
    );
    assert.equal(linkOf(w.agent.user.id, 'ticket.comment'), `/helpdesk#tickets/${t.id}`);

    // Past its resolution target (P3: 24 business hours, due Tuesday 15:00): the SLA alert.
    w.clock.now = cairo('2026-10-14', '12:00');
    await w.app.locals.tickets.watchSla();
    const breached = linkOf(w.lead.user.id, 'ticket.slaBreached');
    assert.equal(breached, `/helpdesk#tickets/${t.id}`);

    // The email says the same, with the Helpdesk's settings link for IT.
    const mail = (await w.app.locals.mailOutbox.list()).find(
      (m) => m.to.includes(EMAILS.lead) && m.html.includes('/helpdesk#tickets/')
    );
    assert.ok(mail, 'an email to the lead links to the Helpdesk');
    assert.match(mail.html, /\/helpdesk#notifications\/preferences/);
    assert.doesNotMatch(mail.html, /\/\/helpdesk/);
    const employee = (await w.app.locals.mailOutbox.list()).find((m) =>
      m.to.includes(EMAILS.gen)
    );
    assert.match(employee.html, new RegExp(`/#tickets/${t.id}`));
  });
});

describe('reports (D135)', () => {
  test('counts by status, priority, category, company and location; SLA; averages; CSV', async () => {
    const w = await world();
    // Three tickets on Sunday morning: two from Genesis, one from Masar.
    const a = await w.raise(w.gen, { priority: 'P2' });
    await w.raise(w.gen, { categoryId: w.category('Phone').id });
    await w.raise(w.msr);

    // The lead answers one in half an hour and resolves it two hours in.
    w.clock.now = cairo(SUNDAY, '09:30');
    assert.equal(
      (await w.lead.post(`/api/tickets/${a.id}/comments`, { body: 'Hi' })).status,
      201
    );
    w.clock.now = cairo(SUNDAY, '11:00');
    assert.equal(
      (await w.lead.patch(`/api/tickets/${a.id}`, { status: 'Resolved' })).status,
      200
    );
    // The requester confirms it half an hour later: the resolution clock stops there.
    w.clock.now = cairo(SUNDAY, '11:30');
    assert.equal((await w.gen.post(`/api/tickets/${a.id}/solved`, { rating: 5 })).status, 200);
    // Monday at noon: b and c have had no answer for more than eight business hours.
    w.clock.now = cairo('2026-10-12', '12:00');

    const report = (await w.agent.get(`/api/helpdesk/reports?from=${SUNDAY}&to=${SUNDAY}`))
      .body;
    assert.equal(report.total, 3);
    assert.deepEqual(report.byStatus.find((s) => s.status === 'Closed').count, 1);
    assert.deepEqual(report.byStatus.find((s) => s.status === 'Resolved').count, 0);
    assert.deepEqual(report.byStatus.find((s) => s.status === 'New').count, 2);
    assert.deepEqual(
      report.byPriority.map((p) => [p.priority, p.count]),
      [
        ['P1', 0],
        ['P2', 1],
        ['P3', 2],
        ['P4', 0],
      ]
    );
    assert.deepEqual(
      report.byCompany.map((x) => [x.code, x.count]),
      [
        ['GEN', 2],
        ['MSR', 1],
      ]
    );
    assert.equal(report.byCategory.find((x) => x.nameEn === 'Phone').count, 1);
    assert.equal(
      report.byLocation.reduce((sum, x) => sum + x.count, 0),
      3
    );
    assert.deepEqual(report.sla.firstResponse, { met: 1, breached: 2, pending: 0 });
    assert.deepEqual(report.sla.resolution, { met: 1, breached: 0, pending: 2 });
    assert.equal(report.averages.firstResponseMinutes, 30);
    assert.equal(report.averages.resolveMinutes, 150, 'to the confirmation, not to Resolved');

    // A range with nothing in it.
    const empty = (await w.lead.get('/api/helpdesk/reports?from=2026-09-01&to=2026-09-30'))
      .body;
    assert.equal(empty.total, 0);
    assert.equal(empty.averages.firstResponseMinutes, null);

    // Ranges the API will not run.
    for (const query of ['from=2026-10-12&to=2026-10-11', 'from=2025-01-01&to=2026-10-11']) {
      const bad = await w.lead.get(`/api/helpdesk/reports?${query}`);
      assert.deepEqual([bad.status, bad.body.error.code], [400, 'bad_range']);
    }
    assert.equal((await w.lead.get('/api/helpdesk/reports?from=yesterday')).status, 400);

    // The CSV: a header and one row per ticket.
    const csv = await w.agent.get(
      `/api/helpdesk/reports/export.csv?from=${SUNDAY}&to=${SUNDAY}`
    );
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(
      csv.headers['content-disposition'],
      /helpdesk-report-2026-10-11-to-2026-10-11/
    );
    const lines = csv.text.trim().split('\r\n');
    assert.equal(lines.length, 4);
    assert.match(lines[0], /"Number","Raised \(Cairo\)"/);
    assert.ok(lines.some((line) => line.includes(a.number) && line.includes('"met"')));

    // Not for anyone off the team.
    for (const key of ['ha', 'caGen', 'gen']) {
      assert.equal((await w[key].get('/api/helpdesk/reports')).status, 403, key);
      assert.equal((await w[key].get('/api/helpdesk/reports/export.csv')).status, 403, key);
    }
  });

  test('met, breached and still running', () => {
    const due = new Date('2026-10-11T10:00:00Z');
    const now = new Date('2026-10-11T12:00:00Z');
    assert.equal(targetState(new Date('2026-10-11T09:00:00Z'), due, now), 'met');
    assert.equal(targetState(due, due, now), 'met');
    assert.equal(targetState(new Date('2026-10-11T11:00:00Z'), due, now), 'breached');
    assert.equal(targetState(null, due, now), 'breached');
    assert.equal(targetState(null, due, new Date('2026-10-11T09:00:00Z')), 'pending');
  });
});
