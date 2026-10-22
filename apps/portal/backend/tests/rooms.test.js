import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { GraphError } from '@mg/shared/server/integrations/graph/errors.js';
import { createMemoryCalendar } from '@mg/shared/server/integrations/graph/mock-calendar.js';
import { createClient as createMockGraph } from '@mg/shared/server/integrations/graph/mock.js';
import { createClient as createRealGraph } from '@mg/shared/server/integrations/graph/real.js';
import { createMemoryStorage } from '@mg/shared/server/lib/storage.js';
import { cairoWallOf, cairoWallToUtc } from '@mg/shared/server/lib/time.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';
import { DEFAULT_HOURS, checkSlot, expandRecurrence } from '../src/modules/rooms/rules.js';

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };

/** Sunday 11 October 2026, 11:00 in Cairo (summer time, UTC+3). */
const NOW = new Date('2026-10-11T08:00:00Z');
const MONDAY = '2026-10-12';
const TUESDAY = '2026-10-13';
const FRIDAY = '2026-10-16';

/** An instant from a Cairo day and clock time, as the API takes it. */
const at = (ymd, hhmm) =>
  cairoWallToUtc(ymd, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))).toISOString();
const clockOf = (iso) => {
  const { minutes } = cairoWallOf(new Date(iso));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

function build() {
  const repo = createMemoryUserRepo();
  const storage = createMemoryStorage();
  const app = createApp({
    config: DEV,
    userRepo: repo,
    storage,
    now: () => NOW,
    authRateLimit: { limit: 100_000 },
    rateLimit: { limit: 100_000 },
  });
  const company = (code) => repo.companies.find((c) => c.code === code);
  const userOf = (code, role, nth = 0) =>
    repo.users.filter((u) => u.company.code === code && u.roles.some((r) => r.role === role))[
      nth
    ];
  return { app, repo, storage, company, userOf };
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
    del: (path) => agent.delete(path).set('X-CSRF-Token', csrf),
    put: (path, bytes) =>
      agent.put(path).set('X-CSRF-Token', csrf).set('Content-Type', 'image/png').send(bytes),
  };
}

async function world() {
  const w = build();
  w.ha = await signIn(w.app, w.userOf('HLD', 'HoldingAdmin'));
  w.caGen = await signIn(w.app, w.userOf('GEN', 'CompanyAdmin'));
  w.caMsr = await signIn(w.app, w.userOf('MSR', 'CompanyAdmin'));
  w.gen = await signIn(w.app, w.userOf('GEN', 'User'));
  w.gen2 = await signIn(w.app, w.userOf('GEN', 'User', 1));
  w.msr = await signIn(w.app, w.userOf('MSR', 'User'));
  w.genId = w.company('GEN').id;
  w.msrId = w.company('MSR').id;
  // Sorted by name: Boardroom (16), Meeting Room 1 (4) … 4 (10), Training Room (24).
  w.rooms = (await w.gen.get('/api/rooms')).body.items;
  w.room = (name) => w.rooms.find((r) => r.nameEn === name);
  w.r1 = w.room('Meeting Room 1');
  w.r2 = w.room('Meeting Room 2');

  /** Books a room; `from`/`to` are Cairo clock times on `date`. */
  w.book = (who, { room = w.r1, date = MONDAY, from = '10:00', to = '11:00', ...rest } = {}) =>
    who.post('/api/bookings', {
      roomId: room.id,
      subject: 'Budget review',
      start: at(date, from),
      end: at(date, to),
      ...rest,
    });
  w.mustBook = async (who, options) => {
    const res = await w.book(who, options);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.items;
  };
  w.busy = async (who, date = MONDAY, room = w.r1) => {
    const res = await who.get(`/api/rooms/availability?date=${date}&roomId=${room.id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.rooms[0].busy;
  };
  return w;
}

/**
 * The mocked Exchange and the portal's rows tell the same story: every
 * confirmed booking is a live event at the same time in the same room, every
 * cancelled booking's event is cancelled, and no live event lacks a booking.
 */
function assertConsistent(w, { outlookEvents = 0 } = {}) {
  const events = new Map(w.repo.mockCalendarEvents.map((e) => [e.id, e]));
  for (const b of w.repo.bookings) {
    const event = events.get(b.graphEventId);
    assert.ok(event, `booking ${b.id} has an event`);
    assert.equal(event.isCancelled, b.status === 'cancelled', 'cancelled on both sides');
    if (b.status !== 'confirmed') continue;
    assert.equal(event.startAt.getTime(), b.startAt.getTime(), 'same start');
    assert.equal(event.endAt.getTime(), b.endAt.getTime(), 'same end');
    assert.equal(event.subject, b.subject, 'same subject');
    assert.equal(event.seriesMasterId ?? null, b.seriesMasterId ?? null, 'same series');
    assert.equal(
      event.roomEmail,
      w.repo.rooms.find((r) => r.id === b.roomId).mailboxEmail,
      'same room'
    );
  }
  const referenced = new Set(w.repo.bookings.map((b) => b.graphEventId));
  const orphans = w.repo.mockCalendarEvents.filter((e) => !referenced.has(e.id));
  assert.equal(orphans.length, outlookEvents, 'no event without a booking');
}

describe('Cairo time', () => {
  test('a wall-clock time follows the IANA zone across both daylight-saving changes', () => {
    // Summer time ends on Thursday 29 October 2026 and began on Friday 24 April.
    assert.equal(cairoWallToUtc('2026-10-25', 600).toISOString(), '2026-10-25T07:00:00.000Z');
    assert.equal(cairoWallToUtc('2026-11-01', 600).toISOString(), '2026-11-01T08:00:00.000Z');
    assert.equal(cairoWallToUtc('2026-04-23', 600).toISOString(), '2026-04-23T08:00:00.000Z');
    assert.equal(cairoWallToUtc('2026-04-26', 600).toISOString(), '2026-04-26T07:00:00.000Z');
    assert.deepEqual(cairoWallOf(new Date('2026-11-01T08:00:00Z')), {
      ymd: '2026-11-01',
      minutes: 600,
      weekday: 0,
    });
  });

  test('a weekly series keeps its local time when the clocks change', () => {
    const first = {
      start: cairoWallToUtc('2026-10-25', 600),
      end: cairoWallToUtc('2026-10-25', 660),
    };
    const series = expandRecurrence(
      first,
      { type: 'weekly', weekdays: [0], until: '2026-11-15' },
      DEFAULT_HOURS
    );
    assert.deepEqual(
      series.map((o) => o.start.toISOString()),
      [
        '2026-10-25T07:00:00.000Z', // UTC+3
        '2026-11-01T08:00:00.000Z', // UTC+2 from here on
        '2026-11-08T08:00:00.000Z',
        '2026-11-15T08:00:00.000Z',
      ]
    );
    for (const o of series) {
      assert.equal(cairoWallOf(o.start).minutes, 600);
      assert.equal(o.end.getTime() - o.start.getTime(), 3_600_000);
      checkSlot(o, DEFAULT_HOURS, NOW, { horizon: false });
    }
  });
});

describe('rooms', () => {
  test('six HQ rooms are seeded, shared by every company, and filter by size, kit and floor', async () => {
    const w = await world();
    assert.equal(w.rooms.length, 6);
    assert.ok(w.rooms.every((r) => r.restricted === false && !('mailboxEmail' in r)));
    assert.equal((await w.msr.get('/api/rooms')).body.items.length, 6);

    const big = (await w.gen.get('/api/rooms?capacity=10')).body.items;
    assert.deepEqual(big.map((r) => r.nameEn).sort(), [
      'Boardroom',
      'Meeting Room 4',
      'Training Room',
    ]);
    const kit = (await w.gen.get('/api/rooms?equipment=videoConference,whiteboard')).body.items;
    assert.deepEqual(kit.map((r) => r.nameEn).sort(), ['Boardroom', 'Meeting Room 3']);
    const floor = (await w.gen.get('/api/rooms?floor=1')).body.items;
    assert.deepEqual(floor.map((r) => r.nameEn).sort(), ['Meeting Room 1', 'Meeting Room 2']);
    assert.equal((await w.gen.get('/api/rooms?equipment=jacuzzi')).status, 400);

    assert.equal((await request(w.app).get('/api/rooms')).status, 401);
  });

  test('the room list carries the reader’s company’s working hours', async () => {
    const w = await world();
    const { hours } = (await w.gen.get('/api/rooms')).body;
    assert.deepEqual(hours, {
      workdayStartMin: 480,
      workdayEndMin: 1080,
      workingDays: [0, 1, 2, 3, 4],
    });
  });

  test('a restricted room exists only for its companies', async () => {
    const w = await world();
    const all = (await w.ha.get('/api/admin/rooms')).body.items;
    const boardroom = all.find((r) => r.nameEn === 'Boardroom');
    const restricted = await w.ha.patch(`/api/admin/rooms/${boardroom.id}`, {
      updatedAt: boardroom.updatedAt,
      companyIds: [w.msrId],
    });
    assert.equal(restricted.status, 200, JSON.stringify(restricted.body));

    // Genesis: not listed, not found, not bookable, not in availability or quick-find.
    const forGen = (await w.gen.get('/api/rooms')).body.items;
    assert.equal(forGen.length, 5);
    assert.equal((await w.gen.get(`/api/rooms/${boardroom.id}`)).status, 404);
    assert.equal((await w.book(w.gen, { room: boardroom })).status, 404);
    assert.equal(
      (await w.gen.get(`/api/rooms/availability?date=${MONDAY}&roomId=${boardroom.id}`)).status,
      404
    );
    const week = await w.gen.get(`/api/rooms/availability?date=${MONDAY}&view=week`);
    assert.equal(week.body.rooms.length, 5);
    const found = await w.gen.get(
      `/api/rooms/find?date=${MONDAY}&start=10:00&duration=60&people=12`
    );
    assert.deepEqual(
      found.body.rooms.map((r) => r.nameEn),
      ['Training Room']
    );
    // Even a Genesis admin: the list names companies, not roles.
    assert.equal((await w.caGen.get(`/api/rooms/${boardroom.id}`)).status, 404);

    // Masar and the holding admin: there, and marked restricted.
    const forMsr = (await w.msr.get(`/api/rooms/${boardroom.id}`)).body;
    assert.equal(forMsr.restricted, true);
    assert.equal((await w.book(w.msr, { room: boardroom })).status, 201);
    assert.equal((await w.ha.get(`/api/rooms/${boardroom.id}`)).status, 200);
    assert.equal(w.repo.bookings.length, 1);
    assertConsistent(w);
  });
});

describe('booking a room', () => {
  test('a booking is a row in the portal and an event in the calendar', async () => {
    const w = await world();
    const [booking] = await w.mustBook(w.gen, { attendeeCount: 3 });
    assert.equal(booking.subject, 'Budget review');
    assert.equal(booking.room.id, w.r1.id);
    assert.equal(booking.organiser.id, w.gen.user.id);
    assert.equal(booking.start, at(MONDAY, '10:00'));
    assert.equal(booking.start, '2026-10-12T07:00:00.000Z'); // stored in UTC
    assert.deepEqual(
      [
        booking.status,
        booking.recurring,
        booking.mine,
        booking.canManage,
        booking.attendeeCount,
      ],
      ['confirmed', false, true, true, 3]
    );
    assert.ok(!('graphEventId' in booking));

    const [row] = w.repo.bookings;
    assert.equal(row.companyId, w.genId, 'the organiser’s company');
    const [event] = w.repo.mockCalendarEvents;
    assert.equal(event.organiserEmail, w.gen.user.email);
    assert.equal(event.roomEmail, 'room-hq-1@mgholding.example');
    assert.equal(row.graphEventId, event.id);
    assertConsistent(w);
    // The organiser booking for themselves is not an admin action.
    assert.equal(w.repo.auditLogs.length, 0);
  });

  test('an overlapping booking is refused with the conflicting time; back to back is fine', async () => {
    const w = await world();
    await w.mustBook(w.gen);

    for (const [from, to] of [
      ['10:00', '11:00'],
      ['10:30', '11:30'],
      ['09:30', '10:15'],
      ['10:15', '10:45'],
    ]) {
      const clash = await w.book(w.msr, { from, to });
      assert.equal(clash.status, 409, `${from}-${to}`);
      assert.equal(clash.body.error.code, 'room_conflict');
      assert.deepEqual(clash.body.error.details.conflicts, [
        { date: MONDAY, start: at(MONDAY, from), end: at(MONDAY, to) },
      ]);
    }
    assert.equal(w.repo.bookings.length, 1);

    await w.mustBook(w.msr, { from: '11:00', to: '12:00' });
    await w.mustBook(w.msr, { from: '09:00', to: '10:00' });
    // Another room at the same time is nobody's conflict.
    await w.mustBook(w.msr, { room: w.r2 });
    assertConsistent(w);
  });

  test('the calendar has the last word when two people book at once', async () => {
    const w = await world();
    const calendar = createMemoryCalendar(w.repo.mockCalendarEvents);
    const inner = createMockGraph(undefined, { calendar });
    // The schedule says free (a stale answer); creating the event still collides.
    const racing = {
      ...inner,
      getSchedule: async (emails) => emails.map((e) => ({ roomEmail: e, items: [] })),
    };
    const app = createApp({
      config: DEV,
      userRepo: w.repo,
      graph: racing,
      now: () => NOW,
      authRateLimit: { limit: 100_000 },
      rateLimit: { limit: 100_000 },
    });
    const gen = await signIn(app, w.gen.user);
    const msr = await signIn(app, w.msr.user);
    const body = {
      roomId: w.r1.id,
      subject: 'Stand-up',
      start: at(MONDAY, '10:00'),
      end: at(MONDAY, '10:30'),
    };
    assert.equal((await gen.post('/api/bookings', body)).status, 201);
    const second = await msr.post('/api/bookings', body);
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'room_conflict');
    assert.equal(w.repo.bookings.length, 1);
    assertConsistent(w);
  });

  test('more people than seats, or an unknown attendee, is refused', async () => {
    const w = await world();
    const over = await w.book(w.gen, { attendeeCount: 5 }); // Meeting Room 1 seats 4
    assert.equal(over.status, 400);
    assert.equal(over.body.error.code, 'over_capacity');
    assert.equal(over.body.error.details.capacity, 4);

    const ghost = await w.book(w.gen, {
      attendeeIds: ['99999999-0000-4000-8000-000000000001'],
    });
    assert.equal(ghost.status, 400);
    assert.equal(ghost.body.error.code, 'unknown_attendee');
    assert.equal(w.repo.bookings.length, 0);
    assert.equal(w.repo.mockCalendarEvents.length, 0);
  });
});

describe('working hours and the working week', () => {
  const refused = async (w, who, options, code) => {
    const res = await w.book(who, options);
    assert.equal(res.status, 400, `${JSON.stringify(options)} → ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error.code, code);
    return res.body.error;
  };

  test('Friday and Saturday are refused with a clear message', async () => {
    const w = await world();
    const friday = await refused(w, w.gen, { date: FRIDAY }, 'not_a_working_day');
    assert.match(friday.message, /Friday is not a working day/);
    assert.match(friday.message, /08:00 to 18:00 Cairo time/);
    assert.deepEqual(friday.details.workingDays, [0, 1, 2, 3, 4]);
    await refused(w, w.gen, { date: '2026-10-17' }, 'not_a_working_day');
    // Thursday and Sunday are working days.
    await w.mustBook(w.gen, { date: '2026-10-15' });
    await w.mustBook(w.gen, { date: '2026-10-18' });
  });

  test('before 08:00 and after 18:00 are refused; the edges are allowed', async () => {
    const w = await world();
    const early = await refused(
      w,
      w.gen,
      { from: '07:45', to: '08:30' },
      'outside_working_hours'
    );
    assert.match(early.message, /outside working hours/);
    assert.deepEqual(
      [early.details.workdayStartMin, early.details.workdayEndMin, early.details.timeZone],
      [480, 1080, 'Africa/Cairo']
    );
    await refused(w, w.gen, { from: '17:30', to: '18:15' }, 'outside_working_hours');
    await refused(w, w.gen, { from: '19:00', to: '20:00' }, 'outside_working_hours');

    await w.mustBook(w.gen, { from: '08:00', to: '09:00' });
    await w.mustBook(w.gen, { from: '17:00', to: '18:00' });
  });

  test('working hours are a company setting', async () => {
    const w = await world();
    const company = (await w.ha.get(`/api/admin/companies/${w.genId}`)).body;
    assert.deepEqual(
      [company.workdayStartMin, company.workdayEndMin, company.workingDays],
      [480, 1080, [0, 1, 2, 3, 4]]
    );
    const changed = await w.ha.patch(`/api/admin/companies/${w.genId}`, {
      updatedAt: company.updatedAt,
      workdayEndMin: 20 * 60,
      workingDays: [6, 0, 1, 2, 3, 4],
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.deepEqual(changed.body.workingDays, [0, 1, 2, 3, 4, 6]);
    assert.ok(w.repo.auditLogs.some((a) => a.action === 'company.update'));

    // Genesis now books until 20:00 and on Saturdays; Masar does not.
    await w.mustBook(w.gen, { from: '18:30', to: '19:30' });
    await w.mustBook(w.gen, { date: '2026-10-17' });
    await refused(
      w,
      w.msr,
      { room: w.r2, from: '18:30', to: '19:30' },
      'outside_working_hours'
    );
    await refused(w, w.msr, { room: w.r2, date: '2026-10-17' }, 'not_a_working_day');
    assert.equal(
      (await w.gen.get(`/api/rooms/availability?date=${MONDAY}`)).body.hours.workdayEndMin,
      1200
    );

    const upsideDown = await w.ha.patch(`/api/admin/companies/${w.genId}`, {
      updatedAt: changed.body.updatedAt,
      workdayStartMin: 21 * 60,
    });
    assert.equal(upsideDown.status, 400);
    assert.equal(upsideDown.body.error.code, 'working_hours_invalid');
  });

  test('quarter hours only, 15 minutes to 8 hours, not in the past, 90 days ahead at most', async () => {
    const w = await world();
    await refused(w, w.gen, { from: '10:10', to: '11:00' }, 'booking_granularity');
    await refused(w, w.gen, { from: '10:00', to: '10:50' }, 'booking_granularity');
    const seconds = await w.gen.post('/api/bookings', {
      roomId: w.r1.id,
      subject: 'Odd',
      start: '2026-10-12T07:00:30Z',
      end: '2026-10-12T08:00:00Z',
    });
    assert.equal(seconds.body.error.code, 'booking_granularity');

    await refused(w, w.gen, { from: '10:00', to: '10:00' }, 'booking_too_short');
    await refused(w, w.gen, { from: '11:00', to: '10:00' }, 'booking_too_short');
    await refused(w, w.gen, { from: '08:00', to: '16:15' }, 'booking_too_long');
    await w.mustBook(w.gen, { from: '10:00', to: '10:15' });
    await w.mustBook(w.gen, { room: w.r2, from: '08:00', to: '16:00' });

    // Today is Sunday 11:00: 10:00 has gone, 11:00 has not.
    await refused(
      w,
      w.gen,
      { date: '2026-10-11', from: '10:00', to: '10:30' },
      'booking_in_past'
    );
    await w.mustBook(w.gen, { date: '2026-10-11', from: '11:00', to: '11:30' });

    // 90 days ahead is Saturday 9 January; the Thursday before is in, the Sunday after is out.
    await w.mustBook(w.gen, { date: '2027-01-07' });
    await refused(w, w.gen, { date: '2027-01-10' }, 'booking_too_far');
    assertConsistent(w);
  });
});

describe('recurring bookings', () => {
  test('weekly on chosen days: one row and one event per occurrence, in one series', async () => {
    const w = await world();
    const items = await w.mustBook(w.gen, {
      recurrence: { type: 'weekly', weekdays: [1, 3], until: '2026-10-28' },
    });
    assert.deepEqual(
      items.map((b) => cairoWallOf(new Date(b.start)).ymd),
      ['2026-10-12', '2026-10-14', '2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28']
    );
    assert.ok(items.every((b) => b.recurring && b.recurrence.type === 'weekly'));
    assert.equal(new Set(w.repo.bookings.map((b) => b.seriesMasterId)).size, 1);
    assert.match(w.repo.bookings[0].seriesMasterId, /^mock-series-/);
    // The screens fold a series by this id: the same on every occurrence.
    assert.equal(new Set(items.map((b) => b.seriesId)).size, 1);
    assert.equal(items[0].seriesId, w.repo.bookings[0].seriesMasterId);
    assertConsistent(w);
  });

  test('a single booking has no series id', async () => {
    const w = await world();
    const items = await w.mustBook(w.gen, {});
    assert.equal(items[0].seriesId, null);
  });

  test('daily means working days only', async () => {
    const w = await world();
    const items = await w.mustBook(w.gen, {
      recurrence: { type: 'daily', until: '2026-10-20' },
    });
    assert.deepEqual(
      items.map((b) => cairoWallOf(new Date(b.start)).ymd),
      // No Friday 16th, no Saturday 17th.
      [
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-18',
        '2026-10-19',
        '2026-10-20',
      ]
    );
  });

  test('a series crossing the end of summer time keeps its local time', async () => {
    const w = await world();
    const items = await w.mustBook(w.gen, {
      date: '2026-10-25',
      recurrence: { type: 'weekly', weekdays: [0], until: '2026-11-15' },
    });
    assert.deepEqual(
      items.map((b) => b.start),
      [
        '2026-10-25T07:00:00.000Z',
        '2026-11-01T08:00:00.000Z',
        '2026-11-08T08:00:00.000Z',
        '2026-11-15T08:00:00.000Z',
      ]
    );
    assert.deepEqual(
      items.map((b) => `${clockOf(b.start)}-${clockOf(b.end)}`),
      Array(4).fill('10:00-11:00')
    );
    // The calendar holds the same instants.
    assert.deepEqual(
      w.repo.mockCalendarEvents.map((e) => e.startAt.toISOString()),
      items.map((b) => b.start)
    );
    // Someone else wanting 10:00 Cairo time in November is in conflict.
    const clash = await w.book(w.msr, { date: '2026-11-08' });
    assert.equal(clash.status, 409);
    // 09:00 Cairo time in November is the UTC hour the series had in October: free.
    await w.mustBook(w.msr, { date: '2026-11-08', from: '09:00', to: '10:00' });
    assertConsistent(w);
  });

  test('any conflict refuses the whole series, naming the dates, and creates nothing', async () => {
    const w = await world();
    await w.mustBook(w.msr, { date: '2026-10-19', from: '10:30', to: '11:30' });
    await w.mustBook(w.msr, { date: '2026-11-02', from: '09:00', to: '10:15' });
    const before = [w.repo.bookings.length, w.repo.mockCalendarEvents.length];

    const res = await w.book(w.gen, {
      recurrence: { type: 'weekly', weekdays: [1], until: '2026-11-09' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'room_conflict');
    assert.match(res.body.error.message, /2 of those times\. Nothing was booked/);
    assert.deepEqual(
      res.body.error.details.conflicts.map((c) => c.date),
      ['2026-10-19', '2026-11-02']
    );
    assert.deepEqual([w.repo.bookings.length, w.repo.mockCalendarEvents.length], before);
    assertConsistent(w);
  });

  test('a series runs six months at most, on working days, and includes its first day', async () => {
    const w = await world();
    const code = async (recurrence, options = {}) => {
      const res = await w.book(w.gen, { ...options, recurrence });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      return res.body.error.code;
    };
    assert.equal(await code({ type: 'daily', until: '2027-04-13' }), 'recurrence_too_long');
    assert.equal(
      await code({ type: 'daily', until: '2026-10-11' }),
      'recurrence_ends_before_start'
    );
    assert.equal(
      await code({ type: 'weekly', weekdays: [1, 5], until: '2026-11-30' }),
      'not_a_working_day'
    );
    // Monday's meeting, repeated on Wednesdays only.
    assert.equal(
      await code({ type: 'weekly', weekdays: [3], until: '2026-11-30' }),
      'recurrence_day_mismatch'
    );
    assert.equal(w.repo.bookings.length, 0);

    // Exactly six months is allowed: every Monday from 12 October to 12 April.
    const items = await w.mustBook(w.gen, {
      recurrence: { type: 'weekly', weekdays: [1], until: '2027-04-12' },
    });
    assert.equal(items.length, 27);
    assert.equal(items.at(-1).start, at('2027-04-12', '10:00'));
    assertConsistent(w);
  });
});

describe('privacy of subjects', () => {
  test('others see busy with the organiser’s name; the organiser, attendees and admins see the subject', async () => {
    const w = await world();
    const [booking] = await w.mustBook(w.gen, {
      subject: 'Redundancy plan',
      attendeeIds: [w.gen2.user.id],
    });

    const seenBy = async (who) => (await w.busy(who))[0];
    for (const [name, who] of [
      ['a Masar user', w.msr],
      ['a Masar admin', w.caMsr],
    ]) {
      const block = await seenBy(who);
      assert.equal(block.subject, null, name);
      assert.equal(block.bookingId, null, name);
      assert.equal(block.mine, false, name);
      assert.equal(block.organiser.id, w.gen.user.id, name);
      assert.deepEqual(Object.keys(block.organiser).sort(), [
        'displayNameAr',
        'displayNameEn',
        'id',
      ]);
      assert.equal(block.start, at(MONDAY, '10:00'));
      assert.ok(!JSON.stringify(block).includes('Redundancy'), name);
      // The booking itself does not exist for them.
      assert.equal((await who.get(`/api/bookings/${booking.id}`)).status, 404, name);
    }

    for (const [name, who] of [
      ['the organiser', w.gen],
      ['an attendee', w.gen2],
      ['the organiser’s company admin', w.caGen],
      ['the holding admin', w.ha],
    ]) {
      const block = await seenBy(who);
      assert.equal(block.subject, 'Redundancy plan', name);
      assert.equal(block.bookingId, booking.id, name);
      const detail = await who.get(`/api/bookings/${booking.id}`);
      assert.equal(detail.status, 200, name);
      assert.equal(detail.body.subject, 'Redundancy plan', name);
    }
    assert.equal((await seenBy(w.gen)).mine, true);
    assert.equal((await w.gen2.get(`/api/bookings/${booking.id}`)).body.canManage, false);

    // A colleague in the same company who was not invited sees no more than a stranger.
    const colleague = await signIn(w.app, w.userOf('GEN', 'User', 2));
    assert.equal((await seenBy(colleague)).subject, null);
  });

  test('my bookings lists my own upcoming ones, soonest first', async () => {
    const w = await world();
    await w.mustBook(w.gen, { date: TUESDAY });
    await w.mustBook(w.gen, { from: '14:00', to: '15:00' });
    await w.mustBook(w.msr, { room: w.r2 });

    const mine = (await w.gen.get('/api/bookings/mine')).body.items;
    assert.deepEqual(
      mine.map((b) => b.start),
      [at(MONDAY, '14:00'), at(TUESDAY, '10:00')]
    );
    assert.ok(mine.every((b) => b.mine && b.subject === 'Budget review'));
    assert.equal((await w.msr.get('/api/bookings/mine')).body.items.length, 1);
    assert.equal((await w.gen2.get('/api/bookings/mine')).body.items.length, 0);
  });
});

describe('changing and cancelling', () => {
  test('the organiser moves and renames a booking; moving re-checks conflicts', async () => {
    const w = await world();
    const [booking] = await w.mustBook(w.gen);
    await w.mustBook(w.msr, { from: '12:00', to: '13:00' });

    const renamed = await w.gen.patch(`/api/bookings/${booking.id}`, {
      subject: 'Budget, round 2',
    });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.subject, 'Budget, round 2');

    // Into Masar's hour: refused, and nothing moves.
    const clash = await w.gen.patch(`/api/bookings/${booking.id}`, {
      start: at(MONDAY, '11:30'),
      end: at(MONDAY, '12:30'),
    });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.code, 'room_conflict');
    assert.equal(w.repo.bookings[0].startAt.toISOString(), at(MONDAY, '10:00'));

    // Half an hour later overlaps only its own old time: allowed.
    const moved = await w.gen.patch(`/api/bookings/${booking.id}`, {
      start: at(MONDAY, '10:30'),
      end: at(MONDAY, '11:30'),
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.start, at(MONDAY, '10:30'));

    // The same rules as a new booking.
    for (const [start, end, code] of [
      [at(FRIDAY, '10:00'), at(FRIDAY, '11:00'), 'not_a_working_day'],
      [at(MONDAY, '18:00'), at(MONDAY, '19:00'), 'outside_working_hours'],
      [at(MONDAY, '10:05'), at(MONDAY, '11:00'), 'booking_granularity'],
    ]) {
      const res = await w.gen.patch(`/api/bookings/${booking.id}`, { start, end });
      assert.equal(res.body.error?.code, code);
    }
    assert.equal((await w.gen.patch(`/api/bookings/${booking.id}`, {})).status, 400);
    assert.equal(
      (await w.gen.patch(`/api/bookings/${booking.id}`, { start: at(MONDAY, '09:00') })).status,
      400
    );
    assert.equal(
      w.repo.auditLogs.length,
      0,
      'an organiser’s own changes are not admin actions'
    );
    assertConsistent(w);
  });

  test('an admin moves a booking to another room: conflicts are checked there, and a reason is needed', async () => {
    const w = await world();
    const [booking] = await w.mustBook(w.gen);
    const spare = w.rooms.find((r) => r.id !== w.r1.id && r.id !== w.r2.id);
    await w.mustBook(w.msr, { room: w.r2, from: '10:00', to: '11:00' });

    const clash = await w.caGen.patch(`/api/bookings/${booking.id}`, {
      roomId: w.r2.id,
      reason: 'Closed for repairs',
    });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.code, 'room_conflict');
    assert.equal(w.repo.bookings[0].roomId, w.r1.id);

    const silent = await w.caGen.patch(`/api/bookings/${booking.id}`, { roomId: spare.id });
    assert.equal(silent.status, 400);
    assert.equal(silent.body.error.code, 'reason_required');

    const moved = await w.caGen.patch(`/api/bookings/${booking.id}`, {
      roomId: spare.id,
      reason: 'Closed for repairs',
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.room.id, spare.id);
    assert.equal(w.repo.bookings[0].roomId, spare.id);
    // The old room is free again.
    assert.deepEqual(await w.busy(w.gen, MONDAY, w.r1), []);
    assert.equal(w.repo.auditLogs.at(-1).action, 'booking.admin.update');
    assertConsistent(w);
  });

  test('nobody else can change or cancel it: another company, a colleague, an attendee', async () => {
    const w = await world();
    const [booking] = await w.mustBook(w.gen, { attendeeIds: [w.gen2.user.id] });
    const colleague = await signIn(w.app, w.userOf('GEN', 'User', 2));
    const move = { start: at(MONDAY, '14:00'), end: at(MONDAY, '15:00') };

    for (const [name, who, status] of [
      ['a Masar user', w.msr, 404],
      ['a Masar admin', w.caMsr, 404],
      ['an uninvited colleague', colleague, 404],
      ['an attendee', w.gen2, 403],
    ]) {
      assert.equal((await who.patch(`/api/bookings/${booking.id}`, move)).status, status, name);
      assert.equal(
        (await who.patch(`/api/bookings/${booking.id}`, { subject: 'Mine now' })).status,
        status,
        name
      );
      assert.equal((await who.post(`/api/bookings/${booking.id}/cancel`)).status, status, name);
    }
    const [row] = w.repo.bookings;
    assert.deepEqual(
      [row.status, row.subject, row.startAt.toISOString()],
      ['confirmed', 'Budget review', at(MONDAY, '10:00')]
    );
    assert.equal(w.repo.auditLogs.length, 0);
    assertConsistent(w);
  });

  test('an admin of the organiser’s company can change and cancel it, and that is audited', async () => {
    const w = await world();
    const [booking] = await w.mustBook(w.gen);

    // Moving someone else's meeting needs a reason, then it is audited with it.
    const unexplained = await w.caGen.patch(`/api/bookings/${booking.id}`, {
      start: at(MONDAY, '15:00'),
      end: at(MONDAY, '16:00'),
    });
    assert.equal(unexplained.status, 400);
    assert.equal(unexplained.body.error.code, 'reason_required');
    assert.equal(w.repo.bookings[0].startAt.toISOString(), at(MONDAY, '10:00'));

    const moved = await w.caGen.patch(`/api/bookings/${booking.id}`, {
      start: at(MONDAY, '15:00'),
      end: at(MONDAY, '16:00'),
      reason: 'The room is needed for an audit',
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const [edit] = w.repo.auditLogs;
    assert.equal(JSON.parse(edit.after).reason, 'The room is needed for an audit');
    assert.deepEqual(
      [edit.action, edit.entity, edit.entityId, edit.actorId, edit.companyId],
      ['booking.admin.update', 'Booking', booking.id, w.caGen.user.id, w.genId]
    );
    assert.equal(JSON.parse(edit.before).startAt, at(MONDAY, '10:00'));
    assert.equal(JSON.parse(edit.after).startAt, at(MONDAY, '15:00'));

    // An administrator says why: without a reason nothing is cancelled.
    const silent = await w.ha.post(`/api/bookings/${booking.id}/cancel`);
    assert.equal(silent.status, 400);
    assert.equal(silent.body.error.code, 'reason_required');
    assert.equal(w.repo.bookings[0].status, 'confirmed');

    const cancelled = await w.ha.post(`/api/bookings/${booking.id}/cancel`, {
      reason: 'The room is closed for repairs',
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.deepEqual(cancelled.body.cancelled, [booking.id]);
    const cancel = w.repo.auditLogs[1];
    assert.deepEqual(
      [cancel.action, cancel.actorId, cancel.companyId],
      ['booking.admin.cancel', w.ha.user.id, w.genId]
    );
    assert.equal(JSON.parse(cancel.after).status, 'cancelled');
    assert.equal(JSON.parse(cancel.after).reason, 'The room is closed for repairs');
    assert.equal(w.repo.bookings[0].cancelledById, w.ha.user.id);
    assert.equal(w.repo.bookings[0].cancelReason, 'The room is closed for repairs');
    // The organiser reads the reason on their booking; the admin list shows it too.
    assert.equal(
      (await w.gen.get(`/api/bookings/${booking.id}`)).body.cancelReason,
      'The room is closed for repairs'
    );
    const listed = (await w.ha.get('/api/admin/bookings?status=cancelled')).body.items;
    assert.equal(listed[0].cancelReason, 'The room is closed for repairs');

    // Cancelled is final, and the room is free again.
    assert.equal(
      (await w.gen.post(`/api/bookings/${booking.id}/cancel`)).body.error.code,
      'booking_cancelled'
    );
    assert.equal(
      (await w.gen.patch(`/api/bookings/${booking.id}`, { subject: 'Back?' })).body.error.code,
      'booking_cancelled'
    );
    assert.deepEqual(await w.busy(w.msr), []);
    await w.mustBook(w.msr, { from: '15:00', to: '16:00' });
    assertConsistent(w);
  });

  test('cancelling one occurrence leaves the rest; cancelling the series ends it from there', async () => {
    const w = await world();
    const items = await w.mustBook(w.gen, {
      recurrence: { type: 'weekly', weekdays: [1], until: '2026-11-09' },
    });
    assert.equal(items.length, 5); // 12, 19, 26 Oct; 2, 9 Nov
    const statuses = () =>
      w.repo.bookings.map((b) => (b.status[1] === 'o' ? '✓' : '✗')).join('');

    const one = await w.gen.post(`/api/bookings/${items[1].id}/cancel`, { scope: 'one' });
    assert.deepEqual(one.body.cancelled, [items[1].id]);
    assert.equal(statuses(), '✓✗✓✓✓');
    assertConsistent(w);

    // From the fourth on: the fourth and fifth go, the first and third stay.
    const rest = await w.gen.post(`/api/bookings/${items[3].id}/cancel`, { scope: 'series' });
    assert.deepEqual(rest.body.cancelled, [items[3].id, items[4].id]);
    assert.equal(statuses(), '✓✗✓✗✗');
    assertConsistent(w);

    assert.deepEqual(
      (await w.gen.get('/api/bookings/mine')).body.items.map((b) => b.id),
      [items[0].id, items[2].id]
    );
    // The freed Mondays can be booked by someone else.
    await w.mustBook(w.msr, { date: '2026-10-19' });
    await w.mustBook(w.msr, { date: '2026-11-09' });
    assertConsistent(w);

    // A single booking has no series to cancel.
    const [single] = await w.mustBook(w.gen, { room: w.r2 });
    const wrong = await w.gen.post(`/api/bookings/${single.id}/cancel`, { scope: 'series' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'not_recurring');
  });

  test('an organiser may cancel with or without a reason, and it is kept', async () => {
    const w = await world();
    const [first] = await w.mustBook(w.gen);
    assert.equal((await w.gen.post(`/api/bookings/${first.id}/cancel`)).status, 200);
    assert.equal(w.repo.bookings[0].cancelReason, null);

    const [second] = await w.mustBook(w.gen);
    const res = await w.gen.post(`/api/bookings/${second.id}/cancel`, {
      reason: 'Moved online',
    });
    assert.equal(res.status, 200);
    assert.equal(w.repo.bookings[1].cancelReason, 'Moved online');
    // Their own bookings are not an admin action: nothing is audited.
    assert.equal(w.repo.auditLogs.length, 0);
    // Too long is refused, not cut.
    const [third] = await w.mustBook(w.gen);
    const long = await w.gen.post(`/api/bookings/${third.id}/cancel`, {
      reason: 'x'.repeat(501),
    });
    assert.equal(long.status, 400);
  });

  test('an admin cancelling a series is one audit entry with the count', async () => {
    const w = await world();
    const items = await w.mustBook(w.msr, {
      recurrence: { type: 'daily', until: '2026-10-14' },
    });
    // The Genesis admin has no say over a Masar meeting.
    assert.equal(
      (await w.caGen.post(`/api/bookings/${items[0].id}/cancel`, { scope: 'series' })).status,
      404
    );
    const res = await w.caMsr.post(`/api/bookings/${items[0].id}/cancel`, {
      scope: 'series',
      reason: 'Replaced by the site visit',
    });
    assert.equal(res.body.cancelled.length, 3);
    assert.equal(w.repo.auditLogs.length, 1);
    const after = JSON.parse(w.repo.auditLogs[0].after);
    assert.deepEqual([after.scope, after.cancelled, after.status], ['series', 3, 'cancelled']);
    assert.equal(after.reason, 'Replaced by the site visit');
    assert.ok(w.repo.bookings.every((b) => b.cancelReason === 'Replaced by the site visit'));
    assert.equal(w.repo.auditLogs[0].companyId, w.msrId);
    assertConsistent(w);
  });

  test('a meeting that is over can no longer be changed', async () => {
    const w = await world();
    const [booking] = await w.mustBook(w.gen, {
      date: '2026-10-11',
      from: '11:00',
      to: '11:30',
    });
    const later = createApp({
      config: DEV,
      userRepo: w.repo,
      now: () => new Date('2026-10-11T09:00:00Z'), // 12:00 in Cairo
      authRateLimit: { limit: 100_000 },
      rateLimit: { limit: 100_000 },
    });
    const gen = await signIn(later, w.gen.user);
    assert.equal(
      (await gen.post(`/api/bookings/${booking.id}/cancel`)).body.error.code,
      'booking_finished'
    );
    assert.equal((await gen.get('/api/bookings/mine')).body.items.length, 0);
    assert.equal((await gen.get(`/api/bookings/${booking.id}`)).body.canManage, false);
  });
});

describe('Exchange is the source of truth', () => {
  /** A meeting made in Outlook: in the calendar, unknown to the portal. */
  const inOutlook = (w, { date = MONDAY, from = '10:00', to = '11:00' } = {}) =>
    w.repo.mockCalendarEvents.push({
      id: 'outlook-1',
      seriesMasterId: null,
      organiserEmail: 'someone@mgholding.example',
      roomEmail: 'room-hq-1@mgholding.example',
      subject: 'Made in Outlook',
      startAt: new Date(at(date, from)),
      endAt: new Date(at(date, to)),
      recurrence: null,
      attendees: '[]',
      isCancelled: false,
    });

  test('a meeting booked in Outlook blocks the room and shows as plain busy', async () => {
    const w = await world();
    inOutlook(w);

    const [block] = await w.busy(w.ha);
    assert.deepEqual(
      [block.organiser, block.subject, block.bookingId, block.mine],
      [null, null, null, false]
    );
    const clash = await w.book(w.gen, { from: '10:30', to: '11:30' });
    assert.equal(clash.status, 409);
    const free = await w.gen.get(`/api/rooms/find?date=${MONDAY}&start=10:00&duration=60`);
    assert.ok(!free.body.rooms.some((r) => r.id === w.r1.id));
    assert.equal(free.body.rooms.length, 5);
    assertConsistent(w, { outlookEvents: 1 });
  });

  test('a booking cancelled or moved in Outlook follows in the portal', async () => {
    const w = await world();
    const [gone] = await w.mustBook(w.gen);
    const [moved] = await w.mustBook(w.gen, { date: TUESDAY });
    const eventOf = (booking) =>
      w.repo.mockCalendarEvents.find(
        (e) => e.id === w.repo.bookings.find((b) => b.id === booking.id).graphEventId
      );
    eventOf(gone).isCancelled = true;
    Object.assign(eventOf(moved), {
      startAt: new Date(at(TUESDAY, '13:00')),
      endAt: new Date(at(TUESDAY, '14:00')),
    });

    const mine = (await w.gen.get('/api/bookings/mine')).body.items;
    assert.deepEqual(
      mine.map((b) => [b.id, b.start]),
      [[moved.id, at(TUESDAY, '13:00')]]
    );
    const row = w.repo.bookings.find((b) => b.id === gone.id);
    assert.deepEqual([row.status, row.cancelledById], ['cancelled', null]);
    assertConsistent(w);

    // Changing a meeting Exchange has dropped says so, and tidies the row.
    const [third] = await w.mustBook(w.gen, { room: w.r2 });
    eventOf(third).isCancelled = true;
    const res = await w.gen.patch(`/api/bookings/${third.id}`, { subject: 'Still on?' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'booking_gone');
    assert.equal(w.repo.bookings.find((b) => b.id === third.id).status, 'cancelled');
    assertConsistent(w);
  });

  test('the calendar being unreachable is said plainly, and nothing is half-booked', async () => {
    const w = await world();
    const down = {
      ...createMockGraph(undefined, {
        calendar: createMemoryCalendar(w.repo.mockCalendarEvents),
      }),
      createEvent: async () => {
        throw new GraphError('delegated_token_missing');
      },
    };
    const app = createApp({
      config: DEV,
      userRepo: w.repo,
      graph: down,
      now: () => NOW,
      authRateLimit: { limit: 100_000 },
      rateLimit: { limit: 100_000 },
    });
    const gen = await signIn(app, w.gen.user);
    const res = await gen.post('/api/bookings', {
      roomId: w.r1.id,
      subject: 'Stand-up',
      start: at(MONDAY, '10:00'),
      end: at(MONDAY, '10:30'),
    });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'calendar_unavailable');
    assert.equal(w.repo.bookings.length, 0);
  });
});

describe('availability and quick-find', () => {
  test('a day and a week of busy times, per room', async () => {
    const w = await world();
    await w.mustBook(w.gen);
    await w.mustBook(w.gen, { date: '2026-10-15', from: '09:00', to: '09:30' });
    await w.mustBook(w.msr, { room: w.r2, date: '2026-10-18' }); // next week

    const day = (await w.gen.get(`/api/rooms/availability?date=${MONDAY}`)).body;
    assert.deepEqual(day.days, [MONDAY]);
    assert.equal(day.from, '2026-10-11T21:00:00.000Z'); // Cairo midnight
    assert.equal(day.rooms.length, 6);
    assert.deepEqual(day.hours, {
      workdayStartMin: 480,
      workdayEndMin: 1080,
      workingDays: [0, 1, 2, 3, 4],
    });
    const busy = Object.fromEntries(day.rooms.map((r) => [r.room.nameEn, r.busy.length]));
    assert.equal(busy['Meeting Room 1'], 1);
    assert.equal(busy['Meeting Room 2'], 0);

    // Wednesday's week runs Sunday 11th to Saturday 17th.
    const week = (await w.gen.get(`/api/rooms/availability?date=2026-10-14&view=week`)).body;
    assert.deepEqual(
      [week.days[0], week.days[6], week.days.length],
      ['2026-10-11', '2026-10-17', 7]
    );
    const r1 = week.rooms.find((r) => r.room.id === w.r1.id);
    assert.deepEqual(
      r1.busy.map((b) => b.start),
      [at(MONDAY, '10:00'), at('2026-10-15', '09:00')]
    );
    assert.equal(week.rooms.find((r) => r.room.id === w.r2.id).busy.length, 0);

    const filtered = (await w.gen.get(`/api/rooms/availability?date=${MONDAY}&capacity=16`))
      .body;
    assert.equal(filtered.rooms.length, 2);
    assert.equal((await w.gen.get('/api/rooms/availability?date=2026-02-30')).status, 400);
  });

  test('quick-find returns the free rooms that fit, smallest first', async () => {
    const w = await world();
    await w.mustBook(w.msr, { room: w.room('Meeting Room 3') });

    const find = async (qs) => {
      const res = await w.gen.get(`/api/rooms/find?date=${MONDAY}&${qs}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body;
    };
    const six = await find('start=10:00&duration=60&people=6&equipment=videoConference');
    assert.deepEqual(
      six.rooms.map((r) => r.nameEn),
      ['Meeting Room 2', 'Meeting Room 4', 'Boardroom'] // Room 3 is busy
    );
    assert.equal(six.start, at(MONDAY, '10:00'));
    assert.equal(six.end, at(MONDAY, '11:00'));

    // An hour later Room 3 is free again.
    const later = await find('start=11:00&duration=30&people=6&equipment=videoConference');
    assert.deepEqual(later.rooms.map((r) => r.nameEn).slice(0, 2), [
      'Meeting Room 2',
      'Meeting Room 3',
    ]);
    assert.deepEqual((await find('start=10:00&duration=60&people=30')).rooms, []);

    // The slot obeys the same rules as a booking.
    for (const [qs, code] of [
      [`date=${FRIDAY}&start=10:00&duration=60`, 'not_a_working_day'],
      [`date=${MONDAY}&start=17:30&duration=60`, 'outside_working_hours'],
      [`date=${MONDAY}&start=10:00&duration=20`, 'booking_granularity'],
      [`date=${MONDAY}&start=08:00&duration=495`, 'booking_too_long'],
    ]) {
      const res = await w.gen.get(`/api/rooms/find?${qs}`);
      assert.equal(res.body.error?.code, code, qs);
    }
  });
});

describe('administering rooms and bookings', () => {
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 1),
  ]);
  const ROOM = {
    mailboxEmail: 'Room-HQ-7@MGHolding.example',
    nameEn: 'Focus Room',
    nameAr: 'غرفة التركيز',
    floor: '4',
    capacity: 2,
    equipment: ['phone'],
  };

  test('a HoldingAdmin adds, edits and retires rooms, all audited', async () => {
    const w = await world();
    const created = await w.ha.post('/api/admin/rooms', ROOM);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.mailboxEmail, 'room-hq-7@mgholding.example');
    assert.deepEqual(
      [created.body.isActive, created.body.companyIds, created.body.notes],
      [true, [], '']
    );
    assert.equal((await w.gen.get('/api/rooms')).body.items.length, 7);

    const twice = await w.ha.post('/api/admin/rooms', ROOM);
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error.code, 'mailbox_taken');

    const edited = await w.ha.patch(`/api/admin/rooms/${created.body.id}`, {
      updatedAt: created.body.updatedAt,
      capacity: 3,
      equipment: ['phone', 'screen'],
      notes: 'Door code at reception.',
      companyIds: [w.genId],
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.deepEqual(edited.body.companyIds, [w.genId]);

    const stale = await w.ha.patch(`/api/admin/rooms/${created.body.id}`, {
      updatedAt: created.body.updatedAt,
      capacity: 9,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'stale_record');

    const unknown = await w.ha.patch(`/api/admin/rooms/${created.body.id}`, {
      updatedAt: edited.body.updatedAt,
      companyIds: ['99999999-0000-4000-8000-000000000001'],
    });
    assert.equal(unknown.body.error.code, 'unknown_company');

    // Retired: gone for everyone, kept for the admin.
    const retired = await w.ha.patch(`/api/admin/rooms/${created.body.id}`, {
      updatedAt: edited.body.updatedAt,
      isActive: false,
    });
    assert.equal(retired.body.isActive, false);
    assert.equal((await w.gen.get('/api/rooms')).body.items.length, 6);
    assert.equal((await w.gen.get(`/api/rooms/${created.body.id}`)).status, 404);
    assert.equal((await w.ha.get('/api/admin/rooms')).body.items.length, 7);

    assert.deepEqual(
      w.repo.auditLogs.map((a) => [a.action, a.entity, a.companyId]),
      [
        ['room.create', 'Room', null],
        ['room.update', 'Room', null],
        ['room.update', 'Room', null],
      ]
    );
    assert.equal(JSON.parse(w.repo.auditLogs[1].before).capacity, 2);
    assert.equal(JSON.parse(w.repo.auditLogs[1].after).capacity, 3);

    for (const bad of [
      { ...ROOM, mailboxEmail: 'not-an-email' },
      { ...ROOM, capacity: 0 },
      { ...ROOM, equipment: ['hot tub'] },
      { ...ROOM, nameAr: '' },
    ]) {
      assert.equal((await w.ha.post('/api/admin/rooms', bad)).status, 400);
    }
  });

  test('only a HoldingAdmin administers rooms', async () => {
    const w = await world();
    const [room] = (await w.ha.get('/api/admin/rooms')).body.items;
    for (const who of [w.gen, w.msr, w.caGen, w.caMsr]) {
      assert.equal((await who.get('/api/admin/rooms')).status, 403);
      assert.equal((await who.get('/api/admin/rooms/mailboxes')).status, 403);
      assert.equal((await who.post('/api/admin/rooms', ROOM)).status, 403);
      assert.equal(
        (
          await who.patch(`/api/admin/rooms/${room.id}`, {
            updatedAt: room.updatedAt,
            capacity: 1,
          })
        ).status,
        403
      );
      assert.equal(
        (await who.put(`/api/admin/rooms/${room.id}/photo?updatedAt=${room.updatedAt}`, PNG))
          .status,
        403
      );
    }
    assert.equal(w.repo.rooms.length, 6);
    assert.equal(w.repo.auditLogs.length, 0);
  });

  test('a photo is checked like a cover: size, and the file’s own signature', async () => {
    const w = await world();
    const [room] = (await w.ha.get('/api/admin/rooms')).body.items;
    const url = (r) =>
      `/api/admin/rooms/${r.id}/photo?updatedAt=${encodeURIComponent(r.updatedAt)}`;

    const fake = await w.ha.put(url(room), Buffer.from('<svg onload=alert(1)>padding padding'));
    assert.equal(fake.status, 415);
    assert.equal(fake.body.error.code, 'unsupported_image');
    assert.equal((await w.ha.put(url(room), Buffer.alloc(0))).status, 400);
    const huge = await w.ha.put(url(room), Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]));
    assert.equal(huge.status, 413);
    assert.equal(w.storage.files.size, 0);

    const set = await w.ha.put(url(room), PNG);
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.match(set.body.photoUrl, new RegExp(`^/api/rooms/${room.id}/photo\\?v=`));
    assert.ok(!('photoKey' in set.body));
    assert.equal(w.storage.files.size, 1);

    const read = await w.gen.get(set.body.photoUrl);
    assert.equal(read.status, 200);
    assert.equal(read.headers['content-type'], 'image/png');
    assert.equal(read.headers['content-security-policy'], "default-src 'none'");
    assert.equal((await request(w.app).get(set.body.photoUrl)).status, 401);

    // Replacing drops the old file; removing drops the last.
    const again = await w.ha.put(url(set.body), PNG);
    assert.equal(w.storage.files.size, 1);
    const removed = await w.ha.del(url(again.body));
    assert.equal(removed.body.photoUrl, null);
    assert.equal(w.storage.files.size, 0);
    assert.equal((await w.gen.get(set.body.photoUrl)).status, 404);
    assert.deepEqual(
      w.repo.auditLogs.map((a) => a.action),
      ['room.photo.update', 'room.photo.update', 'room.photo.remove']
    );
  });

  test('the mailbox list shows Exchange’s rooms and which the portal has', async () => {
    const w = await world();
    const { items } = (await w.ha.get('/api/admin/rooms/mailboxes')).body;
    // The six seeded rooms, and four mailboxes no room uses yet.
    const used = items.filter((m) => m.roomId);
    assert.equal(used.length, 6);
    assert.ok(used.every((m) => m.emailAddress.startsWith('room-hq-')));
    assert.deepEqual(
      items.filter((m) => !m.roomId).map((m) => m.emailAddress),
      ['a', 'b', 'c', 'd'].map((x) => `room-site-${x}@mgholding.example`)
    );
  });

  test('admins list bookings within their companies; a user cannot', async () => {
    const w = await world();
    const [genBooking] = await w.mustBook(w.gen, { subject: 'Genesis only' });
    await w.mustBook(w.msr, { room: w.r2, subject: 'Masar only' });
    const [cancelled] = await w.mustBook(w.gen, { date: TUESDAY });
    await w.gen.post(`/api/bookings/${cancelled.id}/cancel`);

    const all = (await w.ha.get('/api/admin/bookings')).body;
    assert.equal(all.total, 2);
    assert.deepEqual(all.items.map((b) => b.subject).sort(), ['Genesis only', 'Masar only']);
    assert.equal((await w.ha.get('/api/admin/bookings?status=all')).body.total, 3);
    assert.equal((await w.ha.get('/api/admin/bookings?status=cancelled')).body.total, 1);
    assert.equal((await w.ha.get(`/api/admin/bookings?roomId=${w.r2.id}`)).body.total, 1);
    assert.equal((await w.ha.get(`/api/admin/bookings?companyId=${w.msrId}`)).body.total, 1);
    assert.equal(
      (await w.ha.get(`/api/admin/bookings?from=${TUESDAY}&status=all`)).body.total,
      1
    );
    assert.equal((await w.ha.get(`/api/admin/bookings?to=${MONDAY}&status=all`)).body.total, 2);

    // A Genesis admin sees Genesis bookings only, and may not ask for Masar's.
    const own = (await w.caGen.get('/api/admin/bookings')).body;
    assert.deepEqual(
      own.items.map((b) => [b.id, b.subject, b.canManage]),
      [[genBooking.id, 'Genesis only', true]]
    );
    assert.equal((await w.caGen.get(`/api/admin/bookings?companyId=${w.msrId}`)).status, 404);
    assert.ok(!JSON.stringify(own).includes('Masar only'));

    for (const who of [w.gen, w.msr]) {
      assert.equal((await who.get('/api/admin/bookings')).status, 403);
    }
  });
});

describe('the real Graph client (written to the contract; run against a tenant in session 19)', () => {
  function stub(replies) {
    const calls = [];
    const fetchStub = async (url, init) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body && JSON.parse(init.body),
        headers: init.headers,
      });
      const body = replies.shift();
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
    };
    const client = createRealGraph({
      fetch: fetchStub,
      getToken: async () => 'app-token',
      wait: async () => {},
    });
    return { client, calls };
  }
  const organiser = {
    email: 'salma@genesismining-eg.com',
    getAccessToken: async () => 'user-token',
  };
  const room = { email: 'room-hq-1@mgholding.example', name: 'Meeting Room 1' };
  const time = (dateTime) => ({ dateTime, timeZone: 'UTC' });

  test('books in the organiser’s own calendar with the room as a resource, on Cairo’s clock', async () => {
    const { client, calls } = stub([
      { id: 'master' },
      {
        value: [
          {
            id: 'i1',
            seriesMasterId: 'master',
            subject: 'S',
            start: time('2026-10-25T07:00:00.0000000'),
            end: time('2026-10-25T08:00:00.0000000'),
          },
          {
            id: 'i2',
            seriesMasterId: 'master',
            subject: 'S',
            start: time('2026-11-01T08:00:00.0000000'),
            end: time('2026-11-01T09:00:00.0000000'),
          },
        ],
      },
    ]);
    const result = await client.createEvent({
      organiser,
      room,
      subject: 'S',
      start: new Date('2026-10-25T07:00:00Z'),
      end: new Date('2026-10-25T08:00:00Z'),
      recurrence: { daysOfWeek: [0], startDate: '2026-10-25', endDate: '2026-11-01' },
      attendees: ['dina@genesismining-eg.com'],
    });

    const [create, instances] = calls;
    assert.equal(create.url, 'https://graph.microsoft.com/v1.0/me/events');
    assert.equal(create.method, 'POST');
    assert.equal(create.headers.Authorization, 'Bearer user-token', 'delegated, not the app');
    assert.deepEqual(create.body.start, {
      dateTime: '2026-10-25T10:00:00',
      timeZone: 'Egypt Standard Time',
    });
    assert.deepEqual(create.body.attendees[0], {
      emailAddress: { address: room.email, name: room.name },
      type: 'resource',
    });
    assert.equal(create.body.attendees[1].type, 'required');
    assert.deepEqual(create.body.recurrence.pattern.daysOfWeek, ['sunday']);
    assert.deepEqual(create.body.recurrence.range, {
      type: 'endDate',
      startDate: '2026-10-25',
      endDate: '2026-11-01',
      recurrenceTimeZone: 'Egypt Standard Time',
    });
    assert.match(instances.url, /\/me\/events\/master\/instances\?/);
    assert.equal(result.seriesMasterId, 'master');
    assert.deepEqual(
      result.events.map((e) => [e.id, e.start.toISOString()]),
      [
        ['i1', '2026-10-25T07:00:00.000Z'],
        ['i2', '2026-11-01T08:00:00.000Z'],
      ]
    );
  });

  test('refuses to book as a person without that person’s token', async () => {
    const { client, calls } = stub([]);
    await assert.rejects(
      client.createEvent({
        organiser: { email: organiser.email },
        room,
        subject: 'S',
        start: NOW,
        end: NOW,
        recurrence: null,
        attendees: [],
      }),
      (err) => err instanceof GraphError && err.code === 'delegated_token_missing'
    );
    assert.equal(calls.length, 0);
  });

  test('reads free/busy with the application permission and drops free blocks', async () => {
    const { client, calls } = stub([
      {
        value: [
          {
            scheduleId: 'Room-HQ-1@mgholding.example',
            scheduleItems: [
              {
                status: 'busy',
                start: time('2026-10-12T07:00:00.0000000'),
                end: time('2026-10-12T08:00:00.0000000'),
              },
              {
                status: 'free',
                start: time('2026-10-12T09:00:00.0000000'),
                end: time('2026-10-12T10:00:00.0000000'),
              },
            ],
          },
        ],
      },
    ]);
    const [schedule] = await client.getSchedule(
      [room.email],
      new Date('2026-10-11T21:00:00Z'),
      new Date('2026-10-12T21:00:00Z')
    );
    assert.equal(calls[0].headers.Authorization, 'Bearer app-token');
    assert.match(
      calls[0].url,
      /\/users\/room-hq-1%40mgholding\.example\/calendar\/getSchedule$/
    );
    assert.deepEqual(calls[0].body.schedules, [room.email]);
    assert.deepEqual(
      schedule.items.map((i) => [i.start.toISOString(), i.status, i.eventId]),
      [['2026-10-12T07:00:00.000Z', 'busy', undefined]]
    );
  });

  test('an admin’s change to someone else’s meeting goes through the organiser’s mailbox', async () => {
    const { client, calls } = stub([
      {
        id: 'e1',
        subject: 'New',
        start: time('2026-10-12T07:00:00.0000000'),
        end: time('2026-10-12T08:00:00.0000000'),
      },
    ]);
    await client.updateEvent({
      organiser: { email: organiser.email, getAccessToken: null },
      eventId: 'e1',
      subject: 'New',
    });
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(
      calls[0].url,
      'https://graph.microsoft.com/v1.0/users/salma%40genesismining-eg.com/events/e1'
    );
    assert.equal(calls[0].headers.Authorization, 'Bearer app-token');
  });
});
