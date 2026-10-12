import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { startTicketAutoClose } from '../src/jobs/closeResolvedTickets.js';
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
      manage: false,
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
      assert.equal(
        (await w.gen.patch(`/api/tickets/${other.id}`, { priority: 'P1' })).status,
        404
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
      queue: { unassigned: 3, breachingSoon: 0, assignedToMe: 0 },
    });
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

  test('a HoldingAdmin sees everything', async () => {
    const w = await three();
    assert.equal((await w.ha.get('/api/tickets/queue')).body.total, 3);
    const detail = await w.ticket(w.ha, w.t3.id);
    assert.equal(detail.ticket.can.manage, true);
    assert.equal(detail.ticket.can.reassign, true);
  });

  test('a team that serves only some companies shows its agents only those', async () => {
    const w = await three();
    // Restrict IT to Masar, as an administrator would.
    const res = await w.ha.patch(`/api/admin/helpdesk/teams/${w.team.id}`, {
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
      `/api/admin/helpdesk/teams/${w.team.id}/members/${w.agent.user.id}`
    );
    assert.equal(res.status, 200);
    assert.equal((await w.agent.get(`/api/tickets/${w.t1.id}`)).status, 404);
    assert.equal((await w.agent.get('/api/tickets/queue')).status, 403);
    assert.deepEqual((await w.agent.get('/api/tickets/counts')).body, { mine: 0, queue: null });
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

describe('the life of a ticket', () => {
  test('the first public answer from an agent is the first response', async () => {
    const w = await world();
    const t = await w.raise(w.gen);

    // The requester adding detail is not a response.
    await w.say(w.gen, t.id, 'It also beeps three times.');
    assert.equal(w.row(t.id).firstRespondedAt, null);
    assert.equal(w.row(t.id).status, 'New');

    w.at(SUNDAY, '11:40');
    const answered = await w.say(w.agent, t.id, 'Looking at it now.');
    assert.equal(answered.ticket.status, 'Open');
    assert.equal(iso(answered.ticket.firstRespondedAt), iso(cairo(SUNDAY, '11:40')));
    // The date in force is now the resolution.
    assert.equal(iso(answered.ticket.sla.dueAt), iso(answered.ticket.sla.resolveDueAt));
    assert.deepEqual(types(answered), ['created', 'comment', 'comment', 'status']);

    // A second answer does not move it.
    w.at(SUNDAY, '13:00');
    const again = await w.say(w.agent2, t.id, 'Parts ordered.');
    assert.equal(iso(again.ticket.firstRespondedAt), iso(cairo(SUNDAY, '11:40')));
  });

  test('waiting on the requester stops the clock; their reply starts it again', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    const resolveDue = cairo('2026-10-13', '17:00');
    await w.say(w.agent, t.id, 'Which model is it?');

    w.at(SUNDAY, '12:00');
    const waiting = await w.change(w.agent, t.id, { status: 'WaitingOnRequester' });
    assert.equal(waiting.status, 'WaitingOnRequester');
    assert.equal(waiting.sla.state, 'paused');
    assert.equal(w.row(t.id).slaActive, false);

    // An agent's note does not resume it.
    await w.say(w.agent, t.id, 'Chased by phone.', true);
    assert.equal(w.row(t.id).status, 'WaitingOnRequester');

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
    assert.deepEqual([resumed.from, resumed.to], ['WaitingOnRequester', 'Open']);
    assert.equal(resumed.actor.id, w.gen.user.id);

    // A second pause adds to the first.
    await w.change(w.agent, t.id, { status: 'WaitingOnRequester' });
    w.at('2026-10-12', '11:30');
    const once = await w.change(w.agent, t.id, { status: 'Open' });
    assert.equal(once.sla.pausedMinutes, 510);
    assert.equal(iso(once.sla.resolveDueAt), iso(cairo('2026-10-14', '16:30')));
  });

  test('a change of priority works the due dates out again', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
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

  test('assigning: an agent takes or hands on their own, a lead moves anyone’s', async () => {
    const w = await world();
    const t = await w.raise(w.gen);

    const taken = await w.change(w.agent, t.id, { assigneeId: w.agent.user.id });
    assert.equal(taken.assignee.id, w.agent.user.id);
    assert.equal(taken.status, 'Open', 'someone has it: no longer new');
    assert.equal((await w.agent.get('/api/tickets/counts')).body.queue.assignedToMe, 1);

    // A colleague cannot take it from them.
    const grab = await w.agent2.patch(`/api/tickets/${t.id}`, { assigneeId: w.agent2.user.id });
    assert.equal(grab.status, 403);
    assert.equal(grab.body.error.code, 'lead_only');

    // The lead can; so can a HoldingAdmin.
    const moved = await w.change(w.lead, t.id, { assigneeId: w.agent2.user.id });
    assert.equal(moved.assignee.id, w.agent2.user.id);
    await w.change(w.ha, t.id, { assigneeId: w.agent.user.id });

    // Their own: hand it on, or give it back to the queue.
    await w.change(w.agent, t.id, { assigneeId: w.agent2.user.id });
    const released = await w.change(w.agent2, t.id, { assigneeId: null });
    assert.equal(released.assignee, null);

    // Only to someone on the team.
    for (const outsider of [w.gen.user.id, w.ha.user.id, w.team.id]) {
      const res = await w.agent.patch(`/api/tickets/${t.id}`, { assigneeId: outsider });
      assert.equal(res.body.error?.code, 'unknown_assignee');
    }

    const detail = await w.ticket(w.gen, t.id);
    const assigned = detail.timeline.filter((e) => e.type === 'assigned');
    assert.equal(assigned.length, 5);
    assert.equal(assigned[0].from, null);
    assert.equal(assigned[0].to.displayNameEn, 'Sherif Awad');
    assert.equal(assigned[1].actor.displayNameEn, 'Omar Fahmy');
  });

  test('an agent changes the category within the team', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
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

  test('a resolved ticket closes itself after three working days without a reply', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    const other = await w.raise(w.msr);
    await w.say(w.agent, t.id, 'Replaced the battery.');

    // Resolved on Wednesday 14 October at 12:00: Thursday, Sunday, Monday.
    w.at('2026-10-14', '12:00');
    const resolved = await w.change(w.agent, t.id, { status: 'Resolved' });
    assert.equal(resolved.status, 'Resolved');
    assert.equal(iso(resolved.resolvedAt), iso(cairo('2026-10-14', '12:00')));
    assert.equal(resolved.sla.state, 'missed', 'resolved after Tuesday 17:00');
    assert.equal(iso(w.row(t.id).autoCloseAt), iso(cairo('2026-10-19', '12:00')));

    const tickets = w.app.locals.tickets;
    // The weekend does not count: on Sunday it is still open to a reply.
    w.at('2026-10-18', '16:00');
    assert.equal(await tickets.closeResolved(), 0);
    w.at('2026-10-19', '11:59');
    assert.equal(await tickets.closeResolved(), 0);
    assert.equal(w.row(t.id).status, 'Resolved');

    w.at('2026-10-19', '12:00');
    assert.equal(await tickets.closeResolved(), 1);
    assert.equal(await tickets.closeResolved(), 0, 'once');
    const closed = await w.ticket(w.gen, t.id);
    assert.equal(closed.ticket.status, 'Closed');
    assert.equal(iso(closed.ticket.closedAt), iso(cairo('2026-10-19', '12:00')));
    assert.equal(closed.ticket.sla.state, 'missed', 'closing does not rewrite the result');
    const last = closed.timeline.at(-1);
    assert.deepEqual(
      [last.type, last.actor, last.from, last.to],
      ['autoClosed', null, 'Resolved', 'Closed']
    );
    // The other ticket was never resolved and is untouched.
    assert.equal(w.row(other.id).status, 'New');

    // Closed: no more public replies.
    const late = await w.gen.post(`/api/tickets/${t.id}/comments`, { body: 'Thanks' });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'ticket_closed');
    const file = await w.gen.upload(`/api/tickets/${t.id}/attachments?name=a.png`, PNG);
    assert.equal(file.body.error.code, 'ticket_closed');
    assert.equal(closed.ticket.can.comment, false);
  });

  test('the job runs the closing rule at startup and reports failures quietly', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    await w.change(w.agent, t.id, { status: 'Resolved' });
    w.at('2026-10-20', '09:00');

    const seen = [];
    const log = { info: (data) => seen.push(data), warn: (data) => seen.push(data) };
    const job = startTicketAutoClose(w.app.locals.tickets, log, { intervalMs: 60_000 });
    await job.ready;
    job.stop();
    assert.deepEqual(seen, [{ count: 1 }]);
    assert.equal(w.row(t.id).status, 'Closed');

    const failing = startTicketAutoClose(
      { closeResolved: () => Promise.reject(new Error('down')) },
      log,
      { intervalMs: 60_000 }
    );
    await failing.ready;
    failing.stop();
    assert.equal(seen.length, 2);
    await startTicketAutoClose(null, log).ready;
  });

  test('a reply from the requester reopens a resolved ticket, so it does not close', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    await w.say(w.agent, t.id, 'Fixed remotely.');
    w.at(SUNDAY, '13:00');
    await w.change(w.agent, t.id, { status: 'Resolved' });

    w.at('2026-10-12', '09:00');
    const reply = await w.say(w.gen, t.id, 'It happened again this morning.');
    assert.equal(reply.ticket.status, 'Open');
    assert.equal(reply.ticket.resolvedAt, null);
    assert.equal(w.row(t.id).autoCloseAt, null);
    // Sunday 13:00–17:00 and Monday 08:00–09:00 did not count.
    assert.equal(reply.ticket.sla.pausedMinutes, 300);
    assert.equal(reply.ticket.sla.state, 'on_track');
    assert.deepEqual(types(reply).slice(-2), ['comment', 'reopened']);

    w.at('2026-10-25', '09:00');
    assert.equal(await w.app.locals.tickets.closeResolved(), 0);
  });

  test('the requester may reopen for seven days after it was resolved, and no longer', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
    const cannot = await w.gen.post(`/api/tickets/${t.id}/reopen`);
    assert.equal(cannot.status, 409);
    assert.equal(cannot.body.error.code, 'not_resolved');

    await w.change(w.agent, t.id, { status: 'Resolved' });
    w.at('2026-10-15', '09:00');
    await w.app.locals.tickets.closeResolved();
    assert.equal(w.row(t.id).status, 'Closed');

    // Day six: still inside the window, though it has closed.
    w.at('2026-10-17', '11:00');
    assert.equal((await w.ticket(w.gen, t.id)).ticket.can.reopen, true);
    const reopened = await w.gen.post(`/api/tickets/${t.id}/reopen`);
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.ticket.status, 'Open');
    assert.equal(reopened.body.ticket.closedAt, null);
    assert.equal(reopened.body.ticket.sla.state, 'on_track');
    assert.equal(reopened.body.timeline.at(-1).type, 'reopened');
    // The clock stood still from Sunday 11:00 to Thursday 17:00: 6 + 9 × 4 hours.
    assert.equal(reopened.body.ticket.sla.pausedMinutes, 2520);

    // Resolved again, and this time left for eight days.
    await w.change(w.agent, t.id, { status: 'Resolved' });
    w.at('2026-10-25', '11:01');
    const detail = await w.ticket(w.gen, t.id);
    assert.equal(detail.ticket.can.reopen, false);
    const tooLate = await w.gen.post(`/api/tickets/${t.id}/reopen`);
    assert.equal(tooLate.status, 409);
    assert.equal(tooLate.body.error.code, 'reopen_window_closed');
    assert.equal(w.row(t.id).status, 'Resolved');

    // The team is not bound by the window.
    assert.equal((await w.ticket(w.agent, t.id)).ticket.can.reopen, true);
    const byAgent = await w.change(w.agent, t.id, { status: 'Open' });
    assert.equal(byAgent.status, 'Open');
  });
});

describe('attachments', () => {
  test('allowed files are stored and come back only as downloads', async () => {
    const w = await world();
    const t = await w.raise(w.gen);
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
    await w.change(w.agent, w.p1.id, { status: 'WaitingOnRequester' });
    assert.deepEqual(await w.queue(), [
      'Mailbox full',
      'Slow laptop',
      'Second monitor',
      'Site network down',
    ]);
    await w.change(w.agent, w.p2.id, { status: 'Resolved' });
    assert.deepEqual(await w.queue(), ['Slow laptop', 'Second monitor', 'Site network down']);
    assert.deepEqual(await w.queue('?status=Resolved'), ['Mailbox full']);
    assert.equal((await w.queue('?status=all')).length, 4);

    const paged = (await w.agent.get('/api/tickets/queue?pageSize=2&page=2')).body;
    assert.deepEqual([paged.total, paged.items.length, paged.page], [3, 1, 2]);
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

    await w.change(w.agent, w.p1.id, { assigneeId: w.agent.user.id });
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
    });

    // 14:00: P1 is an hour late; P2 (answer by 15:00) is at risk.
    w.at(SUNDAY, '14:00');
    assert.deepEqual(await w.queue('?sla=breached'), ['Site network down']);
    assert.deepEqual(await w.queue('?sla=at_risk'), ['Mailbox full']);
    assert.equal((await w.agent.get('/api/tickets/counts')).body.queue.breachingSoon, 2);
    const row = (await w.agent.get('/api/tickets/queue?sla=breached')).body.items[0];
    assert.equal(row.sla.state, 'breached');

    // Answering P1 puts it on its resolution target (15:00): at risk, not breached.
    await w.say(w.agent, w.p1.id, 'On my way to the comms room.');
    assert.deepEqual(await w.queue('?sla=breached'), []);
    assert.deepEqual(await w.queue('?sla=at_risk'), ['Site network down', 'Mailbox full']);

    // A paused ticket is in none of the three.
    await w.change(w.agent, w.p2.id, { status: 'WaitingOnRequester' });
    assert.deepEqual(await w.queue('?sla=at_risk'), ['Site network down']);
    assert.equal((await w.agent.get('/api/tickets/counts')).body.queue.breachingSoon, 1);

    // The requester's own count is only what is still open for them.
    assert.equal((await w.gen.get('/api/tickets/counts')).body.mine, 1);
    await w.change(w.agent, w.p3.id, { status: 'Resolved' });
    assert.deepEqual((await w.gen.get('/api/tickets/counts')).body, { mine: 0, queue: null });
    assert.equal((await w.gen.get('/api/tickets/mine')).body.total, 0);
    assert.equal((await w.gen.get('/api/tickets/mine?status=Resolved')).body.total, 1);
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
    assert.equal((await w.ha.get('/api/tickets/canned-replies')).body.items.length, 3);
  });
});

describe('helpdesk configuration', () => {
  const audit = (w, action) => w.repo.auditLogs.filter((row) => row.action === action);
  const base = '/api/admin/helpdesk';

  test('a HoldingAdmin configures everything, and every change is audited', async () => {
    const w = await world();
    const before = w.repo.auditLogs.length;
    const ok = (res, status = 200) => {
      assert.equal(res.status, status, JSON.stringify(res.body));
      return res.body;
    };

    // A second department, with no code change.
    const hr = ok(
      await w.ha.post(`${base}/teams`, {
        code: 'hr',
        nameEn: 'HR Services',
        nameAr: 'خدمات الموارد البشرية',
        servesAllCompanies: false,
        companyIds: [w.company('GEN').id],
      }),
      201
    );
    assert.equal(hr.code, 'HR');
    assert.deepEqual(hr.companyIds, [w.company('GEN').id]);
    assert.equal(hr.sla.length, 4);
    assert.deepEqual(hr.calendar, {
      timeZone: 'Africa/Cairo',
      workingDays: [0, 1, 2, 3, 4],
      startMin: 480,
      endMin: 1020,
    });
    const dup = await w.ha.post(`${base}/teams`, { code: 'IT', nameEn: 'x', nameAr: 'y' });
    assert.equal(dup.body.error.code, 'code_taken');

    ok(await w.ha.patch(`${base}/teams/${hr.id}`, { nameEn: 'People Services' }));
    ok(await w.ha.put(`${base}/teams/${hr.id}/members/${w.caGen.user.id}`, { role: 'Agent' }));
    ok(await w.ha.put(`${base}/teams/${hr.id}/members/${w.caGen.user.id}`, { role: 'Lead' }));
    const team = ok(await w.ha.del(`${base}/teams/${hr.id}/members/${w.caGen.user.id}`));
    assert.deepEqual(team.members, []);

    const category = ok(
      await w.ha.post(`${base}/categories`, {
        teamId: hr.id,
        nameEn: 'Payslip',
        nameAr: 'قسيمة الراتب',
        defaultPriority: 'P2',
      }),
      201
    );
    ok(await w.ha.patch(`${base}/categories/${category.id}`, { isActive: false }));
    const sameName = await w.ha.post(`${base}/categories`, {
      teamId: w.team.id,
      nameEn: 'Phone',
      nameAr: 'هاتف',
    });
    assert.equal(sameName.body.error.code, 'name_taken');

    const location = ok(
      await w.ha.post(`${base}/locations`, { nameEn: 'Aswan office', nameAr: 'مكتب أسوان' }),
      201
    );
    ok(await w.ha.patch(`${base}/locations/${location.id}`, { sortOrder: 9 }));

    const policies = [
      { priority: 'P1', firstResponseMinutes: 30, resolveMinutes: 120 },
      { priority: 'P2', firstResponseMinutes: 120, resolveMinutes: 480 },
      { priority: 'P3', firstResponseMinutes: 480, resolveMinutes: 1440 },
      { priority: 'P4', firstResponseMinutes: 960, resolveMinutes: 2400 },
    ];
    const withSla = ok(await w.ha.put(`${base}/teams/${w.team.id}/sla`, { policies }));
    assert.deepEqual(withSla.sla, policies);
    const backwards = await w.ha.put(`${base}/teams/${w.team.id}/sla`, {
      policies: [{ ...policies[0], firstResponseMinutes: 500 }, ...policies.slice(1)],
    });
    assert.equal(backwards.status, 400);
    assert.equal(
      (await w.ha.put(`${base}/teams/${w.team.id}/sla`, { policies: policies.slice(1) }))
        .status,
      400
    );

    const calendar = {
      timeZone: 'Africa/Cairo',
      workingDays: [0, 1, 2, 3, 4, 6],
      startMin: 540,
      endMin: 1080,
    };
    assert.deepEqual(
      ok(await w.ha.put(`${base}/teams/${w.team.id}/calendar`, calendar)).calendar,
      calendar
    );
    const badZone = await w.ha.put(`${base}/teams/${w.team.id}/calendar`, {
      ...calendar,
      timeZone: 'UTC+2',
    });
    assert.equal(badZone.status, 400);

    const holiday = ok(
      await w.ha.post(`${base}/holidays`, {
        date: '2026-12-24',
        nameEn: 'Company day',
        nameAr: 'يوم الشركة',
      }),
      201
    );
    ok(await w.ha.patch(`${base}/holidays/${holiday.id}`, { date: '2026-12-27' }));
    const taken = await w.ha.post(`${base}/holidays`, {
      date: '2026-10-06',
      nameEn: 'x',
      nameAr: 'y',
    });
    assert.equal(taken.body.error.code, 'date_taken');
    assert.equal((await w.ha.del(`${base}/holidays/${holiday.id}`)).status, 204);
    const list = ok(await w.ha.get(`${base}/holidays?year=2027`));
    assert.equal(list.items.length, 5);
    assert.ok(list.items.every((h) => h.date.startsWith('2027-')));

    const reply = ok(
      await w.ha.post(`${base}/canned-replies`, {
        teamId: w.team.id,
        titleEn: 'Asset returned',
        titleAr: 'تم إرجاع الجهاز',
        bodyEn: 'We have received the device.',
        bodyAr: 'استلمنا الجهاز.',
      }),
      201
    );
    ok(await w.ha.patch(`${base}/canned-replies/${reply.id}`, { sortOrder: 1 }));

    // One audit row per write, by the admin, holding-wide, with before and after.
    const actions = w.repo.auditLogs.slice(before).map((row) => row.action);
    assert.deepEqual(actions, [
      'helpdesk.team.create',
      'helpdesk.team.update',
      'helpdesk.member.add',
      'helpdesk.member.update',
      'helpdesk.member.remove',
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
    ]);
    for (const row of w.repo.auditLogs.slice(before)) {
      assert.equal(row.actorId, w.ha.user.id);
      assert.equal(row.companyId, null);
      assert.ok(row.entityId, row.action);
    }
    const [sla] = audit(w, 'helpdesk.sla.update');
    assert.equal(JSON.parse(sla.before).P1.firstResponseMinutes, 60);
    assert.equal(JSON.parse(sla.after).P1.firstResponseMinutes, 30);
    const [renamed] = audit(w, 'helpdesk.team.update');
    assert.equal(JSON.parse(renamed.before).nameEn, 'HR Services');
    assert.equal(JSON.parse(renamed.after).nameEn, 'People Services');
    const [removed] = audit(w, 'helpdesk.member.remove');
    assert.equal(removed.after, null);
    assert.equal(JSON.parse(removed.before).role, 'Lead');

    // The new targets and hours apply to the next ticket: 09:00–18:00, P1 30 minutes.
    const next = await w.raise(w.agent, { requesterId: w.gen.user.id, priority: 'P1' });
    assert.equal(iso(next.sla.firstResponseDueAt), iso(cairo(SUNDAY, '11:30')));
  });

  test('a new holiday moves the due date of tickets raised after it', async () => {
    const w = await world();
    w.at('2026-10-15', '16:00'); // Thursday
    const res = await w.ha.post('/api/admin/helpdesk/holidays', {
      date: '2026-10-18',
      nameEn: 'Extra day',
      nameAr: 'يوم إضافي',
    });
    assert.equal(res.status, 201);
    const t = await w.raise(w.agent, { requesterId: w.gen.user.id, priority: 'P1' });
    // One hour on Thursday, Sunday is off, three on Monday.
    assert.equal(iso(t.sla.resolveDueAt), iso(cairo('2026-10-19', '11:00')));
  });

  test('a team lead manages the team’s categories and canned replies, audited, and nothing else', async () => {
    const w = await world();
    const before = w.repo.auditLogs.length;

    const reply = await w.lead.post(`${base}/canned-replies`, {
      teamId: w.team.id,
      titleEn: 'Toner ordered',
      titleAr: 'تم طلب الحبر',
      bodyEn: 'Toner is on order.',
      bodyAr: 'تم طلب الحبر.',
    });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
    const edited = await w.lead.patch(`${base}/canned-replies/${reply.body.id}`, {
      isActive: false,
    });
    assert.equal(edited.status, 200);
    const category = await w.lead.post(`${base}/categories`, {
      teamId: w.team.id,
      nameEn: 'Meeting room AV',
      nameAr: 'أجهزة قاعات الاجتماعات',
    });
    assert.equal(category.status, 201);
    assert.equal((await w.lead.get(`${base}/categories`)).body.items.length, 10);
    assert.equal((await w.lead.get(`${base}/canned-replies`)).body.items.length, 5);
    assert.equal((await w.lead.get(`${base}/teams`)).body.items.length, 1);

    const rows = w.repo.auditLogs.slice(before);
    assert.deepEqual(
      rows.map((r) => [r.action, r.actorId]),
      [
        ['helpdesk.canned.create', w.lead.user.id],
        ['helpdesk.canned.update', w.lead.user.id],
        ['helpdesk.category.create', w.lead.user.id],
      ]
    );

    // The rest is the HoldingAdmin's.
    const refusals = [
      w.lead.post(`${base}/teams`, { code: 'FM', nameEn: 'Facilities', nameAr: 'المرافق' }),
      w.lead.patch(`${base}/teams/${w.team.id}`, { nameEn: 'Mine' }),
      w.lead.put(`${base}/teams/${w.team.id}/members/${w.gen.user.id}`, { role: 'Lead' }),
      w.lead.del(`${base}/teams/${w.team.id}/members/${w.agent.user.id}`),
      w.lead.put(`${base}/teams/${w.team.id}/sla`, { policies: [] }),
      w.lead.get(`${base}/locations`),
      w.lead.post(`${base}/locations`, { nameEn: 'x', nameAr: 'y' }),
      w.lead.get(`${base}/holidays`),
      w.lead.post(`${base}/holidays`, { date: '2026-11-01', nameEn: 'x', nameAr: 'y' }),
    ];
    for (const res of await Promise.all(refusals)) {
      assert.ok([400, 403].includes(res.status), `${res.status}`);
    }
    const slaTry = await w.lead.put(`${base}/teams/${w.team.id}/calendar`, {
      timeZone: 'Africa/Cairo',
      workingDays: [0],
      startMin: 0,
      endMin: 60,
    });
    assert.equal(slaTry.status, 403);
    assert.equal(w.repo.auditLogs.length, before + 3);
  });

  test('agents, CompanyAdmins and users cannot touch the configuration', async () => {
    const w = await world();
    const before = w.repo.auditLogs.length;
    const reply = w.repo.helpdesk.canned[0];
    for (const who of [w.agent, w.caGen, w.gen]) {
      const tries = await Promise.all([
        who.get(`${base}/teams`),
        who.get(`${base}/categories`),
        who.get(`${base}/canned-replies`),
        who.get(`${base}/locations`),
        who.get(`${base}/holidays`),
        who.patch(`${base}/canned-replies/${reply.id}`, { titleEn: 'Hacked' }),
        who.patch(`${base}/categories/${w.category('Phone').id}`, { isActive: false }),
        who.post(`${base}/holidays`, { date: '2026-11-02', nameEn: 'x', nameAr: 'y' }),
        who.put(`${base}/teams/${w.team.id}/members/${who.user.id}`, { role: 'Lead' }),
      ]);
      for (const res of tries) assert.equal(res.status, 403);
    }
    assert.equal(reply.titleEn, 'Password reset steps');
    assert.equal(w.repo.auditLogs.length, before);
  });
});
