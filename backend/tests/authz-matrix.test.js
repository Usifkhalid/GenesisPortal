import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { createMemoryStorage } from '../src/lib/storage.js';
import { cairoWallToUtc } from '../src/lib/time.js';
import { createMemoryUserRepo } from '../src/modules/auth/repo-memory.js';

/**
 * The authorisation matrix: every route the app answers, asked by every kind
 * of person, with the answer the product's rules call for.
 *
 * The route list is not written here: it is app.locals.routes, recorded as
 * app.js mounts each router. A route with no row in MATRIX fails the first
 * test, so a new endpoint cannot ship without saying who may use it.
 *
 * Who asks (the records they ask about belong to Genesis, GEN):
 *   userGen   User, Genesis                 userMsr   User, Masar
 *   caGen     CompanyAdmin, Genesis         caMsr     CompanyAdmin, Masar
 *   agent     IT agent (MG Holding)         lead      IT lead (MG Holding)
 *   ha        HoldingAdmin (MG Holding)     nobody    not signed in
 * Users and company admins come from two companies, which is what shows a
 * Masar person refused on Genesis records. The IT team and the holding admins
 * exist once, at the holding, and serve every company.
 *
 * What counts:
 *   allowed  2xx (or a 4xx about the content of the request: 400, 409, 415 —
 *            the request got past the permission check)
 *   denied   403, or 404 where the record's existence is not theirs to learn
 *   nobody   401 on everything that is not public
 * Each person asks in a world of their own (a fresh in-memory app), so one
 * person's delete cannot turn the next person's answer into a 404.
 */

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };
const NOW = new Date('2026-10-11T08:00:00Z'); // a Sunday morning in Cairo
const MONDAY = '2026-10-12';
const at = (ymd, hhmm) =>
  cairoWallToUtc(ymd, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))).toISOString();

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
]);
const TEXT = Buffer.from('a log line\n');

const PEOPLE = {
  userGen: 'salma.ibrahim@genesismining-eg.com',
  userMsr: 'yasmine.nabil@masar.eg',
  agent: 'sherif.awad@mgholding.example',
  lead: 'omar.fahmy@mgholding.example',
  caGen: 'hany.soliman@genesismining-eg.com',
  caMsr: 'tarek.elmasry@masar.eg',
  ha: 'nadia.elsayed@mgholding.example',
};
const ACTORS = Object.keys(PEOPLE);

const ALL = ACTORS;
const ADMINS = ['caGen', 'caMsr', 'ha'];
const GEN_ADMINS = ['caGen', 'ha'];
const HA = ['ha'];
const STAFF = ['agent', 'lead', 'ha'];
const LEADS = ['lead', 'ha'];
const GEN_PEOPLE = ['userGen', 'caGen', 'ha'];
const GEN_READERS = ['userGen', 'caGen'];
/** Marks a route anyone may call without a session. */
const PUBLIC = 'public';

/* ------------------------------------------------------------- one world */

function client(app, user) {
  const agent = request.agent(app);
  let csrf = '';
  const write = (method, path) => agent[method](path).set('X-CSRF-Token', csrf);
  return {
    user,
    async signIn() {
      const config = await agent.get('/api/auth/config');
      const login = await agent
        .post('/api/auth/mock-login')
        .set('X-CSRF-Token', config.body.csrfToken)
        .send({ userId: user.id });
      assert.equal(login.status, 200, `sign-in as ${user.email}`);
      csrf = login.body.csrfToken;
      return this;
    },
    get: (path) => agent.get(path),
    post: (path, body = {}) => write('post', path).send(body),
    patch: (path, body = {}) => write('patch', path).send(body),
    put: (path, body = {}) => write('put', path).send(body),
    del: (path) => write('delete', path),
    raw: (method, path, bytes) =>
      write(method, path).set('Content-Type', 'application/octet-stream').send(bytes),
  };
}

/** A fresh app with lazily made fixtures, all belonging to Genesis. */
function world() {
  const repo = createMemoryUserRepo();
  const app = createApp({
    config: DEV,
    userRepo: repo,
    storage: createMemoryStorage(),
    now: () => NOW,
    authRateLimit: { limit: 100_000, accountLimit: 100_000 },
    rateLimit: { limit: 100_000 },
  });
  const person = (key) => repo.users.find((u) => u.email === PEOPLE[key]);
  const memo = new Map();
  const once = (key, make) => {
    if (!memo.has(key)) memo.set(key, make());
    return memo.get(key);
  };
  const ok = (res, status = [200, 201]) => {
    assert.ok(
      status.includes(res.status),
      `fixture: ${res.status} ${JSON.stringify(res.body)}`
    );
    return res.body;
  };

  const f = {
    app,
    repo,
    person,
    gen: repo.companies.find((c) => c.code === 'GEN'),
    team: repo.helpdesk.team[0],
    category: repo.helpdesk.category.find((c) => c.nameEn === 'Laptop / PC'),
    location: repo.helpdesk.location[0],
    holiday: repo.helpdesk.holiday[0],
    canned: repo.helpdesk.canned[0],
    genDept: null,
    /** A session of their own for whoever sets the scene (never the person asking). */
    as: (key) => once(`as:${key}`, () => client(app, person(key)).signIn()),

    company: () =>
      once('company', async () =>
        ok(await (await f.as('ha')).get(`/api/admin/companies/${f.gen.id}`))
      ),
    /** A company nobody in the matrix belongs to, for switching off and on. */
    spare: () =>
      once('spare', async () =>
        ok(
          await (
            await f.as('ha')
          ).post('/api/admin/companies', {
            code: 'TST',
            nameEn: 'Test Co',
            nameAr: 'شركة اختبار',
            domains: ['tst.example'],
            accentColor: '#1c7a4a',
          })
        )
      ),
    logo: () =>
      once('logo', async () => {
        const company = await f.company();
        return ok(
          await (
            await f.as('ha')
          ).raw(
            'put',
            `/api/admin/companies/${f.gen.id}/logo?updatedAt=${encodeURIComponent(company.updatedAt)}`,
            PNG
          )
        );
      }),
    dept: () =>
      once('dept', async () => {
        const list = ok(
          await (await f.as('ha')).get(`/api/admin/departments?companyId=${f.gen.id}`)
        );
        return list.items[0];
      }),
    assignment: () =>
      once('assignment', async () =>
        ok(
          await (
            await f.as('ha')
          ).post('/api/admin/admins', {
            userId: repo.users.find((u) => u.email === 'mahmoud.attia@genesismining-eg.com').id,
            role: 'CompanyAdmin',
            companyId: f.gen.id,
          })
        )
      ),
    auditRow: () =>
      once('auditRow', async () => {
        ok(
          await (
            await f.as('ha')
          ).post('/api/admin/departments', {
            companyId: f.gen.id,
            nameEn: 'Matrix',
            nameAr: 'مصفوفة',
          })
        );
        return repo.auditLogs.at(-1);
      }),
    /** A published Genesis announcement, with a cover when asked. */
    post: ({ publish = true, cover = false } = {}) =>
      once(`post:${publish}:${cover}`, async () => {
        const ha = await f.as('ha');
        let row = ok(
          await ha.post('/api/admin/announcements', {
            companyId: f.gen.id,
            titleEn: 'Safety week',
            bodyEn: 'Wear your **helmet**.',
            category: 'HSE',
            coverAltEn: 'A yellow helmet',
          })
        );
        if (cover) {
          row = ok(
            await ha.raw(
              'put',
              `/api/admin/announcements/${row.id}/cover?updatedAt=${encodeURIComponent(row.updatedAt)}`,
              PNG
            )
          );
        }
        if (publish) {
          row = ok(
            await ha.post(`/api/admin/announcements/${row.id}/publish`, {
              updatedAt: row.updatedAt,
            })
          );
        }
        return row;
      }),
    room: () =>
      once('room', async () => {
        const rooms = ok(await (await f.as('ha')).get('/api/admin/rooms'));
        return rooms.items.find((r) => r.nameEn === 'Meeting Room 1') ?? rooms.items[0];
      }),
    roomPhoto: () =>
      once('roomPhoto', async () => {
        const room = await f.room();
        return ok(
          await (
            await f.as('ha')
          ).raw(
            'put',
            `/api/admin/rooms/${room.id}/photo?updatedAt=${encodeURIComponent(room.updatedAt)}`,
            PNG
          )
        );
      }),
    /** The Genesis user's own booking. */
    booking: () =>
      once('booking', async () => {
        const room = await f.room();
        const made = ok(
          await (
            await f.as('userGen')
          ).post('/api/bookings', {
            roomId: room.id,
            subject: 'Budget review',
            start: at(MONDAY, '10:00'),
            end: at(MONDAY, '11:00'),
          })
        );
        return made.items[0];
      }),
    /** The Genesis user's own ticket, unassigned. */
    ticket: ({ resolved = false, file = false } = {}) =>
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
          ok(
            await (await f.as('lead')).patch(`/api/tickets/${made.id}`, { status: 'Resolved' })
          );
        }
        return made;
      }),
  };
  return f;
}

/* ---------------------------------------------------------------- matrix */

const stamp = (row) => `updatedAt=${encodeURIComponent(row.updatedAt)}`;
const policies = ['P1', 'P2', 'P3', 'P4'].map((priority) => ({
  priority,
  firstResponseMinutes: 60,
  resolveMinutes: 480,
}));

/** "METHOD /path" → [who is allowed, the request]. */
const MATRIX = {
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
  'GET /api/notifications/unread-count': [ALL, (a) => a.get('/api/notifications/unread-count')],
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
        items: [{ category: 'tickets', channel: 'email', enabled: false }],
      }),
  ],
  // Development only (never mounted in production): the mocked mail.
  'GET /api/dev/outbox': [ALL, (a) => a.get('/api/dev/outbox')],
  'GET /api/dev/outbox/:id/html': [
    ALL,
    async (a, f) => {
      // Any mail will do: raising a ticket sends one to the IT lead.
      await f.ticket();
      const { items } = (await (await f.as('ha')).get('/api/dev/outbox')).body;
      return a.get(`/api/dev/outbox/${items[0].id}/html`);
    },
  ],

  /* ---- company administration */
  'GET /api/admin/scope': [ADMINS, (a) => a.get('/api/admin/scope')],
  'GET /api/admin/companies': [HA, (a) => a.get('/api/admin/companies')],
  'POST /api/admin/companies': [
    HA,
    (a) =>
      a.post('/api/admin/companies', {
        code: 'ZZ',
        nameEn: 'Zed',
        nameAr: 'زد',
        domains: ['zz.example'],
        accentColor: '#1e5aa8',
      }),
  ],
  'GET /api/admin/companies/:id': [HA, (a, f) => a.get(`/api/admin/companies/${f.gen.id}`)],
  'PATCH /api/admin/companies/:id': [
    HA,
    async (a, f) => {
      const spare = await f.spare();
      return a.patch(`/api/admin/companies/${spare.id}`, {
        updatedAt: spare.updatedAt,
        nameEn: 'Renamed',
      });
    },
  ],
  'POST /api/admin/companies/:id/deactivate': [
    HA,
    async (a, f) => {
      const spare = await f.spare();
      return a.post(`/api/admin/companies/${spare.id}/deactivate`, {
        updatedAt: spare.updatedAt,
      });
    },
  ],
  'POST /api/admin/companies/:id/reactivate': [
    HA,
    async (a, f) => {
      const spare = await f.spare();
      const off = await (
        await f.as('ha')
      ).post(`/api/admin/companies/${spare.id}/deactivate`, { updatedAt: spare.updatedAt });
      return a.post(`/api/admin/companies/${spare.id}/reactivate`, {
        updatedAt: off.body.updatedAt,
      });
    },
  ],
  'PUT /api/admin/companies/:id/logo': [
    HA,
    async (a, f) =>
      a.raw('put', `/api/admin/companies/${f.gen.id}/logo?${stamp(await f.company())}`, PNG),
  ],
  'DELETE /api/admin/companies/:id/logo': [
    HA,
    async (a, f) => a.del(`/api/admin/companies/${f.gen.id}/logo?${stamp(await f.logo())}`),
  ],
  // A company's logo is for its own people (and the holding's admins).
  'GET /api/companies/:id/logo': [
    GEN_PEOPLE,
    async (a, f) => {
      await f.logo();
      return a.get(`/api/companies/${f.gen.id}/logo`);
    },
  ],
  'GET /api/admin/departments': [
    GEN_ADMINS,
    (a, f) => a.get(`/api/admin/departments?companyId=${f.gen.id}`),
  ],
  'POST /api/admin/departments': [
    GEN_ADMINS,
    (a, f) =>
      a.post('/api/admin/departments', { companyId: f.gen.id, nameEn: 'New', nameAr: 'جديد' }),
  ],
  'PATCH /api/admin/departments/:id': [
    GEN_ADMINS,
    async (a, f) => {
      const dept = await f.dept();
      return a.patch(`/api/admin/departments/${dept.id}`, {
        updatedAt: dept.updatedAt,
        nameEn: 'Renamed',
      });
    },
  ],
  'POST /api/admin/departments/:id/deactivate': [
    GEN_ADMINS,
    async (a, f) => {
      const dept = await f.dept();
      return a.post(`/api/admin/departments/${dept.id}/deactivate`, {
        updatedAt: dept.updatedAt,
      });
    },
  ],
  'POST /api/admin/departments/:id/reactivate': [
    GEN_ADMINS,
    async (a, f) => {
      const dept = await f.dept();
      const off = await (
        await f.as('ha')
      ).post(`/api/admin/departments/${dept.id}/deactivate`, { updatedAt: dept.updatedAt });
      return a.post(`/api/admin/departments/${dept.id}/reactivate`, {
        updatedAt: off.body.updatedAt,
      });
    },
  ],
  'GET /api/admin/admins': [HA, (a) => a.get('/api/admin/admins')],
  'POST /api/admin/admins': [
    HA,
    (a, f) =>
      a.post('/api/admin/admins', {
        userId: f.person('userMsr').id,
        role: 'CompanyAdmin',
        companyId: f.gen.id,
      }),
  ],
  'DELETE /api/admin/admins/:id': [
    HA,
    async (a, f) => a.del(`/api/admin/admins/${(await f.assignment()).id}`),
  ],
  'GET /api/admin/people': [HA, (a) => a.get('/api/admin/people?q=na')],
  'GET /api/admin/audit': [ADMINS, (a) => a.get('/api/admin/audit')],
  'GET /api/admin/audit/facets': [ADMINS, (a) => a.get('/api/admin/audit/facets')],
  'GET /api/admin/audit/export.csv': [ADMINS, (a) => a.get('/api/admin/audit/export.csv')],
  'GET /api/admin/audit/:id': [
    GEN_ADMINS,
    async (a, f) => a.get(`/api/admin/audit/${(await f.auditRow()).id}`),
  ],

  /* ---- announcements */
  'GET /api/announcements': [ALL, (a) => a.get('/api/announcements')],
  'GET /api/announcements/unread-count': [ALL, (a) => a.get('/api/announcements/unread-count')],
  // The reader's view is for the company's own people. A holding admin is an
  // MG Holding employee: they manage a Genesis post through the admin route.
  'GET /api/announcements/:id': [
    GEN_READERS,
    async (a, f) => a.get(`/api/announcements/${(await f.post()).id}`),
  ],
  // The cover is also drawn in the editor, so the post's admins get it too.
  'GET /api/announcements/:id/cover': [
    GEN_PEOPLE,
    async (a, f) => a.get(`/api/announcements/${(await f.post({ cover: true })).id}/cover`),
  ],
  'GET /api/admin/announcements': [ADMINS, (a) => a.get('/api/admin/announcements')],
  'POST /api/admin/announcements': [
    GEN_ADMINS,
    (a, f) =>
      a.post('/api/admin/announcements', {
        companyId: f.gen.id,
        titleEn: 'Title',
        bodyEn: 'Body',
        category: 'HSE',
      }),
  ],
  'GET /api/admin/announcements/:id': [
    GEN_ADMINS,
    async (a, f) => a.get(`/api/admin/announcements/${(await f.post()).id}`),
  ],
  'PATCH /api/admin/announcements/:id': [
    GEN_ADMINS,
    async (a, f) => {
      const post = await f.post({ publish: false });
      return a.patch(`/api/admin/announcements/${post.id}`, {
        updatedAt: post.updatedAt,
        titleEn: 'Renamed',
      });
    },
  ],
  'POST /api/admin/announcements/:id/publish': [
    GEN_ADMINS,
    async (a, f) => {
      const post = await f.post({ publish: false });
      return a.post(`/api/admin/announcements/${post.id}/publish`, {
        updatedAt: post.updatedAt,
      });
    },
  ],
  'POST /api/admin/announcements/:id/unpublish': [
    GEN_ADMINS,
    async (a, f) => {
      const post = await f.post();
      return a.post(`/api/admin/announcements/${post.id}/unpublish`, {
        updatedAt: post.updatedAt,
      });
    },
  ],
  'POST /api/admin/announcements/:id/duplicate': [
    GEN_ADMINS,
    async (a, f) => a.post(`/api/admin/announcements/${(await f.post()).id}/duplicate`),
  ],
  'DELETE /api/admin/announcements/:id': [
    GEN_ADMINS,
    async (a, f) => a.del(`/api/admin/announcements/${(await f.post({ publish: false })).id}`),
  ],
  'PUT /api/admin/announcements/:id/cover': [
    GEN_ADMINS,
    async (a, f) => {
      const post = await f.post({ publish: false });
      return a.raw('put', `/api/admin/announcements/${post.id}/cover?${stamp(post)}`, PNG);
    },
  ],
  'DELETE /api/admin/announcements/:id/cover': [
    GEN_ADMINS,
    async (a, f) => {
      const post = await f.post({ publish: false, cover: true });
      return a.del(`/api/admin/announcements/${post.id}/cover?${stamp(post)}`);
    },
  ],

  /* ---- directory (group-wide by decision D82) */
  'GET /api/directory/people': [ALL, (a) => a.get('/api/directory/people')],
  'GET /api/directory/people/:id': [
    ALL,
    (a, f) => a.get(`/api/directory/people/${f.person('userGen').id}`),
  ],
  'GET /api/directory/filters': [ALL, (a) => a.get('/api/directory/filters')],
  'GET /api/admin/directory/quality': [ADMINS, (a) => a.get('/api/admin/directory/quality')],
  'GET /api/admin/directory/quality/export.csv': [
    ADMINS,
    (a) => a.get('/api/admin/directory/quality/export.csv'),
  ],
  'PATCH /api/admin/directory/people/:id': [
    GEN_ADMINS,
    (a, f) =>
      a.patch(`/api/admin/directory/people/${f.person('userGen').id}`, {
        displayNameAr: 'سلمى إبراهيم',
      }),
  ],
  'POST /api/admin/directory/arabic-names/preview': [
    ADMINS,
    (a) =>
      a.raw('post', '/api/admin/directory/arabic-names/preview', Buffer.from('email,nameAr\n')),
  ],
  'POST /api/admin/directory/arabic-names/apply': [
    ADMINS,
    (a) =>
      a.raw('post', '/api/admin/directory/arabic-names/apply', Buffer.from('email,nameAr\n')),
  ],
  'GET /api/admin/directory/sync': [HA, (a) => a.get('/api/admin/directory/sync')],
  'POST /api/admin/directory/sync': [HA, (a) => a.post('/api/admin/directory/sync', {})],

  /* ---- rooms and bookings (the seeded HQ rooms are open to every company) */
  'GET /api/rooms': [ALL, (a) => a.get('/api/rooms')],
  'GET /api/rooms/availability': [ALL, (a) => a.get(`/api/rooms/availability?date=${MONDAY}`)],
  'GET /api/rooms/find': [
    ALL,
    (a) => a.get(`/api/rooms/find?date=${MONDAY}&start=10:00&duration=60`),
  ],
  'GET /api/rooms/:id': [ALL, async (a, f) => a.get(`/api/rooms/${(await f.room()).id}`)],
  'GET /api/rooms/:id/photo': [
    ALL,
    async (a, f) => {
      await f.roomPhoto();
      return a.get(`/api/rooms/${(await f.room()).id}/photo`);
    },
  ],
  'POST /api/bookings': [
    ALL,
    async (a, f) =>
      a.post('/api/bookings', {
        roomId: (await f.room()).id,
        subject: 'Stand-up',
        start: at(MONDAY, '13:00'),
        end: at(MONDAY, '13:30'),
      }),
  ],
  'GET /api/bookings/mine': [ALL, (a) => a.get('/api/bookings/mine')],
  // A booking is its organiser's, and their company's admins'.
  'GET /api/bookings/:id': [
    GEN_PEOPLE,
    async (a, f) => a.get(`/api/bookings/${(await f.booking()).id}`),
  ],
  'PATCH /api/bookings/:id': [
    GEN_PEOPLE,
    async (a, f) =>
      a.patch(`/api/bookings/${(await f.booking()).id}`, {
        start: at(MONDAY, '14:00'),
        end: at(MONDAY, '15:00'),
        reason: 'Room needed for a visit',
      }),
  ],
  'POST /api/bookings/:id/cancel': [
    GEN_PEOPLE,
    async (a, f) =>
      a.post(`/api/bookings/${(await f.booking()).id}/cancel`, {
        reason: 'Room needed for a visit',
      }),
  ],
  'GET /api/admin/bookings': [ADMINS, (a) => a.get('/api/admin/bookings')],
  'GET /api/admin/rooms': [HA, (a) => a.get('/api/admin/rooms')],
  'GET /api/admin/rooms/mailboxes': [HA, (a) => a.get('/api/admin/rooms/mailboxes')],
  'POST /api/admin/rooms': [HA, (a) => a.post('/api/admin/rooms', {})],
  'PATCH /api/admin/rooms/:id': [
    HA,
    async (a, f) => {
      const room = await f.room();
      return a.patch(`/api/admin/rooms/${room.id}`, { updatedAt: room.updatedAt, capacity: 5 });
    },
  ],
  'PUT /api/admin/rooms/:id/photo': [
    HA,
    async (a, f) => {
      const room = await f.room();
      return a.raw('put', `/api/admin/rooms/${room.id}/photo?${stamp(room)}`, PNG);
    },
  ],
  'DELETE /api/admin/rooms/:id/photo': [
    HA,
    async (a, f) => {
      const room = await f.roomPhoto();
      return a.del(`/api/admin/rooms/${room.id}/photo?${stamp(room)}`);
    },
  ],

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
  'GET /api/tickets/:id': [
    ['userGen', ...STAFF],
    async (a, f) => a.get(`/api/tickets/${(await f.ticket()).id}`),
  ],
  // Assigning is a lead's decision (D118).
  'PATCH /api/tickets/:id': [
    LEADS,
    async (a, f) =>
      a.patch(`/api/tickets/${(await f.ticket()).id}`, { assigneeId: f.person('agent').id }),
  ],
  // A public reply: the requester, or the team member the ticket is assigned
  // to; it is unassigned here, so of the team only its lead and the holding
  // admin (D122).
  'POST /api/tickets/:id/comments': [
    ['userGen', ...LEADS],
    async (a, f) =>
      a.post(`/api/tickets/${(await f.ticket()).id}/comments`, { body: 'Any news?' }),
  ],
  'POST /api/tickets/:id/reopen': [
    ['userGen', ...LEADS],
    async (a, f) => a.post(`/api/tickets/${(await f.ticket({ resolved: true })).id}/reopen`),
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

  /* ---- helpdesk settings: the holding admin; a lead for their own team's
     categories and canned replies */
  'GET /api/admin/helpdesk/teams': [LEADS, (a) => a.get('/api/admin/helpdesk/teams')],
  'POST /api/admin/helpdesk/teams': [
    HA,
    (a) =>
      a.post('/api/admin/helpdesk/teams', {
        code: 'FAC',
        nameEn: 'Facilities',
        nameAr: 'المرافق',
      }),
  ],
  'PATCH /api/admin/helpdesk/teams/:id': [
    HA,
    (a, f) => a.patch(`/api/admin/helpdesk/teams/${f.team.id}`, { nameEn: 'IT Helpdesk' }),
  ],
  'PUT /api/admin/helpdesk/teams/:id/members/:userId': [
    HA,
    (a, f) =>
      a.put(`/api/admin/helpdesk/teams/${f.team.id}/members/${f.person('userGen').id}`, {
        role: 'Agent',
      }),
  ],
  'DELETE /api/admin/helpdesk/teams/:id/members/:userId': [
    HA,
    (a, f) => a.del(`/api/admin/helpdesk/teams/${f.team.id}/members/${f.person('agent').id}`),
  ],
  'PUT /api/admin/helpdesk/teams/:id/sla': [
    HA,
    (a, f) => a.put(`/api/admin/helpdesk/teams/${f.team.id}/sla`, { policies }),
  ],
  'PUT /api/admin/helpdesk/teams/:id/calendar': [
    HA,
    (a, f) =>
      a.put(`/api/admin/helpdesk/teams/${f.team.id}/calendar`, {
        timeZone: 'Africa/Cairo',
        workingDays: [0, 1, 2, 3, 4],
        startMin: 540,
        endMin: 1020,
      }),
  ],
  'GET /api/admin/helpdesk/categories': [LEADS, (a) => a.get('/api/admin/helpdesk/categories')],
  'POST /api/admin/helpdesk/categories': [
    LEADS,
    (a, f) =>
      a.post('/api/admin/helpdesk/categories', {
        teamId: f.team.id,
        nameEn: 'Badge reader',
        nameAr: 'قارئ البطاقات',
      }),
  ],
  'PATCH /api/admin/helpdesk/categories/:id': [
    LEADS,
    (a, f) => a.patch(`/api/admin/helpdesk/categories/${f.category.id}`, { sortOrder: 7 }),
  ],
  'GET /api/admin/helpdesk/canned-replies': [
    LEADS,
    (a) => a.get('/api/admin/helpdesk/canned-replies'),
  ],
  'POST /api/admin/helpdesk/canned-replies': [
    LEADS,
    (a, f) =>
      a.post('/api/admin/helpdesk/canned-replies', {
        teamId: f.team.id,
        titleEn: 'On it',
        titleAr: 'نعمل عليه',
        bodyEn: 'We are looking into it.',
        bodyAr: 'نحن ننظر في الأمر.',
      }),
  ],
  'PATCH /api/admin/helpdesk/canned-replies/:id': [
    LEADS,
    (a, f) => a.patch(`/api/admin/helpdesk/canned-replies/${f.canned.id}`, { sortOrder: 7 }),
  ],
  'GET /api/admin/helpdesk/locations': [HA, (a) => a.get('/api/admin/helpdesk/locations')],
  'POST /api/admin/helpdesk/locations': [
    HA,
    (a) => a.post('/api/admin/helpdesk/locations', { nameEn: 'Warehouse', nameAr: 'المستودع' }),
  ],
  'PATCH /api/admin/helpdesk/locations/:id': [
    HA,
    (a, f) => a.patch(`/api/admin/helpdesk/locations/${f.location.id}`, { sortOrder: 7 }),
  ],
  'GET /api/admin/helpdesk/holidays': [HA, (a) => a.get('/api/admin/helpdesk/holidays')],
  'POST /api/admin/helpdesk/holidays': [
    HA,
    (a) =>
      a.post('/api/admin/helpdesk/holidays', {
        date: '2027-03-03',
        nameEn: 'Extra day',
        nameAr: 'يوم إضافي',
      }),
  ],
  'PATCH /api/admin/helpdesk/holidays/:id': [
    HA,
    (a, f) => a.patch(`/api/admin/helpdesk/holidays/${f.holiday.id}`, { nameEn: 'Renamed' }),
  ],
  'DELETE /api/admin/helpdesk/holidays/:id': [
    HA,
    (a, f) => a.del(`/api/admin/helpdesk/holidays/${f.holiday.id}`),
  ],
};

/* ----------------------------------------------------------------- tests */

const PASSED_THE_CHECK = new Set([200, 201, 202, 204, 400, 409, 415]);
const REFUSED = new Set([403, 404]);

describe('authorisation matrix', () => {
  test('every route the app answers has a row, and every row is a real route', () => {
    const routes = world().app.locals.routes;
    assert.ok(routes.length > 100, `only ${routes.length} routes were recorded`);
    assert.equal(new Set(routes).size, routes.length, 'a route is mounted twice');

    const untested = routes.filter((route) => !MATRIX[route]);
    const stale = Object.keys(MATRIX).filter((route) => !routes.includes(route));
    assert.deepEqual(untested, [], 'routes with no row in the authorisation matrix');
    assert.deepEqual(stale, [], 'matrix rows for routes that no longer exist');
  });

  test('Entra mode adds only the three sign-in routes, all public by design', () => {
    const app = createApp({
      config: {
        NODE_ENV: 'development',
        AUTH_MODE: 'entra',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        ENTRA_CLIENT_SECRET: 's',
      },
      userRepo: createMemoryUserRepo(),
      msalClient: {},
    });
    const extra = app.locals.routes.filter((route) => !MATRIX[route]);
    assert.deepEqual(extra.sort(), [
      'GET /auth/callback',
      'GET /auth/login',
      'POST /auth/logout',
    ]);
  });

  for (const [route, [allowed, call]] of Object.entries(MATRIX)) {
    if (!call) continue;

    test(route, async () => {
      // Not signed in.
      const f0 = world();
      const nobody = await call(client(f0.app, null), f0);
      if (allowed === PUBLIC) {
        assert.equal(nobody.status, 200, `nobody: ${JSON.stringify(nobody.body)}`);
        return;
      }
      // A write without a session has no CSRF token either: 401 or 403, never served.
      assert.ok(
        nobody.status === 401 ||
          (nobody.status === 403 && nobody.body.error?.code === 'csrf_invalid'),
        `nobody got ${nobody.status}`
      );

      for (const who of ACTORS) {
        const f = world();
        const actor = await client(f.app, f.person(who)).signIn();
        const res = await call(actor, f);
        const say = `${who} got ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`;
        if (allowed.includes(who)) {
          assert.ok(PASSED_THE_CHECK.has(res.status), `should be allowed: ${say}`);
        } else {
          assert.ok(REFUSED.has(res.status), `should be denied: ${say}`);
        }
      }
    });
  }

  test('a signed-out reader gets 401 from a read on every protected route', async () => {
    const f = world();
    for (const route of f.app.locals.routes) {
      if (MATRIX[route]?.[0] === PUBLIC || !route.startsWith('GET ')) continue;
      const path = route.slice(4).replace(/:\w+/g, randomUUID());
      const res = await request(f.app).get(path);
      assert.equal(res.status, 401, route);
    }
  });
});
