import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import { describe as describeText } from '@mg/shared/web/assets/js/notification-text.js';
import { createApp } from '../src/app.js';
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
 * CompanyAdmin, two Genesis users and a Masar user.
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

  w.company = (code) => w.repo.companies.find((c) => c.code === code);
  w.room = w.repo.rooms[0];

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
      (await put([{ category: 'announcements', channel: 'email', enabled: false }])).status,
      200
    );

    await w.app.locals.notify([w.gen.user.id, w.gen2.user.id], 'announcement.pinned', {
      title: 'Safety day',
      summary: 'Friday',
    });
    assert.equal(w.rows(w.gen).length, 1, 'still in the portal');
    assert.equal((await w.mailTo(w.gen)).length, 0, 'but no email');
    assert.equal(w.rows(w.gen2).length, 1);
    assert.equal((await w.mailTo(w.gen2)).length, 1);

    // Both channels off for one kind of event: nothing, for that kind only.
    await put([
      { category: 'announcements', channel: 'inApp', enabled: false },
      { category: 'bookings', channel: 'inApp', enabled: true },
    ]);
    await w.app.locals.notify([w.gen.user.id], 'announcement.pinned', {
      title: 'Another',
      summary: '',
    });
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
    const data = { title: 'T', summary: 'S', dedupeKey: 'announcement:1' };
    await w.app.locals.notify([w.gen.user.id], 'announcement.pinned', data);
    const again = await w.app.locals.notify([w.gen.user.id], 'announcement.pinned', data);
    assert.deepEqual(again, { inApp: 0, email: 0 });
    assert.equal(w.rows(w.gen).length, 1);

    w.repo.users.find((u) => u.id === w.gen2.user.id).isActive = false;
    const none = await w.app.locals.notify([w.gen2.user.id], 'announcement.pinned', {
      title: 'T',
      summary: 'S',
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
    const sent = await notify([w.gen.user.id], 'announcement.pinned', {
      title: 'T',
      summary: 'S',
    });
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
      await w.app.locals.notify([w.gen.user.id], 'announcement.pinned', {
        link: `#announcements/${i}`,
        title: `Subject ${i}`,
        summary: 'Read it',
      });
    }
    await w.app.locals.notify([w.msr.user.id], 'announcement.pinned', {
      title: 'Masar only',
      summary: 'Read it',
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
    assert.match(list.body.items[0].vars.title, /Subject 3/, 'newest first');
    assert.equal(list.body.items[0].link, '#announcements/3');

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
    assert.equal(theirs.body.items[0].vars.title, 'Masar only');

    // A Genesis user sends a Masar notification's id: nothing is marked.
    const poke = await w.gen.post('/api/notifications/read', { ids: [masarRow.id] });
    assert.deepEqual(poke.body, { marked: 0, unread: 3 });
    assert.equal(w.rows(w.msr)[0].readAt, null);
    const ownList = await w.gen.get('/api/notifications?pageSize=100');
    assert.ok(ownList.body.items.every((i) => i.vars.title !== 'Masar only'));

    // Not even the holding admin reads other people's.
    const admin = await w.ha.get('/api/notifications');
    assert.equal(admin.body.total, 0);
  });

  test('preferences: every switch listed, saved per person, validated', async () => {
    const w = await seeded();
    const first = await w.gen.get('/api/notifications/preferences');
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.categories, ['bookings', 'announcements']);
    assert.deepEqual(first.body.channels, ['inApp', 'email']);
    assert.equal(first.body.items.length, 4);
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
