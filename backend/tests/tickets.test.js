import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { zoneWallToUtc } from '../src/lib/sla.js';
import { createMemoryStorage } from '../src/lib/storage.js';
import { createMemoryUserRepo } from '../src/modules/auth/repo-memory.js';

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };

/** An instant from a Cairo day and clock time. */
const cairo = (ymd, hhmm) =>
  new Date(
    zoneWallToUtc(ymd, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), 'Africa/Cairo')
  );
const iso = (value) => new Date(value).toISOString();

/** Sunday 11 October 2026, 11:00 in Cairo: a working morning. */
const SUNDAY = '2026-10-11';
const START = cairo(SUNDAY, '11:00');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

function build() {
  const repo = createMemoryUserRepo();
  const storage = createMemoryStorage();
  const clock = { now: START };
  const app = createApp({
    config: DEV,
    userRepo: repo,
    storage,
    now: () => clock.now,
    authRateLimit: { limit: 100_000 },
    rateLimit: { limit: 100_000 },
  });
  return { app, repo, storage, clock };
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
    get: (path) => agent.get(path),
    post: (path, body = {}) => send('post', path, body),
    patch: (path, body) => send('patch', path, body),
    put: (path, body) => send('put', path, body),
    del: (path) => agent.delete(path).set('X-CSRF-Token', csrf),
    upload: (path, bytes) =>
      agent
        .post(path)
        .set('X-CSRF-Token', csrf)
        .set('Content-Type', 'application/octet-stream')
        .send(bytes),
  };
}

/**
 * Everyone the matrix needs, signed in: a HoldingAdmin, two CompanyAdmins who
 * are not on the IT team, two Genesis users and a Masar user, and the IT
 * team's lead and two agents (all three are MG Holding employees).
 */
async function world() {
  const w = build();
  const byEmail = (email) => w.repo.users.find((u) => u.email === email);
  const who = async (email) => signIn(w.app, byEmail(email));
  w.ha = await who('nadia.elsayed@mgholding.example');
  w.caGen = await who('hany.soliman@genesismining-eg.com');
  w.caMsr = await who('tarek.elmasry@masar.eg');
  w.gen = await who('salma.ibrahim@genesismining-eg.com');
  w.gen2 = await who('mahmoud.attia@genesismining-eg.com');
  w.msr = await who('yasmine.nabil@masar.eg');
  w.hq = await who('rania.farouk@masar.eg');
  w.lead = await who('omar.fahmy@mgholding.example');
  w.agent = await who('sherif.awad@mgholding.example');
  w.agent2 = await who('tamer.gad@mgholding.example');

  w.company = (code) => w.repo.companies.find((c) => c.code === code);
  w.team = w.repo.helpdesk.team[0];
  w.category = (nameEn) => w.repo.helpdesk.category.find((c) => c.nameEn === nameEn);
  w.location = (nameEn) => w.repo.helpdesk.location.find((l) => l.nameEn === nameEn);
  w.at = (ymd, hhmm) => {
    w.clock.now = cairo(ymd, hhmm);
  };

  /** Raises a ticket; "Laptop / PC" is a P3 category. */
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
  w.ticket = async (as, id) => {
    const res = await as.get(`/api/tickets/${id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };
  w.change = async (as, id, body) => {
    const res = await as.patch(`/api/tickets/${id}`, body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.ticket;
  };
  w.say = async (as, id, body, isInternal = false) => {
    const res = await as.post(`/api/tickets/${id}/comments`, { body, isInternal });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  w.row = (id) => w.repo.helpdesk.ticket.find((t) => t.id === id);
  /** Gives a ticket to an agent without the event and status change an assignment makes. */
  w.give = (id, agent) => {
    w.row(id).assigneeId = agent.user.id;
  };
  return w;
}

const types = (detail) => detail.timeline.map((e) => e.type);

describe('raising a ticket', () => {
  test('a user raises a ticket: numbered, new, with the category’s priority and its due dates', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);

    assert.equal(ticket.number, 'IT-2026-00001');
    assert.equal(ticket.status, 'New');
    assert.equal(ticket.priority, 'P3');
    assert.equal(ticket.source, 'portal');
    assert.equal(ticket.company.code, 'GEN');
    assert.equal(ticket.team.code, 'IT');
    assert.equal(ticket.category.nameEn, 'Laptop / PC');
    assert.equal(ticket.requester.id, w.gen.user.id);
    assert.equal(ticket.createdBy.id, w.gen.user.id);
    assert.equal(ticket.assignee, null);
    assert.equal(ticket.mine, true);
    // No seeded location is called "Eastern Desert Mine Site".
    assert.equal(ticket.location, null);

    // P3: first response in 8 business hours, resolution in 24, from 11:00 on
    // Sunday with the day ending at 17:00.
    assert.equal(iso(ticket.sla.firstResponseDueAt), iso(cairo('2026-10-12', '10:00')));
    assert.equal(iso(ticket.sla.resolveDueAt), iso(cairo('2026-10-13', '17:00')));
    assert.equal(iso(ticket.sla.dueAt), iso(ticket.sla.firstResponseDueAt));
    assert.equal(ticket.sla.state, 'on_track');
    assert.deepEqual(ticket.can, {
      comment: true,
      internalNote: false,
      attach: true,
      reopen: false,
      confirm: false,
      needsRating: false,
      notSolved: false,
      closeWithoutConfirmation: false,
      manage: false,
      work: false,
      reassign: false,
    });

    // The row is the requester's company's, for reporting.
    assert.equal(w.row(ticket.id).companyId, w.company('GEN').id);
  });

  test('the location defaults from the directory office when one matches', async () => {
    const w = await world();
    // Rania's office is "Cairo HQ"; the location is called "HQ Cairo".
    const options = (await w.hq.get('/api/tickets/options')).body;
    assert.equal(options.defaultLocationId, w.location('HQ Cairo').id);
    assert.equal(options.categories.length, 9);
    assert.equal(options.locations.length, 5);
    assert.equal(options.canLogForOthers, false);

    assert.equal((await w.raise(w.hq)).location.nameEn, 'HQ Cairo');
    // Chosen by hand, or left out on purpose.
    const site = w.location('Masar project site').id;
    assert.equal(
      (await w.raise(w.hq, { locationId: site })).location.nameEn,
      'Masar project site'
    );
    assert.equal((await w.raise(w.hq, { locationId: null })).location, null);

    const bad = await w.hq.post('/api/tickets', {
      subject: 'x',
      description: 'y',
      categoryId: w.category('Other').id,
      locationId: w.category('Other').id,
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'unknown_location');
  });

  test('a user chooses the urgency; the category default is only the starting value', async () => {
    const w = await world();
    const body = {
      subject: 'Printer',
      description: 'Jammed.',
      categoryId: w.category('Printer / scanner').id,
    };
    const chosen = await w.gen.post('/api/tickets', { ...body, priority: 'P1' });
    assert.equal(chosen.status, 201);
    assert.equal(chosen.body.ticket.priority, 'P1');
    // P1 due dates, not the category's.
    assert.equal(iso(chosen.body.ticket.sla.firstResponseDueAt), iso(cairo(SUNDAY, '12:00')));

    const left = await w.gen.post('/api/tickets', body);
    assert.equal(left.body.ticket.priority, 'P3');

    const bad = await w.gen.post('/api/tickets', { ...body, priority: 'P9' });
    assert.equal(bad.status, 400);

    // Afterwards only the team changes it, and the history says so.
    const own = chosen.body.ticket;
    assert.equal((await w.gen.patch(`/api/tickets/${own.id}`, { priority: 'P4' })).status, 403);
    w.give(own.id, w.agent);
    const changed = await w.change(w.agent, own.id, { priority: 'P4' });
    assert.equal(changed.priority, 'P4');
    const detail = await w.ticket(w.agent, own.id);
    assert.deepEqual(
      detail.timeline.filter((e) => e.type === 'priority').map((e) => [e.from, e.to]),
      [['P1', 'P4']]
    );
  });

  test('the team is told the requester’s language; the requester is not', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    const asAgent = await w.ticket(w.agent, ticket.id);
    assert.match(asAgent.ticket.requesterLanguage, /^(en|ar)$/);
    const asRequester = await w.ticket(w.gen, ticket.id);
    assert.equal('requesterLanguage' in asRequester.ticket, false);
  });

  test('a user cannot set the source or another requester', async () => {
    const w = await world();
    const base = {
      subject: 'Printer',
      description: 'Jammed.',
      categoryId: w.category('Printer / scanner').id,
    };
    for (const extra of [{ source: 'phone' }, { requesterId: w.gen2.user.id }]) {
      const res = await w.gen.post('/api/tickets', { ...base, ...extra });
      assert.equal(res.status, 403, JSON.stringify(extra));
    }
    assert.equal(w.repo.helpdesk.ticket.length, 0);

    const unknown = await w.gen.post('/api/tickets', { ...base, categoryId: w.team.id });
    assert.equal(unknown.body.error.code, 'unknown_category');
    const extraField = await w.gen.post('/api/tickets', { ...base, status: 'Closed' });
    assert.equal(extraField.status, 400);
  });

  test('numbers are consecutive and never shared when many are raised at once', async () => {
    const w = await world();
    const people = [w.gen, w.gen2, w.msr, w.hq, w.agent];
    const made = await Promise.all(
      Array.from({ length: 30 }, (_, i) => w.raise(people[i % people.length]))
    );
    const numbers = made.map((t) => t.number).sort();
    assert.equal(new Set(numbers).size, 30);
    assert.equal(numbers[0], 'IT-2026-00001');
    assert.equal(numbers[29], 'IT-2026-00030');
  });

  test('the sequence starts again each year, by Cairo’s calendar', async () => {
    const w = await world();
    await w.raise(w.gen);
    // 00:30 on 1 January in Cairo is still 31 December in UTC.
    w.clock.now = new Date('2026-12-31T22:30:00Z');
    assert.equal((await w.raise(w.gen)).number, 'IT-2027-00001');
    w.clock.now = new Date('2026-12-31T21:30:00Z');
    assert.equal((await w.raise(w.gen)).number, 'IT-2026-00002');
  });

  test('an agent logs a ticket for someone who phoned', async () => {
    const w = await world();
    const ticket = await w.raise(w.agent, {
      requesterId: w.gen.user.id,
      source: 'phone',
      priority: 'P1',
      assetTag: 'LT-0042',
    });
    assert.equal(ticket.requester.id, w.gen.user.id);
    assert.equal(ticket.createdBy.id, w.agent.user.id);
    assert.equal(ticket.source, 'phone');
    assert.equal(ticket.priority, 'P1');
    assert.equal(ticket.assetTag, 'LT-0042');
    assert.equal(ticket.company.code, 'GEN');
    assert.equal(ticket.mine, false);
    // P1: one hour to answer, four to resolve.
    assert.equal(iso(ticket.sla.firstResponseDueAt), iso(cairo(SUNDAY, '12:00')));
    assert.equal(iso(ticket.sla.resolveDueAt), iso(cairo(SUNDAY, '15:00')));

    // It is the requester's ticket: they find it under their own.
    const mine = (await w.gen.get('/api/tickets/mine')).body;
    assert.deepEqual(
      mine.items.map((t) => t.number),
      [ticket.number]
    );
    assert.equal((await w.ticket(w.gen, ticket.id)).ticket.mine, true);
    // And not the agent's own.
    assert.equal((await w.agent.get('/api/tickets/mine')).body.total, 0);

    const nobody = await w.agent.post('/api/tickets', {
      subject: 'x',
      description: 'y',
      categoryId: w.category('Other').id,
      requesterId: w.team.id,
    });
    assert.equal(nobody.body.error.code, 'unknown_requester');
  });
});

describe('who can see a ticket', () => {
  async function three() {
    const w = await world();
    w.t1 = await w.raise(w.gen, { subject: 'Salma laptop keyboard' });
    w.t2 = await w.raise(w.gen2, { subject: 'Mahmoud printer tray' });
    w.t3 = await w.raise(w.msr, { subject: 'Yasmine VPN token' });
    const file = await w.gen2.upload(`/api/tickets/${w.t2.id}/attachments?name=tray.png`, PNG);
    assert.equal(file.status, 201, JSON.stringify(file.body));
    w.file2 = file.body;
    return w;
  }

  test('a user sees only their own: not a colleague’s, not another company’s', async () => {
    const w = await three();

    // By list, with every status and with a search that names the others.
    for (const query of [
      '',
      '?status=all',
      '?q=printer',
      '?q=VPN',
      '?q=IT-2026',
      '?status=New',
    ]) {
      const res = await w.gen.get(`/api/tickets/mine${query}`);
      assert.equal(res.status, 200);
      assert.ok(
        res.body.items.every((t) => t.id === w.t1.id),
        `only her own with "${query}"`
      );
    }
    assert.equal((await w.gen.get('/api/tickets/mine?q=printer')).body.total, 0);
    assert.equal((await w.gen.get('/api/tickets/mine?q=IT-2026')).body.total, 1);

    // By id, and by every route under the id: all 404, same as a ticket that never existed.
    for (const other of [w.t2, w.t3]) {
      assert.equal((await w.gen.get(`/api/tickets/${other.id}`)).status, 404);
      assert.equal(
        (await w.gen.post(`/api/tickets/${other.id}/comments`, { body: 'hello' })).status,
        404
      );
      assert.equal((await w.gen.post(`/api/tickets/${other.id}/reopen`)).status, 404);
      // Changing a ticket is IT's alone: refused before any ticket is looked up.
      assert.equal(
        (await w.gen.patch(`/api/tickets/${other.id}`, { priority: 'P1' })).status,
        403
      );
      assert.equal(
        (await w.gen.upload(`/api/tickets/${other.id}/attachments?name=a.png`, PNG)).status,
        404
      );
    }
    const missing = await w.gen.get('/api/tickets/00000000-0000-4000-8000-00000000dead');
    assert.equal(missing.status, 404);
    const hidden = (await w.gen.get(`/api/tickets/${w.t2.id}`)).body.error;
    assert.deepEqual(
      [missing.body.error.code, missing.body.error.message],
      [hidden.code, hidden.message]
    );

    // By attachment address: her colleague's file, under his ticket or grafted onto hers.
    assert.equal((await w.gen.get(w.file2.url)).status, 404);
    assert.equal(
      (await w.gen.get(`/api/tickets/${w.t1.id}/attachments/${w.file2.id}`)).status,
      404
    );
    assert.equal((await w.msr.get(w.file2.url)).status, 404);
    assert.equal((await w.gen2.get(w.file2.url)).status, 200);

    // By count: her own one, and nothing about the queue.
    assert.deepEqual((await w.gen.get('/api/tickets/counts')).body, { mine: 1, queue: null });

    // The queue and its helpers are not hers.
    for (const path of ['/queue', '/queue/options', '/canned-replies', '/queue?q=printer']) {
      assert.equal((await w.gen.get(`/api/tickets${path}`)).status, 403, path);
    }

    // The Masar user, the same from the other side.
    const msr = (await w.msr.get('/api/tickets/mine?status=all')).body;
    assert.deepEqual(
      msr.items.map((t) => t.id),
      [w.t3.id]
    );
    assert.equal((await w.msr.get(`/api/tickets/${w.t1.id}`)).status, 404);
  });

  test('an IT agent sees every company’s tickets', async () => {
    const w = await three();
    const queue = (await w.agent.get('/api/tickets/queue')).body;
    assert.equal(queue.total, 3);
    assert.deepEqual(queue.items.map((t) => t.company.code).sort(), ['GEN', 'GEN', 'MSR']);
    for (const t of [w.t1, w.t2, w.t3]) {
      const detail = await w.ticket(w.agent, t.id);
      assert.equal(detail.ticket.can.manage, true);
      assert.equal(detail.ticket.mine, false);
    }
    assert.equal((await w.agent.get(w.file2.url)).status, 200);
    assert.equal((await w.agent.get('/api/tickets/queue?q=VPN')).body.total, 1);
    assert.deepEqual((await w.agent.get('/api/tickets/counts')).body, {
      mine: 0,
      queue: { unassigned: 3, breachingSoon: 0, assignedToMe: 0, canAssign: false },
    });
    assert.equal((await w.lead.get('/api/tickets/counts')).body.queue.canAssign, true);
    assert.equal((await w.ha.get('/api/tickets/counts')).body.queue, null);
    const byCompany = await w.agent.get(`/api/tickets/queue?companyId=${w.company('MSR').id}`);
    assert.deepEqual(
      byCompany.body.items.map((t) => t.id),
      [w.t3.id]
    );
  });

  test('a CompanyAdmin who is not on the IT team sees none, not even their company’s', async () => {
    const w = await three();
    assert.equal((await w.caGen.get('/api/tickets/mine?status=all')).body.total, 0);
    assert.equal((await w.caGen.get(`/api/tickets/${w.t1.id}`)).status, 404);
    assert.equal((await w.caGen.get(w.file2.url)).status, 404);
    assert.equal((await w.caGen.get('/api/tickets/queue')).status, 403);
    assert.deepEqual((await w.caGen.get('/api/tickets/counts')).body, { mine: 0, queue: null });

    // Their own ticket is theirs like anyone's.
    const own = await w.raise(w.caGen);
    assert.equal((await w.caGen.get('/api/tickets/mine')).body.total, 1);
    assert.equal((await w.ticket(w.caGen, own.id)).ticket.can.manage, false);
  });

  test('a HoldingAdmin who is not on the IT team sees none but their own (D135)', async () => {
    const w = await three();
    assert.equal((await w.ha.get('/api/tickets/queue')).status, 403);
    assert.equal((await w.ha.get('/api/tickets/queue/options')).status, 403);
    assert.equal((await w.ha.get('/api/tickets/canned-replies')).status, 403);
    assert.equal((await w.ha.get('/api/helpdesk/reports')).status, 403);
    for (const t of [w.t1, w.t2, w.t3]) {
      assert.equal((await w.ha.get(`/api/tickets/${t.id}`)).status, 404);
      assert.equal(
        (await w.ha.post(`/api/tickets/${t.id}/comments`, { body: 'Hello' })).status,
        404
      );
      assert.equal((await w.ha.patch(`/api/tickets/${t.id}`, { priority: 'P1' })).status, 403);
    }
    assert.equal((await w.ha.get(w.file2.url)).status, 404);
    assert.deepEqual((await w.ha.get('/api/tickets/counts')).body, { mine: 0, queue: null });

    // Their own ticket is theirs like anyone's, the requester's view.
    const own = await w.raise(w.ha);
    const view = await w.ticket(w.ha, own.id);
    assert.equal(view.ticket.can.manage, false);
    assert.equal(view.ticket.can.reassign, false);
  });

  test('a team that serves only some companies shows its agents only those', async () => {
    const w = await three();
    // Restrict IT to Masar, as its lead would.
    const res = await w.lead.patch(`/api/helpdesk/settings/teams/${w.team.id}`, {
      servesAllCompanies: false,
      companyIds: [w.company('MSR').id],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const queue = (await w.agent.get('/api/tickets/queue')).body;
    assert.deepEqual(
      queue.items.map((t) => t.id),
      [w.t3.id]
    );
    assert.equal((await w.agent.get(`/api/tickets/${w.t1.id}`)).status, 404);
    assert.equal((await w.agent.get(w.file2.url)).status, 404);
    assert.equal((await w.agent.get('/api/tickets/counts')).body.queue.unassigned, 1);
    assert.deepEqual(
      (await w.agent.get('/api/tickets/queue/options')).body.companies.map((c) => c.code),
      ['MSR']
    );

    // A Genesis user is no longer offered IT's categories and cannot raise one.
    assert.equal((await w.gen.get('/api/tickets/options')).body.categories.length, 0);
    const refused = await w.gen.post('/api/tickets', {
      subject: 'x',
      description: 'y',
      categoryId: w.category('Other').id,
    });
    assert.equal(refused.body.error.code, 'unknown_category');
    // Her old ticket is still hers.
    assert.equal((await w.gen.get(`/api/tickets/${w.t1.id}`)).status, 200);
  });

  test('someone taken off the team loses the queue at once', async () => {
    const w = await three();
    assert.equal((await w.agent.get(`/api/tickets/${w.t1.id}`)).status, 200);
    const res = await w.ha.del(
      `/api/admin/it-team/teams/${w.team.id}/members/${w.agent.user.id}`
    );
    assert.equal(res.status, 200);
    // Their privileges changed, so their session ended (D126, D135).
    assert.equal((await w.agent.get(`/api/tickets/${w.t1.id}`)).status, 401);
    const again = await signIn(w.app, w.agent.user);
    assert.equal((await again.get(`/api/tickets/${w.t1.id}`)).status, 404);
    assert.equal((await again.get('/api/tickets/queue')).status, 403);
    assert.deepEqual((await again.get('/api/tickets/counts')).body, { mine: 0, queue: null });
  });

  test('an internal note, its file and its trace are for the team only', async () => {
    const w = await three();
    const after = await w.say(w.agent, w.t1.id, 'Probably the same fault as LT-0031.', true);
    const note = after.timeline.find((e) => e.type === 'comment');
    assert.equal(note.isInternal, true);
    const file = await w.agent.upload(
      `/api/tickets/${w.t1.id}/attachments?name=diag.log&commentId=${note.comment.id}`,
      Buffer.from('disk 0: 3 reallocated sectors\n')
    );
    assert.equal(file.status, 201, JSON.stringify(file.body));
    assert.equal(file.body.isInternal, true);

    // The requester's view has neither, and the ticket is still unanswered.
    const hers = await w.ticket(w.gen, w.t1.id);
    assert.deepEqual(types(hers), ['created']);
    assert.ok(!JSON.stringify(hers).includes('LT-0031'));
    assert.ok(!JSON.stringify(hers).includes('diag.log'));
    assert.equal(hers.ticket.status, 'New');
    assert.equal(hers.ticket.firstRespondedAt, null);
    assert.equal((await w.gen.get(file.body.url)).status, 404);
    assert.equal((await w.agent2.get(file.body.url)).status, 200);

    // She cannot write one, or attach to it.
    const own = await w.gen.post(`/api/tickets/${w.t1.id}/comments`, {
      body: 'secret',
      isInternal: true,
    });
    assert.equal(own.status, 403);
    const graft = await w.gen.upload(
      `/api/tickets/${w.t1.id}/attachments?name=a.png&commentId=${note.comment.id}`,
      PNG
    );
    assert.equal(graft.status, 404);

    assert.deepEqual(types(await w.ticket(w.agent2, w.t1.id)), [
      'created',
      'comment',
      'attachment',
    ]);
  });
});

describe('who works a ticket (D122)', () => {
  const refusal = (res) => [res.status, res.body.error?.code];

  test('an agent reads and writes internal notes on a ticket that is not theirs, nothing more', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent2);

    // Reading and the staff view are untouched.
    const detail = await w.ticket(w.agent, t.id);
    assert.equal(detail.ticket.can.manage, true);
    assert.equal(detail.ticket.can.work, false);
    assert.equal(detail.ticket.can.comment, false);
    assert.equal(detail.ticket.can.internalNote, true);
    assert.equal(detail.ticket.can.reopen, false);

    // An internal note, and a file on it, are fine.
    const note = await w.say(w.agent, t.id, 'Same fault as LT-0031.', true);
    const commentId = note.timeline.at(-1).comment.id;
    const file = await w.agent.upload(
      `/api/tickets/${t.id}/attachments?name=boot.log&commentId=${commentId}`,
      Buffer.from('ERROR 0x7B')
    );
    assert.equal(file.status, 201);

    // Everything else is refused, and nothing changed.
    const before = JSON.stringify(w.row(t.id));
    const attempts = [
      await w.agent.patch(`/api/tickets/${t.id}`, { status: 'Resolved' }),
      await w.agent.patch(`/api/tickets/${t.id}`, { priority: 'P1' }),
      await w.agent.patch(`/api/tickets/${t.id}`, { categoryId: w.category('Phone').id }),
      await w.agent.post(`/api/tickets/${t.id}/comments`, { body: 'Hello', isInternal: false }),
      await w.agent.upload(`/api/tickets/${t.id}/attachments?name=a.png`, PNG),
    ];
    for (const res of attempts) assert.deepEqual(refusal(res), [403, 'not_assignee']);
    assert.equal(JSON.stringify(w.row(t.id)), before);

    // Assigning keeps its own answer (D118).
    const assign = await w.agent.patch(`/api/tickets/${t.id}`, { assigneeId: w.agent.user.id });
    assert.deepEqual(refusal(assign), [403, 'lead_only']);
  });

  test('an unassigned ticket is nobody’s to work except a Lead', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    const refused = await w.agent.patch(`/api/tickets/${t.id}`, { status: 'Open' });
    assert.deepEqual(refusal(refused), [403, 'not_assignee']);
    assert.equal(
      (await w.agent.post(`/api/tickets/${t.id}/comments`, { body: 'Hi' })).status,
      403
    );

    assert.equal((await w.change(w.lead, t.id, { priority: 'P2' })).priority, 'P2');
    await w.say(w.lead, t.id, 'Looking at it.');
    // A HoldingAdmin is not on the team: nothing of it is theirs (D135).
    assert.equal((await w.ha.patch(`/api/tickets/${t.id}`, { priority: 'P3' })).status, 403);
    assert.equal(
      (await w.ha.post(`/api/tickets/${t.id}/comments`, { body: 'And me.' })).status,
      404
    );
  });

  test('the assignee works it; a Lead can whoever has it', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    await w.change(w.lead, t.id, { assigneeId: w.agent.user.id });

    const mine = await w.ticket(w.agent, t.id);
    assert.equal(mine.ticket.can.work, true);
    assert.equal(mine.ticket.can.comment, true);
    await w.say(w.agent, t.id, 'On it.');
    assert.equal((await w.change(w.agent, t.id, { priority: 'P2' })).priority, 'P2');
    assert.equal(
      (await w.change(w.agent, t.id, { categoryId: w.category('Phone').id })).category.id,
      w.category('Phone').id
    );
    const resolved = await w.change(w.agent, t.id, { status: 'Resolved' });
    assert.equal(resolved.status, 'Resolved');

    // The other agent may not reopen it; the Lead may.
    const no = await w.agent2.post(`/api/tickets/${t.id}/reopen`);
    assert.deepEqual(refusal(no), [403, 'not_assignee']);
    await w.change(w.lead, t.id, { status: 'Open' });
    await w.say(w.lead, t.id, 'Checked.');
    assert.equal((await w.change(w.lead, t.id, { status: 'Pending' })).status, 'Pending');

    // Once reassigned, the first agent has lost the controls.
    await w.change(w.lead, t.id, { assigneeId: w.agent2.user.id });
    assert.equal((await w.ticket(w.agent, t.id)).ticket.can.work, false);
    assert.equal((await w.agent.patch(`/api/tickets/${t.id}`, { status: 'Open' })).status, 403);
  });

  test('an agent’s own ticket is theirs to answer as its requester, not to work', async () => {
    const w = await world();
    const t = await w.raise(w.agent, { subject: 'My own laptop' });
    const view = await w.ticket(w.agent, t.id);
    assert.equal(view.ticket.can.comment, true, 'as the requester');
    assert.equal(view.ticket.can.work, false);
    await w.say(w.agent, t.id, 'More detail.');
    const refused = await w.agent.patch(`/api/tickets/${t.id}`, { priority: 'P1' });
    assert.deepEqual(refusal(refused), [403, 'not_assignee']);
  });
});

describe('the life of a ticket', () => {
  test('the first public answer from an agent is the first response', async () => {
    const w = await world();
    const t = await w.raise(w.gen);

    // The requester adding detail is not a response.
    await w.say(w.gen, t.id, 'It also beeps three times.');
    assert.equal(w.row(t.id).firstRespondedAt, null);
    assert.equal(w.row(t.id).status, 'New');

    w.give(t.id, w.agent);
    w.at(SUNDAY, '11:40');
    const answered = await w.say(w.agent, t.id, 'Looking at it now.');
    assert.equal(answered.ticket.status, 'Open');
    assert.equal(iso(answered.ticket.firstRespondedAt), iso(cairo(SUNDAY, '11:40')));
    // The date in force is now the resolution.
    assert.equal(iso(answered.ticket.sla.dueAt), iso(answered.ticket.sla.resolveDueAt));
    assert.deepEqual(types(answered), ['created', 'comment', 'comment', 'status']);

    // A second answer does not move it.
    w.at(SUNDAY, '13:00');
    const again = await w.say(w.lead, t.id, 'Parts ordered.');
    assert.equal(iso(again.ticket.firstRespondedAt), iso(cairo(SUNDAY, '11:40')));
  });

  test('waiting on the requester stops the clock; their reply starts it again', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    const resolveDue = cairo('2026-10-13', '17:00');
    await w.say(w.agent, t.id, 'Which model is it?');

    w.at(SUNDAY, '12:00');
    const waiting = await w.change(w.agent, t.id, { status: 'Pending' });
    assert.equal(waiting.status, 'Pending');
    assert.equal(waiting.sla.state, 'paused');
    assert.equal(w.row(t.id).slaActive, false);

    // An agent's note does not resume it.
    await w.say(w.agent, t.id, 'Chased by phone.', true);
    assert.equal(w.row(t.id).status, 'Pending');

    // She answers on Monday at 10:00: Sunday 12:00–17:00 and Monday
    // 08:00–10:00 did not count, seven business hours in all.
    w.at('2026-10-12', '10:00');
    const back = await w.say(w.gen, t.id, 'A ThinkPad T14.');
    assert.equal(back.ticket.status, 'Open');
    assert.equal(back.ticket.sla.pausedMinutes, 420);
    assert.equal(back.ticket.sla.state, 'on_track');
    assert.equal(
      iso(back.ticket.sla.resolveDueAt),
      // Seven business hours after Tuesday 17:00: Wednesday 15:00.
      iso(cairo('2026-10-14', '15:00'))
    );
    assert.notEqual(iso(back.ticket.sla.resolveDueAt), iso(resolveDue));
    assert.deepEqual(types(back).slice(-2), ['comment', 'status']);
    const resumed = back.timeline.at(-1);
    assert.deepEqual([resumed.from, resumed.to], ['Pending', 'Open']);
    assert.equal(resumed.actor.id, w.gen.user.id);

    // A second pause adds to the first.
    await w.change(w.agent, t.id, { status: 'Pending' });
    w.at('2026-10-12', '11:30');
    const once = await w.change(w.agent, t.id, { status: 'Open' });
    assert.equal(once.sla.pausedMinutes, 510);
    assert.equal(iso(once.sla.resolveDueAt), iso(cairo('2026-10-14', '16:30')));
  });

  test('a change of priority works the due dates out again', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    assert.equal(iso(t.sla.resolveDueAt), iso(cairo('2026-10-13', '17:00')));

    const urgent = await w.change(w.agent, t.id, { priority: 'P1' });
    assert.equal(urgent.priority, 'P1');
    // From when it was raised, not from now.
    assert.equal(iso(urgent.sla.firstResponseDueAt), iso(cairo(SUNDAY, '12:00')));
    assert.equal(iso(urgent.sla.resolveDueAt), iso(cairo(SUNDAY, '15:00')));

    w.at(SUNDAY, '12:30');
    assert.equal((await w.ticket(w.agent, t.id)).ticket.sla.state, 'breached');
    const low = await w.change(w.agent, t.id, { priority: 'P4' });
    assert.equal(low.sla.state, 'on_track');
    assert.equal(iso(low.sla.resolveDueAt), iso(cairo('2026-10-15', '15:00')));

    const detail = await w.ticket(w.gen, t.id);
    assert.deepEqual(types(detail), ['created', 'priority', 'priority']);
    assert.deepEqual([detail.timeline[2].from, detail.timeline[2].to], ['P1', 'P4']);

    // Not hers to change.
    const refused = await w.gen.patch(`/api/tickets/${t.id}`, { priority: 'P1' });
    assert.equal(refused.status, 403);
  });

  test('assigning: only a lead assigns, reassigns or unassigns (D118, D135)', async () => {
    const w = await world();
    const t = await w.raise(w.gen);

    // An agent can neither take a ticket nor hand one to someone else.
    const own = await w.agent.patch(`/api/tickets/${t.id}`, { assigneeId: w.agent.user.id });
    assert.equal(own.status, 403);
    assert.equal(own.body.error.code, 'lead_only');
    const other = await w.agent.patch(`/api/tickets/${t.id}`, { assigneeId: w.agent2.user.id });
    assert.equal(other.status, 403);
    assert.equal((await w.ticket(w.agent, t.id)).ticket.assignee, null);

    // The lead assigns; the ticket is no longer new, and the agent sees no control.
    const assigned = await w.change(w.lead, t.id, { assigneeId: w.agent.user.id });
    assert.equal(assigned.assignee.id, w.agent.user.id);
    assert.equal(assigned.status, 'Open', 'someone has it: no longer new');
    assert.equal((await w.agent.get('/api/tickets/counts')).body.queue.assignedToMe, 1);
    assert.equal((await w.ticket(w.agent, t.id)).ticket.can.reassign, false);
    assert.equal((await w.ticket(w.lead, t.id)).ticket.can.reassign, true);

    // The assignee cannot hand it on or give it back; a colleague cannot take it.
    for (const [who, assigneeId] of [
      [w.agent, w.agent2.user.id],
      [w.agent, null],
      [w.agent2, w.agent2.user.id],
    ]) {
      const res = await who.patch(`/api/tickets/${t.id}`, { assigneeId });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'lead_only');
    }

    // The lead moves it and can put it back. A HoldingAdmin no longer assigns.
    const moved = await w.change(w.lead, t.id, { assigneeId: w.agent2.user.id });
    assert.equal(moved.assignee.id, w.agent2.user.id);
    const ha = await w.ha.patch(`/api/tickets/${t.id}`, { assigneeId: w.agent.user.id });
    assert.equal(ha.status, 403);
    await w.change(w.lead, t.id, { assigneeId: w.agent.user.id });
    const released = await w.change(w.lead, t.id, { assigneeId: null });
    assert.equal(released.assignee, null);
    await w.change(w.lead, t.id, { assigneeId: w.agent.user.id });

    // Only to an active member of the team: not a requester, not an admin who is not on it.
    for (const outsider of [w.gen.user.id, w.ha.user.id, w.team.id]) {
      const res = await w.lead.patch(`/api/tickets/${t.id}`, { assigneeId: outsider });
      assert.equal(res.body.error?.code, 'unknown_assignee');
    }

    // Every change is in the history, with who made it.
    const events = (await w.ticket(w.gen, t.id)).timeline.filter((e) => e.type === 'assigned');
    assert.equal(events.length, 5);
    assert.equal(events[0].from, null);
    assert.equal(events[0].to.displayNameEn, 'Sherif Awad');
    assert.equal(events[0].actor.id, w.lead.user.id);
    assert.equal(events[3].to, null);
  });

  test('an agent changes the category within the team', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    const changed = await w.change(w.agent, t.id, { categoryId: w.category('Phone').id });
    assert.equal(changed.category.nameEn, 'Phone');
    const event = (await w.ticket(w.agent, t.id)).timeline.at(-1);
    assert.deepEqual(
      [event.type, event.from.nameEn, event.to.nameEn],
      ['category', 'Laptop / PC', 'Phone']
    );
    const bad = await w.agent.patch(`/api/tickets/${t.id}`, { categoryId: w.team.id });
    assert.equal(bad.body.error.code, 'unknown_category');
    assert.equal((await w.agent.patch(`/api/tickets/${t.id}`, {})).status, 400);
    assert.equal((await w.agent.patch(`/api/tickets/${t.id}`, { status: 'New' })).status, 400);
  });

  test('a resolved ticket stays open with its clock running, and nothing closes it (D143)', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    await w.say(w.agent, t.id, 'Replaced the battery.');

    // Resolved on Wednesday 14 October at 12:00, after its Tuesday 17:00 target.
    w.at('2026-10-14', '12:00');
    const resolved = await w.change(w.agent, t.id, { status: 'Resolved' });
    assert.equal(resolved.status, 'Resolved');
    assert.equal(iso(resolved.resolvedAt), iso(cairo('2026-10-14', '12:00')));
    assert.equal(resolved.closedAt, null);
    assert.equal(resolved.sla.state, 'breached', 'the clock is still running');
    assert.equal(w.row(t.id).slaActive, true);
    assert.equal(w.row(t.id).slaPausedAt, null);
    assert.equal(w.row(t.id).slaPausedMinutes, 0);

    // Still an open ticket: in "My tickets", in the count and in the queue.
    assert.equal((await w.gen.get('/api/tickets/mine')).body.total, 1);
    assert.equal((await w.gen.get('/api/tickets/counts')).body.mine, 1);
    assert.equal((await w.agent.get('/api/tickets/queue')).body.total, 1);

    // The auto-close rule is gone: months later nothing has happened to it.
    assert.equal(w.app.locals.tickets.closeResolved, undefined);
    w.at('2027-03-01', '09:00');
    await w.app.locals.tickets.remindResolved();
    const later = await w.ticket(w.gen, t.id);
    assert.equal(later.ticket.status, 'Resolved');
    assert.equal(later.ticket.closedAt, null);
    assert.equal(later.ticket.can.confirm, true);
  });

  test('only the requester confirms or says it is not solved; IT cannot answer for them', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    await w.change(w.agent, t.id, { status: 'Resolved' });
    const before = JSON.stringify(w.row(t.id));

    const outsiders = [
      [w.agent, 403],
      [w.agent2, 403],
      [w.lead, 403],
      [w.gen2, 404],
      [w.msr, 404],
      [w.caGen, 404],
      [w.ha, 404],
    ];
    for (const [who, status] of outsiders) {
      const yes = await who.post(`/api/tickets/${t.id}/solved`, { rating: 5 });
      const no = await who.post(`/api/tickets/${t.id}/not-solved`, { reason: 'Still black.' });
      assert.equal(yes.status, status, `solved by ${who.user.email}`);
      assert.equal(no.status, status, `not solved by ${who.user.email}`);
    }
    assert.equal(JSON.stringify(w.row(t.id)), before, 'nothing changed');

    const own = (await w.ticket(w.gen, t.id)).ticket.can;
    assert.deepEqual([own.confirm, own.needsRating, own.notSolved], [true, true, true]);
    for (const who of [w.agent, w.lead]) {
      const can = (await w.ticket(who, t.id)).ticket.can;
      assert.deepEqual([can.confirm, can.notSolved], [false, false]);
    }
  });

  test('IT cannot rate their own work', async () => {
    const w = await world();
    const mine = await w.raise(w.agent, { subject: 'My own laptop' });
    await w.change(w.lead, mine.id, { assigneeId: w.agent.user.id });
    await w.change(w.agent, mine.id, { status: 'Resolved' });
    assert.equal((await w.ticket(w.agent, mine.id)).ticket.can.confirm, false);
    const yes = await w.agent.post(`/api/tickets/${mine.id}/solved`, { rating: 5 });
    assert.deepEqual([yes.status, yes.body.error.code], [403, 'own_work']);
    const no = await w.agent.post(`/api/tickets/${mine.id}/not-solved`, { reason: 'Meh.' });
    assert.deepEqual([no.status, no.body.error.code], [403, 'own_work']);
    assert.equal(w.row(mine.id).rating, null);

    // The same agent, asking for something another agent fixed, answers as anyone would.
    const other = await w.raise(w.agent, { subject: 'Second screen' });
    await w.change(w.lead, other.id, { assigneeId: w.agent2.user.id });
    await w.change(w.agent2, other.id, { status: 'Resolved' });
    assert.equal(
      (await w.agent.post(`/api/tickets/${other.id}/solved`, { rating: 4 })).status,
      200
    );
  });

  test('"Yes, solved" needs a rating from 1 to 5, closes the ticket, and the rating never changes', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    await w.say(w.agent, t.id, 'Replaced the battery.');
    w.at(SUNDAY, '13:00');
    await w.change(w.agent, t.id, { status: 'Resolved' });
    const yes = (body) => w.gen.post(`/api/tickets/${t.id}/solved`, body);

    // The rating is required, whole, from 1 to 5; the words are 1000 characters at most.
    const none = await yes({});
    assert.deepEqual([none.status, none.body.error.code], [400, 'rating_required']);
    for (const bad of [{ rating: 0 }, { rating: 6 }, { rating: 3.5 }, { rating: '5' }]) {
      assert.equal((await yes(bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await yes({ rating: 5, feedback: 'x'.repeat(1001) })).status, 400);
    assert.equal((await yes({ rating: 5, note: 'x' })).status, 400, 'unknown field');
    assert.equal(w.row(t.id).status, 'Resolved', 'nothing closed yet');

    w.at(SUNDAY, '15:00');
    const done = await yes({ rating: 4, feedback: '  Quick and kind.  ' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const closed = done.body.ticket;
    assert.equal(closed.status, 'Closed');
    assert.equal(closed.closeMode, 'confirmed');
    assert.equal(iso(closed.closedAt), iso(cairo(SUNDAY, '15:00')));
    assert.equal(closed.rating.stars, 4);
    assert.equal(closed.rating.feedback, 'Quick and kind.');
    assert.equal(closed.sla.state, 'met');
    assert.equal(w.row(t.id).slaActive, false, 'the clock has stopped');
    assert.equal(closed.can.confirm, false);
    const last = done.body.timeline.at(-1);
    assert.deepEqual(
      [last.type, last.actor.id, last.from, last.to],
      ['confirmed', w.gen.user.id, 'Resolved', 'Closed']
    );
    // The team sees what was said; asking again is refused.
    assert.equal((await w.ticket(w.agent, t.id)).ticket.rating.feedback, 'Quick and kind.');
    assert.equal((await yes({ rating: 5 })).body.error.code, 'not_resolved');

    // Reopened and resolved again, the ticket keeps its rating: it cannot be rated twice.
    const reopened = await w.change(w.lead, t.id, { status: 'Open' });
    assert.equal(reopened.closeMode, null);
    assert.equal(reopened.rating.stars, 4);
    await w.change(w.agent, t.id, { status: 'Resolved' });
    assert.equal((await w.ticket(w.gen, t.id)).ticket.can.needsRating, false);
    const again = await yes({ rating: 1 });
    assert.deepEqual([again.status, again.body.error.code], [409, 'already_rated']);
    const second = await yes({});
    assert.equal(second.status, 200);
    assert.equal(second.body.ticket.rating.stars, 4);
    assert.equal(second.body.ticket.status, 'Closed');

    // 1000 characters is the limit, not a character less.
    const long = await w.raise(w.gen, { subject: 'Printer' });
    w.give(long.id, w.agent);
    await w.change(w.agent, long.id, { status: 'Resolved' });
    const big = await w.gen.post(`/api/tickets/${long.id}/solved`, {
      rating: 5,
      feedback: 'x'.repeat(1000),
    });
    assert.equal(big.status, 200);
  });

  test('the resolution clock keeps running until the requester confirms', async () => {
    const w = await world();
    const early = await w.raise(w.gen);
    const late = await w.raise(w.gen, { subject: 'A second fault' });
    // Both are due on Tuesday 13 October at 17:00.
    for (const t of [early, late]) {
      w.give(t.id, w.agent);
      await w.say(w.agent, t.id, 'On it.');
    }
    w.at('2026-10-12', '10:00');
    for (const t of [early, late]) await w.change(w.agent, t.id, { status: 'Resolved' });

    w.at('2026-10-12', '14:00');
    const inTime = await w.gen.post(`/api/tickets/${early.id}/solved`, { rating: 5 });
    assert.equal(inTime.body.ticket.sla.state, 'met');

    // IT resolved the other one in time too, but nobody confirmed it until Wednesday.
    w.at('2026-10-14', '09:00');
    assert.equal((await w.ticket(w.gen, late.id)).ticket.sla.state, 'breached');
    const slow = await w.gen.post(`/api/tickets/${late.id}/solved`, { rating: 5 });
    assert.equal(slow.body.ticket.sla.state, 'missed');
  });

  test('"No, still a problem" needs a reason, reopens the ticket and keeps the clock running', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    await w.say(w.agent, t.id, 'Replaced the battery.');
    w.at('2026-10-12', '10:00');
    await w.change(w.agent, t.id, { status: 'Resolved' });
    const no = (body) => w.gen.post(`/api/tickets/${t.id}/not-solved`, body);

    for (const bad of [{}, { reason: '' }, { reason: '   ' }, { reason: 'x'.repeat(1001) }]) {
      assert.equal((await no(bad)).status, 400, JSON.stringify(bad).slice(0, 40));
    }
    assert.equal(w.row(t.id).status, 'Resolved');

    w.at('2026-10-12', '11:00');
    const res = await no({ reason: 'It still shows a black screen.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const reopened = res.body.ticket;
    assert.equal(reopened.status, 'Open');
    assert.equal(reopened.resolvedAt, null);
    assert.equal(reopened.sla.pausedMinutes, 0, 'the clock never stopped');
    assert.notEqual(reopened.sla.state, 'paused');
    assert.deepEqual(types(res.body).slice(-2), ['comment', 'notSolved']);
    const said = res.body.timeline.at(-2);
    assert.equal(said.comment.body, 'It still shows a black screen.');
    assert.equal(said.actor.id, w.gen.user.id);
    assert.equal(res.body.timeline.at(-1).to, 'Open');

    // Answering twice is refused: it is no longer waiting.
    assert.equal((await no({ reason: 'Again.' })).body.error.code, 'not_resolved');
    assert.equal((await w.gen.post(`/api/tickets/${t.id}/solved`, { rating: 5 })).status, 409);
  });

  test('a lead closes without confirmation: a reason, audited, shown to the team, counted apart; an agent cannot', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    const close = (as, body) => as.post(`/api/tickets/${t.id}/close`, body);

    // Not resolved or pending: there is nothing to close this way yet.
    const early = await close(w.lead, { reason: 'No reply.' });
    assert.deepEqual([early.status, early.body.error.code], [409, 'not_resolved']);

    await w.change(w.agent, t.id, { status: 'Resolved' });
    const byAgent = await close(w.agent, { reason: 'No reply.' });
    assert.deepEqual([byAgent.status, byAgent.body.error.code], [403, 'lead_only']);
    assert.equal(
      (await close(w.gen, { reason: 'No reply.' })).status,
      403,
      'not the requester'
    );
    assert.equal(
      (await close(w.ha, { reason: 'No reply.' })).status,
      403,
      'not an administrator'
    );
    assert.equal((await close(w.lead, {})).status, 400, 'a reason is required');
    assert.equal((await close(w.lead, { reason: '  ' })).status, 400);
    assert.equal(w.row(t.id).status, 'Resolved');

    w.at('2026-10-14', '10:00');
    const res = await close(w.lead, { reason: 'The requester is not responding.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ticket.status, 'Closed');
    assert.equal(res.body.ticket.closeMode, 'lead');
    assert.equal(res.body.ticket.closeReason, 'The requester is not responding.');
    assert.equal(res.body.ticket.rating, null);
    assert.equal(w.row(t.id).slaActive, false);
    const last = res.body.timeline.at(-1);
    assert.deepEqual([last.type, last.actor.id], ['closedByLead', w.lead.user.id]);

    // The requester sees that IT closed it, not the lead's note.
    const mine = (await w.ticket(w.gen, t.id)).ticket;
    assert.equal(mine.closeMode, 'lead');
    assert.equal(mine.closeReason, null);
    assert.equal(
      (await w.ticket(w.agent, t.id)).ticket.closeReason,
      'The requester is not responding.'
    );

    const audit = w.repo.auditLogs.filter(
      (a) => a.action === 'ticket.close_without_confirmation'
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actorId, w.lead.user.id);
    assert.equal(audit[0].entity, 'Ticket');
    assert.equal(audit[0].entityId, t.id);
    assert.equal(audit[0].companyId, w.company('GEN').id);
    assert.match(audit[0].after, /The requester is not responding\./);

    assert.equal((await close(w.lead, { reason: 'Again.' })).body.error.code, 'ticket_closed');

    // A ticket waiting on its requester can be closed this way too.
    const quiet = await w.raise(w.gen, { subject: 'Printer' });
    w.give(quiet.id, w.agent);
    await w.change(w.agent, quiet.id, { status: 'Pending' });
    const pending = await w.lead.post(`/api/tickets/${quiet.id}/close`, {
      reason: 'No answer.',
    });
    assert.equal(pending.body.ticket.closeMode, 'lead');
  });

  test('a reply from the requester reopens a resolved ticket without stopping the clock', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    await w.say(w.agent, t.id, 'Fixed remotely.');
    w.at(SUNDAY, '13:00');
    await w.change(w.agent, t.id, { status: 'Resolved' });

    w.at('2026-10-12', '09:00');
    const reply = await w.say(w.gen, t.id, 'It happened again this morning.');
    assert.equal(reply.ticket.status, 'Open');
    assert.equal(reply.ticket.resolvedAt, null);
    // A resolved ticket is open and counts: no minutes were set aside.
    assert.equal(reply.ticket.sla.pausedMinutes, 0);
    assert.equal(reply.ticket.sla.state, 'on_track');
    assert.deepEqual(types(reply).slice(-2), ['comment', 'reopened']);
  });

  test('the requester may reopen a closed ticket for seven days after it was resolved, and no longer', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    const cannot = await w.gen.post(`/api/tickets/${t.id}/reopen`);
    assert.equal(cannot.status, 409);
    assert.equal(cannot.body.error.code, 'not_resolved');

    // Resolved on Sunday 11 October, confirmed on Monday the 12th at 09:00.
    await w.change(w.agent, t.id, { status: 'Resolved' });
    w.at('2026-10-12', '09:00');
    assert.equal((await w.gen.post(`/api/tickets/${t.id}/solved`, { rating: 3 })).status, 200);
    assert.equal(w.row(t.id).status, 'Closed');

    // Day six: still inside the window, though it has closed.
    w.at('2026-10-17', '11:00');
    assert.equal((await w.ticket(w.gen, t.id)).ticket.can.reopen, true);
    const reopened = await w.gen.post(`/api/tickets/${t.id}/reopen`);
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.ticket.status, 'Open');
    assert.equal(reopened.body.ticket.closedAt, null);
    assert.notEqual(
      reopened.body.ticket.sla.state,
      'breached',
      'the closed days were set aside'
    );
    assert.equal(reopened.body.timeline.at(-1).type, 'reopened');
    // The clock stood still while it was closed: Monday 09:00 to 17:00, then Tuesday to Thursday.
    assert.equal(reopened.body.ticket.sla.pausedMinutes, 480 + 3 * 540);
    assert.equal(reopened.body.ticket.rating.stars, 3, 'the rating stays');

    // Resolved again, and this time left for eight days: past the window the requester
    // can still answer "no" but not reopen by hand; the team is not bound by it.
    await w.change(w.agent, t.id, { status: 'Resolved' });
    w.at('2026-10-25', '11:01');
    const detail = await w.ticket(w.gen, t.id);
    assert.equal(detail.ticket.can.reopen, false);
    assert.equal(detail.ticket.can.notSolved, true);
    const tooLate = await w.gen.post(`/api/tickets/${t.id}/reopen`);
    assert.equal(tooLate.status, 409);
    assert.equal(tooLate.body.error.code, 'reopen_window_closed');
    assert.equal(w.row(t.id).status, 'Resolved');

    assert.equal((await w.ticket(w.agent, t.id)).ticket.can.reopen, true);
    const byAgent = await w.change(w.agent, t.id, { status: 'Open' });
    assert.equal(byAgent.status, 'Open');
  });
});

describe('attachments', () => {
  test('allowed files are stored and come back only as downloads', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    w.give(t.id, w.agent);
    const up = await w.gen.upload(
      `/api/tickets/${t.id}/attachments?name=${encodeURIComponent('../شاشة 1.png')}`,
      PNG
    );
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.fileName, 'شاشة 1.png');
    assert.equal(up.body.contentType, 'image/png');
    assert.equal(up.body.size, PNG.length);
    assert.equal(w.storage.files.size, 1);
    assert.match([...w.storage.files.keys()][0], /^ticket-[0-9a-f-]{36}\.png$/);

    const down = await w.gen
      .get(up.body.url)
      .buffer(true)
      .parse((res, done) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    assert.equal(down.status, 200);
    assert.ok(down.body.equals(PNG));
    assert.match(down.headers['content-disposition'], /^attachment; filename="/);
    assert.match(down.headers['content-disposition'], /filename\*=UTF-8''/);
    assert.equal(down.headers['x-content-type-options'], 'nosniff');
    assert.match(down.headers['content-security-policy'], /default-src 'none'/);

    // On a comment of her own.
    const said = await w.say(w.gen, t.id, 'The error log.');
    const commentId = said.timeline.at(-1).comment.id;
    const log = await w.gen.upload(
      `/api/tickets/${t.id}/attachments?name=boot.log&commentId=${commentId}`,
      Buffer.from('ERROR 0x7B\r\n')
    );
    assert.equal(log.status, 201);
    const detail = await w.ticket(w.agent, t.id);
    assert.equal(detail.attachments.length, 1, 'with the description');
    const comment = detail.timeline.find((e) => e.comment?.id === commentId).comment;
    assert.deepEqual(
      comment.attachments.map((a) => a.fileName),
      ['boot.log']
    );
    // Not on somebody else's comment.
    const agentSaid = await w.say(w.agent, t.id, 'Thanks.');
    const theirs = agentSaid.timeline.findLast((e) => e.type === 'comment').comment.id;
    const graft = await w.gen.upload(
      `/api/tickets/${t.id}/attachments?name=a.png&commentId=${theirs}`,
      PNG
    );
    assert.equal(graft.status, 404);
  });

  test('archives, executables, renamed and oversized files are refused', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    const path = (name) => `/api/tickets/${t.id}/attachments?name=${name}`;
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(128)]);
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('a.txt')]);

    for (const [name, bytes] of [
      ['tool.exe', exe],
      ['tool.png', exe],
      ['notes.txt', exe],
      ['files.zip', zip],
      ['files.docx', zip],
      ['run.bat', Buffer.from('@echo off')],
      ['page.html', Buffer.from('<script>alert(1)</script>')],
      ['noextension', PNG],
    ]) {
      const res = await w.gen.upload(path(name), bytes);
      assert.equal(res.status, 415, name);
      assert.equal(res.body.error.code, 'unsupported_file');
    }
    assert.equal((await w.gen.upload(path('empty.txt'), Buffer.alloc(0))).status, 400);
    assert.equal((await w.gen.upload(`/api/tickets/${t.id}/attachments`, PNG)).status, 400);

    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    assert.equal((await w.gen.upload(path('big.png'), big)).status, 413);
    assert.equal(w.storage.files.size, 0);
    assert.equal(w.repo.helpdesk.attachment.length, 0);
  });

  test('five files at a time, for the description and for each comment', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    for (let i = 1; i <= 5; i += 1) {
      const res = await w.gen.upload(`/api/tickets/${t.id}/attachments?name=p${i}.png`, PNG);
      assert.equal(res.status, 201);
    }
    const sixth = await w.gen.upload(`/api/tickets/${t.id}/attachments?name=p6.png`, PNG);
    assert.equal(sixth.status, 409);
    assert.equal(sixth.body.error.code, 'too_many_attachments');
    assert.equal(w.storage.files.size, 5);

    // A comment has five of its own.
    const said = await w.say(w.gen, t.id, 'More.');
    const commentId = said.timeline.at(-1).comment.id;
    const more = await w.gen.upload(
      `/api/tickets/${t.id}/attachments?name=p7.png&commentId=${commentId}`,
      PNG
    );
    assert.equal(more.status, 201);
  });
});

describe('the agent queue', () => {
  async function busy() {
    const w = await world();
    const log = (requester, body) =>
      w.raise(w.agent, { requesterId: requester.user.id, ...body });
    // Raised at 11:00. P1 is due at 12:00, P2 at 15:00, P3 on Monday 10:00.
    w.p3 = await w.raise(w.gen, { subject: 'Slow laptop' });
    w.p1 = await log(w.msr, { subject: 'Site network down', priority: 'P1' });
    w.p2 = await log(w.gen2, {
      subject: 'Mailbox full',
      priority: 'P2',
      categoryId: w.category('Email & Teams').id,
      locationId: w.location('Dakhla site').id,
    });
    w.p4 = await log(w.hq, { subject: 'Second monitor', priority: 'P4' });
    w.queue = async (query = '') => {
      const res = await w.agent.get(`/api/tickets/queue${query}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body.items.map((t) => t.subject);
    };
    return w;
  }

  test('nearest due date first', async () => {
    const w = await busy();
    assert.deepEqual(await w.queue(), [
      'Site network down',
      'Mailbox full',
      'Slow laptop',
      'Second monitor',
    ]);

    // Paused and finished tickets go below the running ones.
    for (const p of [w.p1, w.p2]) w.give(p.id, w.agent);
    await w.change(w.agent, w.p1.id, { status: 'Pending' });
    assert.deepEqual(await w.queue(), [
      'Mailbox full',
      'Slow laptop',
      'Second monitor',
      'Site network down',
    ]);
    await w.change(w.agent, w.p2.id, { status: 'Resolved' });
    // A resolved ticket is still open, with its clock running: it keeps its place.
    assert.deepEqual(await w.queue(), [
      'Mailbox full',
      'Slow laptop',
      'Second monitor',
      'Site network down',
    ]);
    assert.deepEqual(await w.queue('?status=Resolved'), ['Mailbox full']);
    assert.equal((await w.queue('?status=all')).length, 4);

    const paged = (await w.agent.get('/api/tickets/queue?pageSize=2&page=2')).body;
    assert.deepEqual([paged.total, paged.items.length, paged.page], [4, 2, 2]);
  });

  test('filters: priority, assignee, company, location, category, search', async () => {
    const w = await busy();
    assert.deepEqual(await w.queue('?priority=P1'), ['Site network down']);
    assert.deepEqual(await w.queue(`?companyId=${w.company('GEN').id}`), [
      'Mailbox full',
      'Slow laptop',
    ]);
    assert.deepEqual(await w.queue(`?locationId=${w.location('Dakhla site').id}`), [
      'Mailbox full',
    ]);
    assert.deepEqual(await w.queue(`?categoryId=${w.category('Email & Teams').id}`), [
      'Mailbox full',
    ]);
    assert.deepEqual(await w.queue('?q=monitor'), ['Second monitor']);
    assert.deepEqual(await w.queue(`?q=${w.p1.number}`), ['Site network down']);

    await w.change(w.lead, w.p1.id, { assigneeId: w.agent.user.id });
    await w.change(w.lead, w.p3.id, { assigneeId: w.agent2.user.id });
    assert.deepEqual(await w.queue('?assignee=me'), ['Site network down']);
    assert.deepEqual(await w.queue(`?assignee=${w.agent2.user.id}`), ['Slow laptop']);
    assert.deepEqual(await w.queue('?assignee=unassigned'), ['Mailbox full', 'Second monitor']);
    assert.equal((await w.agent.get('/api/tickets/queue?assignee=nobody')).status, 400);

    const options = (await w.agent.get('/api/tickets/queue/options')).body;
    assert.deepEqual(options.agents.map((a) => a.displayNameEn).sort(), [
      'Omar Fahmy',
      'Sherif Awad',
      'Tamer Gad',
    ]);
    assert.equal(options.agents.find((a) => a.displayNameEn === 'Omar Fahmy').role, 'Lead');
    assert.equal(options.companies.length, 3);
    assert.equal(options.categories.length, 9);
  });

  test('SLA state: on track, at risk from 75%, breached; and the counts beside the nav', async () => {
    const w = await busy();
    const all = ['Site network down', 'Mailbox full', 'Slow laptop', 'Second monitor'];
    assert.deepEqual(await w.queue('?sla=on_track'), all);
    assert.deepEqual(await w.queue('?sla=at_risk'), []);
    assert.equal((await w.agent.get('/api/tickets/counts')).body.queue.breachingSoon, 0);

    // 11:45: three quarters of P1's hour.
    w.at(SUNDAY, '11:45');
    assert.deepEqual(await w.queue('?sla=at_risk'), ['Site network down']);
    assert.deepEqual(await w.queue('?sla=on_track'), all.slice(1));
    assert.deepEqual((await w.agent.get('/api/tickets/counts')).body.queue, {
      unassigned: 4,
      breachingSoon: 1,
      assignedToMe: 0,
      canAssign: false,
    });

    // 14:00: P1 is an hour late; P2 (answer by 15:00) is at risk.
    w.at(SUNDAY, '14:00');
    assert.deepEqual(await w.queue('?sla=breached'), ['Site network down']);
    assert.deepEqual(await w.queue('?sla=at_risk'), ['Mailbox full']);
    assert.equal((await w.agent.get('/api/tickets/counts')).body.queue.breachingSoon, 2);
    const row = (await w.agent.get('/api/tickets/queue?sla=breached')).body.items[0];
    assert.equal(row.sla.state, 'breached');

    // Answering P1 puts it on its resolution target (15:00): at risk, not breached.
    for (const p of [w.p1, w.p2, w.p3]) w.give(p.id, w.agent);
    await w.say(w.agent, w.p1.id, 'On my way to the comms room.');
    assert.deepEqual(await w.queue('?sla=breached'), []);
    assert.deepEqual(await w.queue('?sla=at_risk'), ['Site network down', 'Mailbox full']);

    // A paused ticket is in none of the three.
    await w.change(w.agent, w.p2.id, { status: 'Pending' });
    assert.deepEqual(await w.queue('?sla=at_risk'), ['Site network down']);
    assert.equal((await w.agent.get('/api/tickets/counts')).body.queue.breachingSoon, 1);

    // The requester's own count is what is still open for them: a resolved ticket
    // is open until they confirm it.
    assert.equal((await w.gen.get('/api/tickets/counts')).body.mine, 1);
    await w.change(w.agent, w.p3.id, { status: 'Resolved' });
    assert.deepEqual((await w.gen.get('/api/tickets/counts')).body, { mine: 1, queue: null });
    assert.equal((await w.gen.get('/api/tickets/mine')).body.total, 1);
    assert.equal((await w.gen.get('/api/tickets/mine?status=attention')).body.total, 1);
    assert.equal((await w.gen.get('/api/tickets/mine?status=Resolved')).body.total, 1);
    assert.equal(
      (await w.gen.post(`/api/tickets/${w.p3.id}/solved`, { rating: 5 })).status,
      200
    );
    assert.deepEqual((await w.gen.get('/api/tickets/counts')).body, { mine: 0, queue: null });
    assert.equal((await w.gen.get('/api/tickets/mine')).body.total, 0);
    assert.equal((await w.gen.get('/api/tickets/mine?status=Closed')).body.total, 1);
  });

  test('canned replies: the team’s active ones, for the team', async () => {
    const w = await busy();
    const list = (await w.agent.get('/api/tickets/canned-replies')).body.items;
    assert.deepEqual(
      list.map((r) => r.titleEn),
      [
        'Password reset steps',
        'Printer driver install',
        'VPN setup',
        'Laptop ready for collection',
      ]
    );
    assert.ok(list.every((r) => r.bodyEn && r.bodyAr && r.titleAr));

    w.repo.helpdesk.canned[1].isActive = false;
    assert.equal((await w.agent.get('/api/tickets/canned-replies')).body.items.length, 3);
    assert.equal(
      (await w.agent.get(`/api/tickets/canned-replies?teamId=${w.team.id}`)).body.items.length,
      3
    );
    assert.equal(
      (await w.agent.get(`/api/tickets/canned-replies?teamId=${w.company('GEN').id}`)).status,
      404
    );
    assert.equal((await w.lead.get('/api/tickets/canned-replies')).body.items.length, 3);
    assert.equal((await w.ha.get('/api/tickets/canned-replies')).status, 403);
  });
});

describe('helpdesk configuration (D135)', () => {
  const audit = (w, action) => w.repo.auditLogs.filter((row) => row.action === action);
  const base = '/api/helpdesk/settings';
  const membership = '/api/admin/it-team/teams';

  test('an IT lead keeps the IT settings, and every change is audited', async () => {
    const w = await world();
    const before = w.repo.auditLogs.length;
    const ok = (res, status = 200) => {
      assert.equal(res.status, status, JSON.stringify(res.body));
      return res.body;
    };

    const [own] = ok(await w.lead.get(`${base}/teams`)).items;
    assert.equal(own.id, w.team.id);
    ok(await w.lead.patch(`${base}/teams/${w.team.id}`, { nameEn: 'IT Helpdesk' }));
    // Retiring a team is not a lead's to do from a screen.
    assert.equal(
      (await w.lead.patch(`${base}/teams/${w.team.id}`, { isActive: false })).status,
      400
    );

    const category = ok(
      await w.lead.post(`${base}/categories`, {
        teamId: w.team.id,
        nameEn: 'Badge reader',
        nameAr: 'قارئ البطاقات',
        defaultPriority: 'P2',
      }),
      201
    );
    ok(await w.lead.patch(`${base}/categories/${category.id}`, { isActive: false }));
    const sameName = await w.lead.post(`${base}/categories`, {
      teamId: w.team.id,
      nameEn: 'Phone',
      nameAr: 'هاتف',
    });
    assert.equal(sameName.body.error.code, 'name_taken');

    const location = ok(
      await w.lead.post(`${base}/locations`, { nameEn: 'Aswan office', nameAr: 'مكتب أسوان' }),
      201
    );
    ok(await w.lead.patch(`${base}/locations/${location.id}`, { sortOrder: 9 }));

    const policies = [
      { priority: 'P1', firstResponseMinutes: 30, resolveMinutes: 120 },
      { priority: 'P2', firstResponseMinutes: 120, resolveMinutes: 480 },
      { priority: 'P3', firstResponseMinutes: 480, resolveMinutes: 1440 },
      { priority: 'P4', firstResponseMinutes: 960, resolveMinutes: 2400 },
    ];
    const withSla = ok(await w.lead.put(`${base}/teams/${w.team.id}/sla`, { policies }));
    assert.deepEqual(withSla.sla, policies);
    const backwards = await w.lead.put(`${base}/teams/${w.team.id}/sla`, {
      policies: [{ ...policies[0], firstResponseMinutes: 500 }, ...policies.slice(1)],
    });
    assert.equal(backwards.status, 400);

    const calendar = {
      timeZone: 'Africa/Cairo',
      workingDays: [0, 1, 2, 3, 4, 6],
      startMin: 540,
      endMin: 1080,
    };
    assert.deepEqual(
      ok(await w.lead.put(`${base}/teams/${w.team.id}/calendar`, calendar)).calendar,
      calendar
    );
    const badZone = await w.lead.put(`${base}/teams/${w.team.id}/calendar`, {
      ...calendar,
      timeZone: 'UTC+2',
    });
    assert.equal(badZone.status, 400);

    const holiday = ok(
      await w.lead.post(`${base}/holidays`, {
        date: '2026-12-24',
        nameEn: 'Company day',
        nameAr: 'يوم الشركة',
      }),
      201
    );
    ok(await w.lead.patch(`${base}/holidays/${holiday.id}`, { date: '2026-12-27' }));
    const taken = await w.lead.post(`${base}/holidays`, {
      date: '2026-10-06',
      nameEn: 'x',
      nameAr: 'y',
    });
    assert.equal(taken.body.error.code, 'date_taken');
    assert.equal((await w.lead.del(`${base}/holidays/${holiday.id}`)).status, 204);
    const list = ok(await w.lead.get(`${base}/holidays?year=2027`));
    assert.equal(list.items.length, 5);

    const reply = ok(
      await w.lead.post(`${base}/canned-replies`, {
        teamId: w.team.id,
        titleEn: 'Asset returned',
        titleAr: 'تم إرجاع الجهاز',
        bodyEn: 'We have received the device.',
        bodyAr: 'استلمنا الجهاز.',
      }),
      201
    );
    ok(await w.lead.patch(`${base}/canned-replies/${reply.id}`, { sortOrder: 1 }));

    // One audit row per write, by the lead, holding-wide, with before and after.
    const rows = w.repo.auditLogs.slice(before);
    assert.deepEqual(
      rows.map((row) => row.action),
      [
        'helpdesk.team.update',
        'helpdesk.category.create',
        'helpdesk.category.update',
        'helpdesk.location.create',
        'helpdesk.location.update',
        'helpdesk.sla.update',
        'helpdesk.calendar.update',
        'helpdesk.holiday.create',
        'helpdesk.holiday.update',
        'helpdesk.holiday.remove',
        'helpdesk.canned.create',
        'helpdesk.canned.update',
      ]
    );
    for (const row of rows) {
      assert.equal(row.actorId, w.lead.user.id);
      assert.equal(row.companyId, null);
      assert.ok(row.entityId, row.action);
    }
    const [sla] = audit(w, 'helpdesk.sla.update');
    assert.equal(JSON.parse(sla.before).P1.firstResponseMinutes, 60);
    assert.equal(JSON.parse(sla.after).P1.firstResponseMinutes, 30);

    // The new targets and hours apply to the next ticket: 09:00–18:00, P1 30 minutes.
    const next = await w.raise(w.agent, { requesterId: w.gen.user.id, priority: 'P1' });
    assert.equal(iso(next.sla.firstResponseDueAt), iso(cairo(SUNDAY, '11:30')));
  });

  test('a new holiday moves the due date of tickets raised after it', async () => {
    const w = await world();
    w.at('2026-10-15', '16:00'); // Thursday
    const res = await w.lead.post(`${base}/holidays`, {
      date: '2026-10-18',
      nameEn: 'Extra day',
      nameAr: 'يوم إضافي',
    });
    assert.equal(res.status, 201);
    const t = await w.raise(w.agent, { requesterId: w.gen.user.id, priority: 'P1' });
    // One hour on Thursday, Sunday is off, three on Monday.
    assert.equal(iso(t.sla.resolveDueAt), iso(cairo('2026-10-19', '11:00')));
  });

  test('the HoldingAdmin decides who is on the IT team, audited, and sees nothing else of it', async () => {
    const w = await world();
    const before = w.repo.auditLogs.length;
    const ok = (res, status = 200) => {
      assert.equal(res.status, status, JSON.stringify(res.body));
      return res.body;
    };

    // The list: who is on each team, and nothing of its settings or tickets.
    const [team] = ok(await w.ha.get(membership)).items;
    assert.deepEqual(Object.keys(team).sort(), [
      'code',
      'id',
      'isActive',
      'members',
      'nameAr',
      'nameEn',
    ]);
    assert.deepEqual(team.members.map((m) => [m.displayNameEn, m.role]).sort(), [
      ['Omar Fahmy', 'Lead'],
      ['Sherif Awad', 'Agent'],
      ['Tamer Gad', 'Agent'],
    ]);

    const path = (user) => `${membership}/${w.team.id}/members/${user.id}`;
    ok(await w.ha.put(path(w.gen2.user), { role: 'Agent' }));
    ok(await w.ha.put(path(w.gen2.user), { role: 'Lead' }));
    const after = ok(await w.ha.del(path(w.gen2.user)));
    assert.equal(after.members.length, 3);
    assert.equal((await w.ha.del(path(w.gen2.user))).status, 404);
    const stranger = await w.ha.put(`${membership}/${w.team.id}/members/${w.team.id}`, {
      role: 'Agent',
    });
    assert.equal(stranger.body.error.code, 'unknown_user');

    assert.deepEqual(
      w.repo.auditLogs.slice(before).map((row) => [row.action, row.actorId]),
      [
        ['helpdesk.member.add', w.ha.user.id],
        ['helpdesk.member.update', w.ha.user.id],
        ['helpdesk.member.remove', w.ha.user.id],
      ]
    );
    const [removed] = audit(w, 'helpdesk.member.remove');
    assert.equal(JSON.parse(removed.before).role, 'Lead');

    // None of the settings, and no tickets.
    for (const res of await Promise.all([
      w.ha.get(`${base}/teams`),
      w.ha.get(`${base}/categories`),
      w.ha.get(`${base}/locations`),
      w.ha.post(`${base}/holidays`, { date: '2026-11-02', nameEn: 'x', nameAr: 'y' }),
      w.ha.put(`${base}/teams/${w.team.id}/sla`, { policies: [] }),
      w.ha.get('/api/helpdesk/reports'),
      w.ha.get('/api/tickets/queue'),
    ])) {
      assert.equal(res.status, 403);
    }
  });

  test('the IT team always keeps an active lead', async () => {
    const w = await world();
    const path = (user) => `${membership}/${w.team.id}/members/${user.id}`;
    const answer = async (pending) => {
      const res = await pending;
      return [res.status, res.body.error?.code];
    };

    // Omar is the only lead: he can be neither demoted nor removed.
    assert.deepEqual(await answer(w.ha.put(path(w.lead.user), { role: 'Agent' })), [
      409,
      'last_lead',
    ]);
    assert.deepEqual(await answer(w.ha.del(path(w.lead.user))), [409, 'last_lead']);

    // A second lead who has left the company does not count.
    assert.equal((await w.ha.put(path(w.agent.user), { role: 'Lead' })).status, 200);
    w.repo.users.find((u) => u.id === w.agent.user.id).isActive = false;
    assert.deepEqual(await answer(w.ha.del(path(w.lead.user))), [409, 'last_lead']);

    // An active second lead does: then Omar may step down.
    w.repo.users.find((u) => u.id === w.agent.user.id).isActive = true;
    const res = await w.ha.put(path(w.lead.user), { role: 'Agent' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body.members.filter((m) => m.role === 'Lead').map((m) => m.displayNameEn),
      ['Sherif Awad']
    );
  });

  test('only IT leads touch IT settings, and only the HoldingAdmin changes the team', async () => {
    const w = await world();
    const before = w.repo.auditLogs.length;
    const reply = w.repo.helpdesk.canned[0];
    for (const who of [w.agent, w.caGen, w.gen, w.ha]) {
      const tries = await Promise.all([
        who.get(`${base}/teams`),
        who.get(`${base}/categories`),
        who.get(`${base}/canned-replies`),
        who.get(`${base}/locations`),
        who.get(`${base}/holidays`),
        who.patch(`${base}/canned-replies/${reply.id}`, { titleEn: 'Hacked' }),
        who.patch(`${base}/categories/${w.category('Phone').id}`, { isActive: false }),
        who.post(`${base}/holidays`, { date: '2026-11-02', nameEn: 'x', nameAr: 'y' }),
      ]);
      for (const res of tries) assert.equal(res.status, 403);
    }
    for (const who of [w.agent, w.lead, w.caGen, w.gen]) {
      const tries = await Promise.all([
        who.get(membership),
        who.put(`${membership}/${w.team.id}/members/${who.user.id}`, { role: 'Lead' }),
        who.del(`${membership}/${w.team.id}/members/${w.agent2.user.id}`),
      ]);
      for (const res of tries) assert.equal(res.status, 403);
    }
    assert.equal(reply.titleEn, 'Password reset steps');
    assert.equal(w.repo.auditLogs.length, before);
  });
});
