import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import { describe as describeText } from '@mg/shared/web/assets/js/notification-text.js';
import { createApp } from '../src/app.js';
import { startSlaWatch } from '@mg/shared/server/jobs/slaWatch.js';
import { translator } from '@mg/shared/server/lib/messages.js';
import { createNotifier } from '@mg/shared/server/lib/notify.js';
import { zoneWallToUtc } from '@mg/shared/server/lib/sla.js';
import { createMemoryStorage } from '@mg/shared/server/lib/storage.js';
import { cairoWallToUtc } from '@mg/shared/server/lib/time.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';
import { createMemoryNotificationStore } from '@mg/shared/server/modules/notifications/store-memory.js';

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };

/** An instant from a Cairo day and clock time. */
const cairo = (ymd, hhmm) =>
  new Date(
    zoneWallToUtc(ymd, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), 'Africa/Cairo')
  );

/** Sunday 11 October 2026, 11:00 in Cairo: a working morning. */
const START = cairo('2026-10-11', '11:00');

function build() {
  const repo = createMemoryUserRepo();
  const clock = { now: START };
  const app = createApp({
    config: DEV,
    userRepo: repo,
    storage: createMemoryStorage(),
    now: () => clock.now,
    authRateLimit: { limit: 100_000 },
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
    get: (path) => agent.get(path),
    post: (path, body = {}) => send('post', path, body),
    patch: (path, body) => send('patch', path, body),
    put: (path, body) => send('put', path, body),
  };
}

/**
 * The people the matrix needs, signed in: a HoldingAdmin, a Genesis
 * CompanyAdmin, two Genesis users, a Masar user, and the IT team's lead and
 * two agents (all three are MG Holding employees).
 */
async function world() {
  const w = build();
  const byEmail = (email) => w.repo.users.find((u) => u.email === email);
  const who = (email) => signIn(w.app, byEmail(email));
  w.ha = await who('nadia.elsayed@mgholding.example');
  w.caGen = await who('hany.soliman@genesismining-eg.com');
  w.gen = await who('salma.ibrahim@genesismining-eg.com');
  w.gen2 = await who('mahmoud.attia@genesismining-eg.com');
  w.msr = await who('yasmine.nabil@masar.eg');
  w.lead = await who('omar.fahmy@mgholding.example');
  w.agent = await who('sherif.awad@mgholding.example');
  w.agent2 = await who('tamer.gad@mgholding.example');
  /** Gives a ticket to the agent without an assignment's own notice or status change (D122). */
  w.give = (ticketId, agent) => {
    w.repo.helpdesk.ticket.find((t) => t.id === ticketId).assigneeId = agent.user.id;
  };

  w.company = (code) => w.repo.companies.find((c) => c.code === code);
  w.category = (nameEn) => w.repo.helpdesk.category.find((c) => c.nameEn === nameEn);
  w.room = w.repo.rooms[0];

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

  /** Every notification row of one channel for a person, newest last. */
  w.rows = (who_, channel = 'inApp') =>
    (w.repo.notifications ?? []).filter(
      (n) => n.userId === who_.user.id && n.channel === channel
    );
  /** What a row says, in a language. */
  w.say = (row, lang = 'en') =>
    describeText(row.templateKey, JSON.parse(row.payload), lang, translator(lang));
  w.mail = () => w.app.locals.mailOutbox.list();
  w.mailTo = async (who_) => (await w.mail()).filter((m) => m.to.includes(who_.user.email));
  return w;
}

describe('notify()', () => {
  test('writes an in-app row and sends an email, in the person’s language, branded', async () => {
    const w = await world();
    const arabic = w.repo.users.find((u) => u.email === 'mahmoud.attia@genesismining-eg.com');
    arabic.language = 'ar';

    const sent = await w.app.locals.notify([w.gen.user.id, arabic.id], 'ticket.status', {
      link: '#tickets/abc',
      number: 'IT-2026-00001',
      subject: 'Printer jam',
      status: { en: 'Resolved', ar: 'تم الحل' },
    });
    assert.deepEqual(sent, { inApp: 2, email: 2 });

    const english = w.rows(w.gen)[0];
    assert.equal(w.say(english).title, 'IT-2026-00001 is now: Resolved');
    assert.equal(w.say(english).detail, 'Printer jam');
    assert.equal(JSON.parse(english.payload).link, '#tickets/abc');

    const mails = await w.mail();
    assert.equal(mails.length, 2);
    const en = mails.find((m) => m.to[0] === w.gen.user.email);
    const ar = mails.find((m) => m.to[0] === arabic.email);
    assert.equal(en.from, 'no-reply@mgholding.example');
    assert.equal(en.subject, 'IT-2026-00001 is now: Resolved');
    assert.match(en.html, /<html lang="en" dir="ltr">/);
    assert.match(ar.html, /<html lang="ar" dir="rtl">/);
    assert.match(ar.subject, /تم الحل/);
    // Genesis's accent colour and name, not the holding's.
    assert.ok(en.html.includes('Genesis'));
    assert.match(en.html, /#\/?tickets\/abc|\/#tickets\/abc/);
    assert.ok(en.text.includes('/#tickets/abc'));
  });

  test('a person’s switches decide the channels; a missing switch means on', async () => {
    const w = await world();
    const put = (items) => w.gen.put('/api/notifications/preferences', { items });
    assert.equal(
      (await put([{ category: 'tickets', channel: 'email', enabled: false }])).status,
      200
    );

    await w.app.locals.notify([w.gen.user.id, w.gen2.user.id], 'ticket.created', {
      number: 'IT-2026-00002',
      subject: 'Mouse',
    });
    assert.equal(w.rows(w.gen).length, 1, 'still in the portal');
    assert.equal((await w.mailTo(w.gen)).length, 0, 'but no email');
    assert.equal(w.rows(w.gen2).length, 1);
    assert.equal((await w.mailTo(w.gen2)).length, 1);

    // Both channels off for one kind of event: nothing, for that kind only.
    await put([
      { category: 'tickets', channel: 'inApp', enabled: false },
      { category: 'bookings', channel: 'inApp', enabled: true },
    ]);
    await w.app.locals.notify([w.gen.user.id], 'ticket.created', { number: 'N', subject: 'S' });
    assert.equal(w.rows(w.gen).length, 1, 'no new in-app row');
    await w.app.locals.notify([w.gen.user.id], 'booking.confirmed', {
      room: 'Room',
      when: 'Today',
      more: '',
      subject: 'S',
    });
    assert.equal(w.rows(w.gen).length, 2);
  });

  test('a dedupe key reaches a person once; an inactive person is skipped', async () => {
    const w = await world();
    const data = { number: 'N', subject: 'S', phase: 'x', dedupeKey: 'sla:t:1:75' };
    await w.app.locals.notify([w.gen.user.id], 'ticket.slaAtRisk', data);
    const again = await w.app.locals.notify([w.gen.user.id], 'ticket.slaAtRisk', data);
    assert.deepEqual(again, { inApp: 0, email: 0 });
    assert.equal(w.rows(w.gen).length, 1);

    w.repo.users.find((u) => u.id === w.gen2.user.id).isActive = false;
    const none = await w.app.locals.notify([w.gen2.user.id], 'ticket.created', {
      number: 'N',
      subject: 'S',
    });
    assert.deepEqual(none, { inApp: 0, email: 0 });
  });

  test('a failing mail server never throws, and leaves no email row to retry from', async () => {
    const w = await world();
    const logged = [];
    const store = createMemoryNotificationStore(w.repo);
    const notify = createNotifier({
      store,
      getGraph: async () => ({
        sendMail: async () => {
          throw new Error('Graph is down');
        },
      }),
      config: { NOREPLY_MAILBOX: 'no-reply@x.example', APP_BASE_URL: 'http://localhost:3000' },
      log: { warn: (...args) => logged.push(args) },
    });
    const sent = await notify([w.gen.user.id], 'ticket.created', { number: 'N', subject: 'S' });
    assert.deepEqual(sent, { inApp: 1, email: 0 });
    assert.equal(logged.length, 1);
    assert.equal(w.rows(w.gen, 'email').length, 0);
    await assert.rejects(() => notify([w.gen.user.id], 'nope.nope', {}), /Unknown/);
  });

  test('every template has English and Arabic words, with the same placeholders', async () => {
    const { TEMPLATES } = await import('@mg/shared/web/assets/js/notification-text.js');
    const en = translator('en');
    const ar = translator('ar');
    const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(TEMPLATES)) {
      for (const part of ['title', 'detail']) {
        const path = `notification.tpl.${key}.${part}`;
        assert.notEqual(en(path), path, `${path} (en)`);
        assert.notEqual(ar(path), path, `${path} (ar)`);
        assert.deepEqual(
          placeholders(en(path)),
          placeholders(ar(path)),
          `${path} placeholders`
        );
      }
    }
  });
});

describe('tickets tell the right people', () => {
  test('a new ticket: the requester and the team lead, nobody else', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    assert.equal(w.rows(w.gen).length, 1);
    assert.equal(w.say(w.rows(w.gen)[0]).title, `New ticket ${ticket.number}`);
    assert.equal(w.rows(w.lead).length, 1);
    assert.equal(w.rows(w.agent).length, 0);
    assert.equal(w.rows(w.gen2).length, 0);
    assert.equal(w.rows(w.msr).length, 0);
    assert.equal((await w.mailTo(w.gen)).length, 1);
  });

  test('assigning tells the assignee, not the person who assigned', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    const res = await w.lead.patch(`/api/tickets/${ticket.id}`, {
      assigneeId: w.agent.user.id,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = w.rows(w.agent);
    assert.equal(rows.length, 1);
    assert.match(w.say(rows[0]).title, /assigned .* to you/);
    assert.equal(w.rows(w.lead).length, 1, 'only the ticket-created one');
  });

  test('replies go to the other side; an internal note tells nobody', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    await w.lead.patch(`/api/tickets/${ticket.id}`, { assigneeId: w.agent.user.id });
    const base = {
      requester: w.rows(w.gen).length,
      agent: w.rows(w.agent).length,
      lead: w.rows(w.lead).length,
    };

    // An agent answers: the requester hears (and is told once, not also of "Open").
    assert.equal(
      (
        await w.agent.post(`/api/tickets/${ticket.id}/comments`, {
          body: 'Try holding the power key.',
        })
      ).status,
      201
    );
    assert.equal(w.rows(w.gen).length, base.requester + 1);
    assert.match(w.say(w.rows(w.gen).at(-1)).title, /replied on/);
    assert.equal(w.say(w.rows(w.gen).at(-1)).detail, 'Try holding the power key.');

    // The requester replies: the assignee hears, not the lead.
    await w.gen.post(`/api/tickets/${ticket.id}/comments`, { body: 'Thanks, that worked.' });
    assert.equal(w.rows(w.agent).length, base.agent + 1);
    assert.equal(w.rows(w.lead).length, base.lead);

    // An internal note between agents is silent.
    const before = w.repo.notifications.length;
    await w.agent.post(`/api/tickets/${ticket.id}/comments`, {
      body: 'Requester is the site manager.',
      isInternal: true,
    });
    assert.equal(w.repo.notifications.length, before);
  });

  test('a new status tells the requester, unless they set it themselves', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    w.give(ticket.id, w.agent);
    await w.agent.patch(`/api/tickets/${ticket.id}`, { status: 'Pending' });
    assert.match(w.say(w.rows(w.gen).at(-1)).title, /is now: Pending/);
    assert.equal(
      w.rows(w.gen).at(-1).payload.includes('Waiting'),
      false,
      'the old name is gone from the words'
    );
    await w.agent.patch(`/api/tickets/${ticket.id}`, { status: 'Resolved' });
    const last = w.say(w.rows(w.gen).at(-1));
    assert.match(last.title, /is your problem solved\?/);

    // The requester reopening their own ticket is not news to them.
    const before = w.rows(w.gen).length;
    assert.equal((await w.gen.post(`/api/tickets/${ticket.id}/reopen`)).status, 200);
    assert.equal(w.rows(w.gen).length, before);
  });

  test('Resolved asks the requester "Is your problem solved?": bell and email, in their language', async () => {
    const w = await world();
    const arabic = w.repo.users.find((u) => u.email === 'mahmoud.attia@genesismining-eg.com');
    arabic.language = 'ar';
    const english = await w.raise(w.gen);
    const arabicTicket = await w.raise(w.gen2);
    for (const t of [english, arabicTicket]) w.give(t.id, w.agent);
    await w.agent.patch(`/api/tickets/${english.id}`, { status: 'Resolved' });
    await w.agent.patch(`/api/tickets/${arabicTicket.id}`, { status: 'Resolved' });

    const bell = w.rows(w.gen).at(-1);
    assert.equal(bell.templateKey, 'ticket.resolved');
    assert.match(w.say(bell).title, /is your problem solved\?/);
    assert.equal(JSON.parse(bell.payload).link, `#tickets/${english.id}`);
    const mail = (await w.mailTo(w.gen)).find((m) => /solved/.test(m.subject));
    assert.match(mail.subject, /is your problem solved\?/);
    assert.match(mail.html, /lang="en"/);

    const bellAr = w.rows(w.gen2).at(-1);
    assert.equal(bellAr.templateKey, 'ticket.resolved');
    assert.match(w.say(bellAr, 'ar').title, /هل حُلّت مشكلتك/);
    const mailAr = (await w.mailTo(w.gen2)).find((m) => /حُلّت/.test(m.subject));
    assert.match(mailAr.subject, /هل حُلّت مشكلتك/);
    assert.match(mailAr.html, /lang="ar" dir="rtl"/);
    // Nobody else is told.
    assert.equal(w.rows(w.msr).length, 0);
  });

  test('"No, still a problem" tells whoever has the ticket; "Yes, solved" tells them the rating', async () => {
    const w = await world();
    const mine = await w.raise(w.gen);
    w.give(mine.id, w.agent);
    await w.agent.patch(`/api/tickets/${mine.id}`, { status: 'Resolved' });
    const base = {
      requester: w.rows(w.gen).length,
      agent: w.rows(w.agent).length,
      lead: w.rows(w.lead).length,
    };
    const no = await w.gen.post(`/api/tickets/${mine.id}/not-solved`, {
      reason: 'It still shows a black screen.',
    });
    assert.equal(no.status, 200);
    assert.equal(no.body.ticket.status, 'Open');
    assert.equal(w.rows(w.agent).length, base.agent + 1, 'the assigned agent');
    assert.equal(w.rows(w.agent).at(-1).templateKey, 'ticket.notSolved');
    assert.match(w.say(w.rows(w.agent).at(-1)).title, /still a problem/);
    assert.equal(w.say(w.rows(w.agent).at(-1)).detail, 'It still shows a black screen.');
    assert.equal(w.rows(w.lead).length, base.lead, 'not the lead, the ticket has an agent');
    assert.equal(w.rows(w.gen).length, base.requester, 'not the person who said it');

    // Resolved again and confirmed: the agent hears the rating.
    await w.agent.patch(`/api/tickets/${mine.id}`, { status: 'Resolved' });
    await w.gen.post(`/api/tickets/${mine.id}/solved`, { rating: 5 });
    assert.equal(w.rows(w.agent).at(-1).templateKey, 'ticket.confirmed');
    assert.match(w.say(w.rows(w.agent).at(-1)).detail, /Rating: 5 of 5/);

    // An unassigned ticket: the lead is told instead.
    const loose = await w.raise(w.gen2);
    await w.lead.patch(`/api/tickets/${loose.id}`, { status: 'Resolved' });
    const leadBase = w.rows(w.lead).length;
    await w.gen2.post(`/api/tickets/${loose.id}/not-solved`, { reason: 'Not fixed.' });
    assert.equal(w.rows(w.lead).length, leadBase + 1);
    assert.equal(w.rows(w.lead).at(-1).templateKey, 'ticket.notSolved');
  });

  test('a resolved ticket reminds its requester every 24 hours, once each time, and never closes', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    const quiet = await w.raise(w.gen2, { subject: 'Not resolved' });
    w.give(ticket.id, w.agent);
    await w.agent.patch(`/api/tickets/${ticket.id}`, { status: 'Resolved' });
    const remind = () => w.app.locals.tickets.remindResolved();
    const reminders = () =>
      w.rows(w.gen).filter((n) => n.templateKey === 'ticket.confirmReminder');
    const hours = (n) => new Date(START.getTime() + n * 3_600_000);

    w.clock.now = hours(23.9);
    assert.equal(await remind(), 0, 'not yet 24 hours');
    assert.equal(reminders().length, 0);

    w.clock.now = hours(24);
    assert.equal(await remind(), 1);
    assert.equal(reminders().length, 1);
    assert.match(w.say(reminders()[0]).title, /Reminder: is .* solved\?/);
    assert.equal(
      (await w.mailTo(w.gen)).filter((m) => /Reminder/.test(m.subject)).length,
      1,
      'and the email'
    );

    // Run again, even twice at once: the same 24 hours reminds nobody twice.
    assert.equal(await remind(), 0);
    await Promise.all([remind(), remind()]);
    assert.equal(reminders().length, 1);

    w.clock.now = hours(47);
    assert.equal(await remind(), 0);
    w.clock.now = hours(48);
    assert.equal(await remind(), 1);
    assert.equal(reminders().length, 2);
    assert.equal(
      w.rows(w.gen2).filter((n) => n.templateKey === 'ticket.confirmReminder').length,
      0
    );

    // Days on, it is still open and still asking.
    w.clock.now = hours(24 * 30);
    assert.equal(await remind(), 1);
    assert.equal(w.repo.helpdesk.ticket.find((t) => t.id === ticket.id).status, 'Resolved');
    assert.equal(w.repo.helpdesk.ticket.find((t) => t.id === quiet.id).status, 'New');

    // Once answered, the reminders stop.
    await w.gen.post(`/api/tickets/${ticket.id}/solved`, { rating: 4 });
    const sent = reminders().length;
    w.clock.now = hours(24 * 31);
    assert.equal(await remind(), 0);
    assert.equal(reminders().length, sent);
  });
});

describe('the SLA watch', () => {
  test('75% and 100% each reach the assignee and the lead once', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    await w.lead.patch(`/api/tickets/${ticket.id}`, { assigneeId: w.agent.user.id });
    const row = w.repo.helpdesk.ticket.find((t) => t.id === ticket.id);
    const base = { agent: w.rows(w.agent).length, lead: w.rows(w.lead).length };

    // Nothing yet.
    assert.deepEqual(await w.app.locals.tickets.watchSla(), { atRisk: 0, breached: 0 });

    w.clock.now = new Date(row.nextRiskAt.getTime() + 60_000);
    assert.deepEqual(await w.app.locals.tickets.watchSla(), { atRisk: 1, breached: 0 });
    assert.equal(w.rows(w.agent).length, base.agent + 1);
    assert.equal(w.rows(w.lead).length, base.lead + 1);
    assert.match(w.say(w.rows(w.agent).at(-1)).title, /75% of the first response time/);
    // Once: a second run changes nothing.
    assert.deepEqual(await w.app.locals.tickets.watchSla(), { atRisk: 0, breached: 0 });
    assert.equal(w.rows(w.agent).length, base.agent + 1);

    w.clock.now = new Date(row.nextDueAt.getTime() + 60_000);
    assert.deepEqual(await w.app.locals.tickets.watchSla(), { atRisk: 0, breached: 1 });
    assert.match(w.say(w.rows(w.agent).at(-1)).title, /passed its first response deadline/);
    assert.deepEqual(await w.app.locals.tickets.watchSla(), { atRisk: 0, breached: 0 });
    assert.equal(w.rows(w.agent).length, base.agent + 2);
  });

  test('past its target in one jump gets the breach alert only', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    const row = w.repo.helpdesk.ticket.find((t) => t.id === ticket.id);
    w.clock.now = new Date(row.nextDueAt.getTime() + 60_000);
    assert.deepEqual(await w.app.locals.tickets.watchSla(), { atRisk: 0, breached: 1 });
    // Unassigned: the lead alone.
    const alerts = w.repo.notifications.filter((n) => n.templateKey.startsWith('ticket.sla'));
    assert.deepEqual(
      [...new Set(alerts.map((n) => n.userId))],
      [w.lead.user.id],
      'only the lead, unassigned'
    );
    assert.ok(alerts.every((n) => n.templateKey === 'ticket.slaBreached'));
  });

  test('a paused clock and a closed ticket raise nothing; the timer reports quietly', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    w.give(ticket.id, w.agent);
    await w.agent.patch(`/api/tickets/${ticket.id}`, { status: 'Pending' });
    const row = w.repo.helpdesk.ticket.find((t) => t.id === ticket.id);
    w.clock.now = new Date(row.nextDueAt.getTime() + 24 * 3_600_000);
    assert.deepEqual(await w.app.locals.tickets.watchSla(), { atRisk: 0, breached: 0 });

    const logs = [];
    const job = startSlaWatch(
      { watchSla: async () => ({ atRisk: 2, breached: 1 }) },
      { info: (...a) => logs.push(['info', ...a]), warn: (...a) => logs.push(['warn', ...a]) },
      { intervalMs: 1_000_000 }
    );
    await job.ready;
    job.stop();
    assert.deepEqual(logs, [['info', { atRisk: 2, breached: 1 }, 'SLA alerts sent']]);

    const failing = [];
    const bad = startSlaWatch(
      {
        watchSla: async () => {
          throw new Error('database down');
        },
      },
      { info() {}, warn: (...a) => failing.push(a) },
      { intervalMs: 1_000_000 }
    );
    await bad.ready;
    bad.stop();
    assert.equal(failing.length, 1);
  });
});

describe('bookings and announcements', () => {
  const MONDAY = '2026-10-12';
  const at = (ymd, hhmm) =>
    cairoWallToUtc(ymd, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))).toISOString();

  test('a booking confirms to its organiser; an admin’s cancel gives the reason', async () => {
    const w = await world();
    const rooms = (await w.gen.get('/api/rooms')).body.items;
    const booked = await w.gen.post('/api/bookings', {
      roomId: rooms[0].id,
      subject: 'Budget review',
      start: at(MONDAY, '10:00'),
      end: at(MONDAY, '11:00'),
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));

    const confirmed = w.say(w.rows(w.gen)[0]);
    assert.match(confirmed.title, /^Booked: .*, .*10:00–11:00/);
    assert.equal(confirmed.detail, 'Budget review');
    assert.match(w.say(w.rows(w.gen)[0], 'ar').title, /^تم الحجز:/);

    const id = booked.body.items[0].id;
    const moved = await w.caGen.patch(`/api/bookings/${id}`, {
      start: at(MONDAY, '14:00'),
      end: at(MONDAY, '15:00'),
      reason: 'The room is needed for an audit',
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const movedNote = w.say(w.rows(w.gen).at(-1));
    assert.match(movedNote.title, /^Booking moved: .*, .*14:00–15:00/);
    assert.match(
      movedNote.detail,
      /Moved by .*, was .*10:00–11:00\. Reason: The room is needed/
    );

    const cancelled = await w.caGen.post(`/api/bookings/${id}/cancel`, {
      scope: 'one',
      reason: 'The room is needed for an audit',
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    const last = w.say(w.rows(w.gen).at(-1));
    assert.match(last.title, /^Booking cancelled:/);
    assert.match(last.detail, /Cancelled by .*\. Reason: The room is needed for an audit/);
    assert.equal((await w.mailTo(w.gen)).length, 3);
  });

  test('a pinned announcement tells its company once; other companies hear nothing', async () => {
    const w = await world();
    const created = await w.caGen.post('/api/admin/announcements', {
      companyId: w.company('GEN').id,
      titleEn: 'Blast window moved',
      summaryEn: 'Today’s blast is at 14:00.',
      bodyEn: 'Please keep clear of the pit.',
      category: 'HSE',
      isPinned: true,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(w.repo.notifications.length, 0, 'a draft tells nobody');

    const published = await w.caGen.post(
      `/api/admin/announcements/${created.body.id}/publish`,
      {
        updatedAt: created.body.updatedAt,
      }
    );
    assert.equal(published.status, 200, JSON.stringify(published.body));

    assert.equal(w.rows(w.gen).length, 1);
    assert.equal(w.rows(w.gen2).length, 1);
    assert.equal(w.rows(w.msr).length, 0, 'Masar is not in the audience');
    assert.equal(w.rows(w.caGen).length, 0, 'not the author');
    assert.equal(w.say(w.rows(w.gen)[0]).title, 'Pinned announcement: Blast window moved');
    assert.equal(w.say(w.rows(w.gen)[0]).detail, 'Today’s blast is at 14:00.');

    // Nothing twice: not the sweep, not a later edit.
    assert.equal(await w.app.locals.announcements.notifyPinned(), 0);
    const edited = await w.caGen.patch(`/api/admin/announcements/${created.body.id}`, {
      updatedAt: published.body.updatedAt,
      isPinned: true,
      summaryEn: 'Edited',
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(w.rows(w.gen).length, 1);
  });

  test('a scheduled pinned announcement is told when it goes live, by the sweep', async () => {
    const w = await world();
    const later = new Date(START.getTime() + 3_600_000).toISOString();
    const created = await w.caGen.post('/api/admin/announcements', {
      companyId: w.company('GEN').id,
      titleEn: 'Shuttle change',
      bodyEn: 'From Sunday.',
      category: 'General',
      isPinned: true,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const scheduled = await w.caGen.post(
      `/api/admin/announcements/${created.body.id}/publish`,
      {
        updatedAt: created.body.updatedAt,
        publishAt: later,
      }
    );
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body));
    assert.equal(w.rows(w.gen).length, 0, 'not yet');
    assert.equal(await w.app.locals.announcements.notifyPinned(), 0);

    w.clock.now = new Date(START.getTime() + 2 * 3_600_000);
    assert.ok((await w.app.locals.announcements.notifyPinned()) > 0);
    assert.equal(w.rows(w.gen).length, 1);
    assert.equal(await w.app.locals.announcements.notifyPinned(), 0, 'once');
  });
});

describe('the notification API', () => {
  async function seeded() {
    const w = await world();
    for (let i = 1; i <= 3; i += 1) {
      // A second apart, so "newest first" has an answer.
      w.clock.now = new Date(w.clock.now.getTime() + 1000);
      await w.app.locals.notify([w.gen.user.id], 'ticket.created', {
        link: `#tickets/${i}`,
        number: `IT-2026-0000${i}`,
        subject: `Subject ${i}`,
      });
    }
    await w.app.locals.notify([w.msr.user.id], 'ticket.created', {
      number: 'IT-2026-00009',
      subject: 'Masar only',
    });
    return w;
  }

  test('list, count, mark read, mark all read: always one’s own', async () => {
    const w = await seeded();

    const count = await w.gen.get('/api/notifications/unread-count');
    assert.deepEqual(count.body, { unread: 3 });

    const list = await w.gen.get('/api/notifications?pageSize=2');
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 3);
    assert.equal(list.body.unread, 3);
    assert.equal(list.body.items.length, 2);
    assert.match(list.body.items[0].vars.number, /IT-2026-00003/, 'newest first');
    assert.equal(list.body.items[0].link, '#tickets/3');

    const one = list.body.items[0].id;
    const read = await w.gen.post('/api/notifications/read', { ids: [one] });
    assert.deepEqual(read.body, { marked: 1, unread: 2 });
    const unreadOnly = await w.gen.get('/api/notifications?unread=true');
    assert.equal(unreadOnly.body.total, 2);

    const all = await w.gen.post('/api/notifications/read-all');
    assert.deepEqual(all.body, { marked: 2, unread: 0 });
  });

  test('one company’s user cannot read or change another’s notifications', async () => {
    const w = await seeded();
    const masarRow = w.rows(w.msr)[0];

    const theirs = await w.msr.get('/api/notifications');
    assert.equal(theirs.body.total, 1);
    assert.equal(theirs.body.items[0].vars.subject, 'Masar only');

    // A Genesis user sends a Masar notification's id: nothing is marked.
    const poke = await w.gen.post('/api/notifications/read', { ids: [masarRow.id] });
    assert.deepEqual(poke.body, { marked: 0, unread: 3 });
    assert.equal(w.rows(w.msr)[0].readAt, null);
    const ownList = await w.gen.get('/api/notifications?pageSize=100');
    assert.ok(ownList.body.items.every((i) => i.vars.subject !== 'Masar only'));

    // Not even the holding admin reads other people's.
    const admin = await w.ha.get('/api/notifications');
    assert.equal(admin.body.total, 0);
  });

  test('preferences: every switch listed, saved per person, validated', async () => {
    const w = await seeded();
    const first = await w.gen.get('/api/notifications/preferences');
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.categories, ['tickets', 'bookings', 'announcements']);
    assert.deepEqual(first.body.channels, ['inApp', 'email']);
    assert.equal(first.body.items.length, 6);
    assert.ok(first.body.items.every((i) => i.enabled));

    const saved = await w.gen.put('/api/notifications/preferences', {
      items: [{ category: 'bookings', channel: 'email', enabled: false }],
    });
    assert.equal(saved.status, 200);
    assert.equal(
      saved.body.items.find((i) => i.category === 'bookings' && i.channel === 'email').enabled,
      false
    );
    // Someone else's are untouched.
    const other = await w.gen2.get('/api/notifications/preferences');
    assert.ok(other.body.items.every((i) => i.enabled));

    for (const bad of [
      { items: [{ category: 'tickets', channel: 'teams', enabled: true }] },
      { items: [{ category: 'sports', channel: 'email', enabled: true }] },
      { items: [] },
      { items: [{ category: 'tickets', channel: 'email', enabled: 'yes' }] },
      { items: [{ category: 'tickets', channel: 'email', enabled: true }], extra: 1 },
    ]) {
      assert.equal((await w.gen.put('/api/notifications/preferences', bad)).status, 400);
    }
    assert.equal((await w.gen.post('/api/notifications/read', { ids: ['nope'] })).status, 400);
  });

  test('signed-out callers are turned away, and the dev outbox lists what was sent', async () => {
    const w = await seeded();
    assert.equal((await request(w.app).get('/api/notifications')).status, 401);

    const outbox = await w.gen.get('/api/dev/outbox');
    assert.equal(outbox.status, 200);
    assert.equal(outbox.body.items.length, 4);
    assert.ok(outbox.body.items[0].subject);
    assert.ok(outbox.body.items[0].html.includes('<html'));
  });
});
