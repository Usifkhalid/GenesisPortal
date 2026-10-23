/**
 * matrix-rows.js — the authorisation matrix's rows that both apps answer the
 * same way: sign-in, the person's own notifications and the mocked mail
 * (commonRows, the portal's and the helpdesk's), and the helpdesk's: tickets
 * (D99, D118, D122, D143), the IT team's routes and settings (D135) and who is
 * on the IT team (helpdeskRows; sharedRows is both). Each app's
 * backend/tests/authz-matrix.test.js spreads them into its MATRIX with its
 * own groups of people, and adds its own routes.
 *
 * The world (authz-matrix.js) has the people userGen (the requester), agent,
 * lead and ha, and these fixtures: team, category, location, holiday, canned,
 * person(key), as(key) and ticket() (ticketFixture below). The portal's world
 * has no tickets: commonRows needs only person(key), as(key) and `mail`.
 */

import { randomUUID } from 'node:crypto';

import { PUBLIC } from './authz-matrix.js';

const TEXT = Buffer.from('a log line\n');
const policies = ['P1', 'P2', 'P3', 'P4'].map((priority) => ({
  priority,
  firstResponseMinutes: 60,
  resolveMinutes: 480,
}));

/**
 * The Genesis user's own ticket, unassigned; resolved by the lead or carrying
 * a file when asked.
 * @param {{ as: Function, category: object, once: Function, ok: Function }} f
 */
export function ticketFixture(f) {
  const { once, ok } = f;
  return ({ resolved = false, file = false } = {}) =>
    once(`ticket:${resolved}:${file}`, async () => {
      const owner = await f.as('userGen');
      const made = ok(
        await owner.post('/api/tickets', {
          subject: 'Laptop will not start',
          description: 'It shows the logo and then a black screen.',
          categoryId: f.category.id,
        })
      ).ticket;
      if (file) {
        made.file = ok(
          await owner.raw('post', `/api/tickets/${made.id}/attachments?name=boot.log`, TEXT)
        );
      }
      if (resolved) {
        ok(await (await f.as('lead')).patch(`/api/tickets/${made.id}`, { status: 'Resolved' }));
      }
      return made;
    });
}

/**
 * Sign-in, the person's own notifications, the mocked mail.
 * @param {object} groups
 * @param {string[]} groups.ALL  everyone signed in
 * @param {(f: object) => Promise<unknown>} groups.mail  makes sure the mocked
 *   Graph has "sent" one mail (the helpdesk: raising a ticket mails its lead)
 */
export function commonRows({ ALL, mail }) {
  return {
    /* ---- public: no session needed */
    'GET /api/health': [PUBLIC, (a) => a.get('/api/health')],
    'GET /api/ready': [PUBLIC, (a) => a.get('/api/ready')],
    'GET /api/auth/config': [PUBLIC, (a) => a.get('/api/auth/config')],
    'GET /api/auth/mock-users': [PUBLIC, (a) => a.get('/api/auth/mock-users')],
    // Signing in and out are exercised by every other row (and by auth.test.js).
    'POST /api/auth/mock-login': [PUBLIC, null],
    'POST /api/auth/logout': [PUBLIC, null],

    /* ---- everyone signed in, about themselves */
    'GET /api/me': [ALL, (a) => a.get('/api/me')],
    'GET /api/notifications': [ALL, (a) => a.get('/api/notifications')],
    'GET /api/notifications/unread-count': [
      ALL,
      (a) => a.get('/api/notifications/unread-count'),
    ],
    'POST /api/notifications/read': [
      ALL,
      (a) => a.post('/api/notifications/read', { ids: [randomUUID()] }),
    ],
    'POST /api/notifications/read-all': [ALL, (a) => a.post('/api/notifications/read-all')],
    'GET /api/notifications/preferences': [ALL, (a) => a.get('/api/notifications/preferences')],
    'PUT /api/notifications/preferences': [
      ALL,
      (a) =>
        a.put('/api/notifications/preferences', {
          items: [{ category: 'bookings', channel: 'email', enabled: false }],
        }),
    ],
    // Development only (never mounted in production): the mocked mail.
    'GET /api/dev/outbox': [ALL, (a) => a.get('/api/dev/outbox')],
    'GET /api/dev/outbox/:id/html': [
      ALL,
      async (a, f) => {
        await mail(f);
        const { items } = (await (await f.as('ha')).get('/api/dev/outbox')).body;
        return a.get(`/api/dev/outbox/${items[0].id}/html`);
      },
    ],
  };
}

/**
 * The helpdesk's own: tickets, the IT team's reports, people search, settings
 * and who is on the IT team.
 * @param {object} groups
 * @param {string[]} groups.ALL  everyone signed in
 * @param {string[]} groups.STAFF  the IT team
 * @param {string[]} groups.LEADS  IT leads
 * @param {string[]} groups.HA  who decides who is on the IT team
 */
export function helpdeskRows({ ALL, STAFF, LEADS, HA }) {
  return {
    /* ---- helpdesk: a ticket is its requester's and the IT team's (D99) */
    'GET /api/tickets/options': [ALL, (a) => a.get('/api/tickets/options')],
    'GET /api/tickets/mine': [ALL, (a) => a.get('/api/tickets/mine')],
    'GET /api/tickets/counts': [ALL, (a) => a.get('/api/tickets/counts')],
    'POST /api/tickets': [
      ALL,
      (a, f) =>
        a.post('/api/tickets', {
          subject: 'Printer',
          description: 'It prints blank pages.',
          categoryId: f.category.id,
        }),
    ],
    'GET /api/tickets/queue': [STAFF, (a) => a.get('/api/tickets/queue')],
    'GET /api/tickets/queue/options': [STAFF, (a) => a.get('/api/tickets/queue/options')],
    'GET /api/tickets/canned-replies': [STAFF, (a) => a.get('/api/tickets/canned-replies')],
    'GET /api/tickets/by-number/:number': [
      ['userGen', ...STAFF],
      async (a, f) => a.get(`/api/tickets/by-number/${(await f.ticket()).number}`),
    ],
    'GET /api/tickets/:id': [
      ['userGen', ...STAFF],
      async (a, f) => a.get(`/api/tickets/${(await f.ticket()).id}`),
    ],
    // Assigning is a lead's decision (D118, D135).
    'PATCH /api/tickets/:id': [
      LEADS,
      async (a, f) =>
        a.patch(`/api/tickets/${(await f.ticket()).id}`, { assigneeId: f.person('agent').id }),
    ],
    // A public reply: the requester, or the team member the ticket is assigned
    // to; it is unassigned here, so of the team only its lead (D122).
    'POST /api/tickets/:id/comments': [
      ['userGen', ...LEADS],
      async (a, f) =>
        a.post(`/api/tickets/${(await f.ticket()).id}/comments`, { body: 'Any news?' }),
    ],
    'POST /api/tickets/:id/reopen': [
      ['userGen', ...LEADS],
      async (a, f) => a.post(`/api/tickets/${(await f.ticket({ resolved: true })).id}/reopen`),
    ],
    // The requester alone says whether it is solved; IT cannot answer for them (D143).
    'POST /api/tickets/:id/solved': [
      ['userGen'],
      async (a, f) =>
        a.post(`/api/tickets/${(await f.ticket({ resolved: true })).id}/solved`, { rating: 5 }),
    ],
    'POST /api/tickets/:id/not-solved': [
      ['userGen'],
      async (a, f) =>
        a.post(`/api/tickets/${(await f.ticket({ resolved: true })).id}/not-solved`, {
          reason: 'It still shows the black screen.',
        }),
    ],
    // Closing without the requester's confirmation is a lead's decision.
    'POST /api/tickets/:id/close': [
      LEADS,
      async (a, f) =>
        a.post(`/api/tickets/${(await f.ticket({ resolved: true })).id}/close`, {
          reason: 'The requester is not responding.',
        }),
    ],
    'POST /api/tickets/:id/attachments': [
      ['userGen', ...LEADS],
      async (a, f) =>
        a.raw('post', `/api/tickets/${(await f.ticket()).id}/attachments?name=trace.log`, TEXT),
    ],
    'GET /api/tickets/:id/attachments/:attachmentId': [
      ['userGen', ...STAFF],
      async (a, f) => a.get((await f.ticket({ file: true })).file.url),
    ],

    /* ---- the IT Helpdesk's own routes: the IT team (D135) */
    'GET /api/helpdesk/reports': [STAFF, (a) => a.get('/api/helpdesk/reports')],
    'GET /api/helpdesk/reports/export.csv': [
      STAFF,
      (a) => a.get('/api/helpdesk/reports/export.csv'),
    ],
    'GET /api/helpdesk/people': [STAFF, (a) => a.get('/api/helpdesk/people?q=sal')],
    'GET /api/helpdesk/people/:id': [
      STAFF,
      (a, f) => a.get(`/api/helpdesk/people/${f.person('userGen').id}`),
    ],

    /* ---- IT settings: IT leads only, never an administrator (D135) */
    'GET /api/helpdesk/settings/teams': [LEADS, (a) => a.get('/api/helpdesk/settings/teams')],
    'PATCH /api/helpdesk/settings/teams/:id': [
      LEADS,
      (a, f) => a.patch(`/api/helpdesk/settings/teams/${f.team.id}`, { nameEn: 'IT Helpdesk' }),
    ],
    'PUT /api/helpdesk/settings/teams/:id/sla': [
      LEADS,
      (a, f) => a.put(`/api/helpdesk/settings/teams/${f.team.id}/sla`, { policies }),
    ],
    'PUT /api/helpdesk/settings/teams/:id/calendar': [
      LEADS,
      (a, f) =>
        a.put(`/api/helpdesk/settings/teams/${f.team.id}/calendar`, {
          timeZone: 'Africa/Cairo',
          workingDays: [0, 1, 2, 3, 4],
          startMin: 540,
          endMin: 1020,
        }),
    ],
    'GET /api/helpdesk/settings/categories': [
      LEADS,
      (a) => a.get('/api/helpdesk/settings/categories'),
    ],
    'POST /api/helpdesk/settings/categories': [
      LEADS,
      (a, f) =>
        a.post('/api/helpdesk/settings/categories', {
          teamId: f.team.id,
          nameEn: 'Badge reader',
          nameAr: 'قارئ البطاقات',
        }),
    ],
    'PATCH /api/helpdesk/settings/categories/:id': [
      LEADS,
      (a, f) => a.patch(`/api/helpdesk/settings/categories/${f.category.id}`, { sortOrder: 7 }),
    ],
    'GET /api/helpdesk/settings/canned-replies': [
      LEADS,
      (a) => a.get('/api/helpdesk/settings/canned-replies'),
    ],
    'POST /api/helpdesk/settings/canned-replies': [
      LEADS,
      (a, f) =>
        a.post('/api/helpdesk/settings/canned-replies', {
          teamId: f.team.id,
          titleEn: 'On it',
          titleAr: 'نعمل عليه',
          bodyEn: 'We are looking into it.',
          bodyAr: 'نحن ننظر في الأمر.',
        }),
    ],
    'PATCH /api/helpdesk/settings/canned-replies/:id': [
      LEADS,
      (a, f) =>
        a.patch(`/api/helpdesk/settings/canned-replies/${f.canned.id}`, { sortOrder: 7 }),
    ],
    'GET /api/helpdesk/settings/locations': [
      LEADS,
      (a) => a.get('/api/helpdesk/settings/locations'),
    ],
    'POST /api/helpdesk/settings/locations': [
      LEADS,
      (a) =>
        a.post('/api/helpdesk/settings/locations', { nameEn: 'Warehouse', nameAr: 'المستودع' }),
    ],
    'PATCH /api/helpdesk/settings/locations/:id': [
      LEADS,
      (a, f) => a.patch(`/api/helpdesk/settings/locations/${f.location.id}`, { sortOrder: 7 }),
    ],
    'GET /api/helpdesk/settings/holidays': [
      LEADS,
      (a) => a.get('/api/helpdesk/settings/holidays'),
    ],
    'POST /api/helpdesk/settings/holidays': [
      LEADS,
      (a) =>
        a.post('/api/helpdesk/settings/holidays', {
          date: '2027-03-03',
          nameEn: 'Extra day',
          nameAr: 'يوم إضافي',
        }),
    ],
    'PATCH /api/helpdesk/settings/holidays/:id': [
      LEADS,
      (a, f) =>
        a.patch(`/api/helpdesk/settings/holidays/${f.holiday.id}`, { nameEn: 'Renamed' }),
    ],
    'DELETE /api/helpdesk/settings/holidays/:id': [
      LEADS,
      (a, f) => a.del(`/api/helpdesk/settings/holidays/${f.holiday.id}`),
    ],

    /* ---- who is on the IT team: the holding admin, in the portal (D135) */
    'GET /api/admin/it-team/teams': [HA, (a) => a.get('/api/admin/it-team/teams')],
    'PUT /api/admin/it-team/teams/:id/members/:userId': [
      HA,
      (a, f) =>
        a.put(`/api/admin/it-team/teams/${f.team.id}/members/${f.person('userGen').id}`, {
          role: 'Agent',
        }),
    ],
    'DELETE /api/admin/it-team/teams/:id/members/:userId': [
      HA,
      (a, f) => a.del(`/api/admin/it-team/teams/${f.team.id}/members/${f.person('agent').id}`),
    ],
  };
}

/** Everything the IT Helpdesk answers that both apps' tests share. */
export function sharedRows({ ALL, STAFF, LEADS, HA }) {
  return {
    ...commonRows({
      ALL,
      // Any mail will do: raising a ticket sends one to the IT lead.
      mail: (f) => f.ticket(),
    }),
    ...helpdeskRows({ ALL, STAFF, LEADS, HA }),
  };
}
