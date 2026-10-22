import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { createMemoryStorage } from '@mg/shared/server/lib/storage.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';
import { runAuthzMatrix } from '@mg/shared/server/testing/authz-matrix.js';
import { client } from '@mg/shared/server/testing/clients.js';
import { sharedRows, ticketFixture } from '@mg/shared/server/testing/matrix-rows.js';

/**
 * The IT Helpdesk's authorisation matrix (D144): every route the app answers,
 * asked by every kind of person (packages/shared/server/testing/authz-matrix.js
 * runs it). The ticket, IT and notification rows are the portal's, with the
 * helpdesk's people; Administration is the helpdesk's own.
 *
 * Who asks (the records they ask about belong to Genesis, GEN):
 *   userGen   a Genesis employee            userMsr   a Masar employee
 *   agent     IT agent                      lead      IT lead
 *   ha        the helpdesk's administrator (HoldingAdmin), not on the IT team
 *
 * Everyone signed in raises and follows their own tickets; the IT team works
 * every company's; only the administrator keeps the IT team and the companies,
 * and sees no one else's tickets for it.
 */

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };
const NOW = new Date('2026-10-11T08:00:00Z'); // a Sunday morning in Cairo

const PEOPLE = {
  userGen: 'salma.ibrahim@genesismining-eg.com',
  userMsr: 'yasmine.nabil@masar.eg',
  agent: 'sherif.awad@mgholding.example',
  lead: 'omar.fahmy@mgholding.example',
  ha: 'nadia.elsayed@mgholding.example',
};
const ACTORS = Object.keys(PEOPLE);
const ALL = ACTORS;
const STAFF = ['agent', 'lead'];
const LEADS = ['lead'];
const HA = ['ha'];

/** A fresh helpdesk with lazily made fixtures. */
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
    once,
    ok,
    gen: repo.companies.find((c) => c.code === 'GEN'),
    team: repo.helpdesk.team[0],
    category: repo.helpdesk.category.find((c) => c.nameEn === 'Laptop / PC'),
    location: repo.helpdesk.location[0],
    holiday: repo.helpdesk.holiday[0],
    canned: repo.helpdesk.canned[0],
    as: (key) => once(`as:${key}`, () => client(app, person(key)).signIn()),
    /** A company nobody in the matrix belongs to. */
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
  };
  f.ticket = ticketFixture(f);
  return f;
}

const MATRIX = {
  ...sharedRows({ ALL, STAFF, LEADS, HA }),

  /* ---- Administration: the helpdesk's HoldingAdmin (D144) */
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
  'GET /api/admin/people': [HA, (a) => a.get('/api/admin/people?q=sal')],
};

runAuthzMatrix({
  world,
  matrix: MATRIX,
  actors: ACTORS,
  minRoutes: 55,
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
