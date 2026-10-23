import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { createMemoryStorage } from '@mg/shared/server/lib/storage.js';
import { cairoWallToUtc } from '@mg/shared/server/lib/time.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';
import { runAuthzMatrix } from '@mg/shared/server/testing/authz-matrix.js';
import { client } from '@mg/shared/server/testing/clients.js';
import { commonRows } from '@mg/shared/server/testing/matrix-rows.js';

/**
 * The authorisation matrix: every route the app answers, asked by every kind
 * of person, with the answer the product's rules call for.
 *
 * The route list is not written here: it is app.locals.routes, recorded as
 * app.js mounts each router. A route with no row in MATRIX fails the first
 * test, so a new endpoint cannot ship without saying who may use it. The
 * runner is shared with the IT Helpdesk (packages/shared/server/testing).
 *
 * Who asks (the records they ask about belong to Genesis, GEN):
 *   userGen   User, Genesis                 userMsr   User, Masar
 *   caGen     CompanyAdmin, Genesis         caMsr     CompanyAdmin, Masar
 *   itAgent   User, MG Holding              itLead    User, MG Holding
 *   ha        HoldingAdmin (MG Holding)     nobody    not signed in
 * Users and company admins come from two companies, which is what shows a
 * Masar person refused on Genesis records. The two IT people are plain Users
 * of the holding here: IT staff use the portal like everyone else (D146); the
 * helpdesk's routes and their matrix are apps/helpdesk's.
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

const PEOPLE = {
  userGen: 'salma.ibrahim@genesismining-eg.com',
  userMsr: 'yasmine.nabil@masar.eg',
  itAgent: 'sherif.awad@mgholding.example',
  itLead: 'omar.fahmy@mgholding.example',
  caGen: 'hany.soliman@genesismining-eg.com',
  caMsr: 'tarek.elmasry@masar.eg',
  ha: 'nadia.elsayed@mgholding.example',
};
const ACTORS = Object.keys(PEOPLE);

const ALL = ACTORS;
/** Everyone with the portal: IT staff too (D146). */
const PORTAL = ACTORS;
const ADMINS = ['caGen', 'caMsr', 'ha'];
const GEN_ADMINS = ['caGen', 'ha'];
const HA = ['ha'];
const GEN_PEOPLE = ['userGen', 'caGen', 'ha'];
const GEN_READERS = ['userGen', 'caGen'];

/* ------------------------------------------------------------- one world */

/** A fresh app with lazily made fixtures, all belonging to Genesis. */
function world() {
  const repo = createMemoryUserRepo({ supportTeams: false });
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
  };
  Object.assign(f, { once, ok });
  return f;
}

/* ---------------------------------------------------------------- matrix */

const stamp = (row) => `updatedAt=${encodeURIComponent(row.updatedAt)}`;

/** "METHOD /path" → [who is allowed, the request]. */
const MATRIX = {
  ...commonRows({
    ALL,
    // Any mail will do: a booking cancelled by an administrator tells its organiser.
    mail: (f) =>
      f.app.locals.notify([f.person('userGen').id], 'booking.cancelled', {
        link: '#rooms',
        room: 'Boardroom',
        subject: 'Budget review',
        start: NOW.toISOString(),
      }),
  }),

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
  'GET /api/announcements': [PORTAL, (a) => a.get('/api/announcements')],
  'GET /api/announcements/unread-count': [
    PORTAL,
    (a) => a.get('/api/announcements/unread-count'),
  ],
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
  'GET /api/directory/people': [PORTAL, (a) => a.get('/api/directory/people')],
  'GET /api/directory/people/:id': [
    PORTAL,
    (a, f) => a.get(`/api/directory/people/${f.person('userGen').id}`),
  ],
  'GET /api/directory/filters': [PORTAL, (a) => a.get('/api/directory/filters')],
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
  'GET /api/rooms': [PORTAL, (a) => a.get('/api/rooms')],
  'GET /api/rooms/availability': [
    PORTAL,
    (a) => a.get(`/api/rooms/availability?date=${MONDAY}`),
  ],
  'GET /api/rooms/find': [
    PORTAL,
    (a) => a.get(`/api/rooms/find?date=${MONDAY}&start=10:00&duration=60`),
  ],
  'GET /api/rooms/:id': [PORTAL, async (a, f) => a.get(`/api/rooms/${(await f.room()).id}`)],
  'GET /api/rooms/:id/photo': [
    PORTAL,
    async (a, f) => {
      await f.roomPhoto();
      return a.get(`/api/rooms/${(await f.room()).id}/photo`);
    },
  ],
  'POST /api/bookings': [
    PORTAL,
    async (a, f) =>
      a.post('/api/bookings', {
        roomId: (await f.room()).id,
        subject: 'Stand-up',
        start: at(MONDAY, '13:00'),
        end: at(MONDAY, '13:30'),
      }),
  ],
  'GET /api/bookings/mine': [PORTAL, (a) => a.get('/api/bookings/mine')],
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
};

/* ----------------------------------------------------------------- tests */

runAuthzMatrix({
  world,
  matrix: MATRIX,
  actors: ACTORS,
  minRoutes: 75,
  entraApp: () =>
    createApp({
      config: {
        NODE_ENV: 'development',
        AUTH_MODE: 'entra',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        ENTRA_CLIENT_SECRET: 's',
      },
      userRepo: createMemoryUserRepo(),
      msalClient: {},
    }),
});
