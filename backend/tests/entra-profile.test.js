/**
 * The profile refresh at Entra sign-in (modules/auth/refresh.js, D138): the
 * person's own /me and /me/manager, read with the token from that sign-in,
 * through a stand-in for integrations/graph/delegated.js.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import {
  DelegatedGraphError,
  createDelegatedGraph,
} from '../src/integrations/graph/delegated.js';
import { createMemoryUserRepo } from '../src/modules/auth/repo-memory.js';
import { createProfileRefresher, planProfileRefresh } from '../src/modules/auth/refresh.js';

const TENANT = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'delegated-test-token';
const ENTRA = {
  NODE_ENV: 'development',
  AUTH_MODE: 'entra',
  // The refresh works whatever the app-wide Graph mode is.
  GRAPH_MODE: 'mock',
  ENTRA_TENANT_ID: TENANT,
  ENTRA_CLIENT_ID: 'client-id',
  ENTRA_CLIENT_SECRET: 'client-secret',
  APP_BASE_URL: 'https://portal.test',
};
const SALMA = 'salma.ibrahim@genesismining-eg.com';

/** MSAL for one sign-in at a time: `claims` says who, plus a delegated token. */
function fakeMsal() {
  const msal = {
    claims: {},
    accessToken: TOKEN,
    url: null,
    async getAuthCodeUrl(req) {
      msal.url = req;
      return 'https://login.example/authorize';
    },
    async acquireTokenByCode(req) {
      msal.token = req;
      return {
        idTokenClaims: { tid: TENANT, nonce: req.nonce, ...msal.claims },
        accessToken: msal.accessToken,
      };
    },
    clearCache() {},
  };
  return msal;
}

/** Graph as the signed-in person; records the tokens it was handed. */
function fakeGraph({ me = {}, manager = null } = {}) {
  const graph = {
    me,
    manager,
    tokens: [],
    calls: { me: 0, manager: 0 },
    async getMe(token) {
      graph.tokens.push(token);
      graph.calls.me += 1;
      if (graph.me instanceof Error) throw graph.me;
      return graph.me;
    },
    async getMyManager(token) {
      graph.tokens.push(token);
      graph.calls.manager += 1;
      if (graph.manager instanceof Error) throw graph.manager;
      return graph.manager;
    },
  };
  return graph;
}

function build(graphOptions) {
  const repo = createMemoryUserRepo();
  const msal = fakeMsal();
  const graph = fakeGraph(graphOptions);
  const app = createApp({
    config: ENTRA,
    userRepo: repo,
    authRateLimit: { limit: 10_000 },
    msalClient: msal,
    profileGraph: graph,
  });
  const user = (email) => repo.users.find((u) => u.email === email);
  const company = (code) => repo.companies.find((c) => c.code === code);
  const refreshAudits = () => repo.auditLogs.filter((a) => a.action === 'user.graph_refresh');

  async function signIn(claims) {
    msal.claims = claims;
    const agent = request.agent(app);
    await agent.get('/auth/login');
    const res = await agent
      .get('/auth/callback')
      .query({ code: 'good', state: msal.url.state });
    return { agent, res };
  }
  const signInAs = (email) =>
    signIn({ oid: user(email).entraObjectId, preferred_username: email });

  return { repo, msal, graph, user, company, refreshAudits, signIn, signInAs };
}

const SALMA_ME = {
  displayName: 'Salma Ibrahim',
  jobTitle: 'Chief Geologist',
  department: 'geology and exploration',
  companyName: 'Genesis Mining',
  officeLocation: 'Sukari Site',
  businessPhones: ['+20 2 1234 5678'],
  mobilePhone: '+20 100 000 0000',
};

describe('profile refresh at Entra sign-in', () => {
  test('signing in brings the profile up to date from /me, with the sign-in token', async () => {
    const t = build({ me: SALMA_ME });
    const before = { ...t.user(SALMA) };
    // Graph names the manager she already has.
    const boss = t.repo.users.find((u) => u.id === before.managerId);
    t.graph.manager = { id: boss.entraObjectId };

    const { res, agent } = await t.signInAs(SALMA);

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
    assert.deepEqual(new Set(t.graph.tokens), new Set([TOKEN]));
    assert.ok(t.msal.url.scopes.includes('User.Read'));

    const after = t.user(SALMA);
    assert.equal(after.jobTitle, 'Chief Geologist');
    assert.equal(after.officeLocation, 'Sukari Site');
    assert.equal(after.phone, '+20 2 1234 5678');
    assert.equal(after.mobilePhone, '+20 100 000 0000');
    assert.equal(after.graphDepartment, 'geology and exploration');
    // Matched by name, in another letter case, within her company.
    assert.equal(after.departmentId, before.departmentId);
    assert.equal(after.companyId, t.company('GEN').id);
    assert.equal(after.displayNameAr, before.displayNameAr);
    assert.match(after.searchKey, /chief geologist/);

    const [audit, ...more] = t.refreshAudits();
    assert.equal(more.length, 0);
    assert.equal(audit.actorId, after.id);
    assert.equal(audit.entityId, after.id);
    const changed = Object.keys(JSON.parse(audit.after)).filter(
      (k) => !['id', 'companyId'].includes(k)
    );
    assert.deepEqual(changed.sort(), [
      'graphCompanyName',
      'graphDepartment',
      'jobTitle',
      'mobilePhone',
      'officeLocation',
      'phone',
    ]);
    assert.doesNotMatch(JSON.stringify(t.repo.auditLogs), new RegExp(TOKEN));

    const me = await agent.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.jobTitle, 'Chief Geologist');
    assert.doesNotMatch(JSON.stringify(me.body), new RegExp(TOKEN));
  });

  test('signing in again with nothing new changes and audits nothing', async () => {
    const t = build({ me: SALMA_ME });
    await t.signInAs(SALMA);
    assert.equal(t.refreshAudits().length, 1);

    await t.signInAs(SALMA);
    assert.equal(t.graph.calls.me, 2);
    assert.equal(t.refreshAudits().length, 1);
  });

  test('the Arabic name is never overwritten, the English one follows Graph', async () => {
    const t = build({ me: { ...SALMA_ME, displayName: 'Salma A. Ibrahim' } });
    const arabic = t.user(SALMA).displayNameAr;
    await t.signInAs(SALMA);
    assert.equal(t.user(SALMA).displayNameEn, 'Salma A. Ibrahim');
    assert.equal(t.user(SALMA).displayNameAr, arabic);
  });

  test('the manager comes from /me/manager when Graph allows it', async () => {
    const t = build({ me: SALMA_ME });
    const boss = t.repo.users.find(
      (u) => u.email !== SALMA && u.id !== t.user(SALMA).managerId
    );
    t.graph.manager = { id: boss.entraObjectId.toUpperCase() };

    await t.signInAs(SALMA);
    assert.equal(t.user(SALMA).managerId, boss.id);

    // Graph says she has none now.
    t.graph.manager = null;
    await t.signInAs(SALMA);
    assert.equal(t.user(SALMA).managerId, null);
  });

  test('a refused /me/manager keeps the manager, and the rest is still refreshed', async () => {
    const t = build({ me: SALMA_ME, manager: new DelegatedGraphError('forbidden', 403) });
    const kept = t.repo.users.find((u) => u.email !== SALMA).id;
    t.user(SALMA).managerId = kept;

    const { res } = await t.signInAs(SALMA);
    assert.equal(res.headers.location, '/');
    assert.equal(t.user(SALMA).managerId, kept);
    assert.equal(t.user(SALMA).jobTitle, 'Chief Geologist');
    const audited = JSON.parse(t.refreshAudits()[0].after);
    assert.equal('managerId' in audited, false);
  });

  test('companyName naming a portal company places the person there', async () => {
    const t = build({ me: { ...SALMA_ME, companyName: 'MASAR', department: 'Nowhere' } });
    await t.signInAs(SALMA);
    assert.equal(t.user(SALMA).companyId, t.company('MSR').id);
    assert.equal(t.user(SALMA).company.code, 'MSR');
    // A department of the old company cannot follow her there.
    assert.equal(t.user(SALMA).departmentId, null);
    assert.equal(t.user(SALMA).graphDepartment, 'Nowhere');
  });

  test('a companyName that matches no company leaves the email domain to decide', async () => {
    const t = build({ me: { ...SALMA_ME, companyName: 'Acme Contractors Ltd' } });
    await t.signInAs(SALMA);
    assert.equal(t.user(SALMA).companyId, t.company('GEN').id);
    assert.equal(t.user(SALMA).graphCompanyName, 'Acme Contractors Ltd');
  });

  test('a Graph failure never stops the sign-in', async () => {
    const t = build({ me: new DelegatedGraphError('failed', 500) });
    const before = { ...t.user(SALMA) };
    const { res, agent } = await t.signInAs(SALMA);
    assert.equal(res.headers.location, '/');
    assert.equal((await agent.get('/api/me')).status, 200);
    assert.equal(t.user(SALMA).jobTitle, before.jobTitle);
    assert.equal(t.refreshAudits().length, 0);
  });

  test('without an access token Graph is not called', async () => {
    const t = build({ me: SALMA_ME });
    t.msal.accessToken = undefined;
    const { res } = await t.signInAs(SALMA);
    assert.equal(res.headers.location, '/');
    assert.equal(t.graph.calls.me + t.graph.calls.manager, 0);
  });

  test('a profile made at first sign-in is filled in from Graph straight away', async () => {
    const t = build({ me: { ...SALMA_ME, displayName: 'Omar New' } });
    const email = 'omar.new@genesismining-eg.com';
    const { res } = await t.signIn({
      oid: randomUUID(),
      preferred_username: email,
      name: 'Omar New',
    });
    assert.equal(res.headers.location, '/');
    const omar = t.user(email);
    assert.equal(omar.jobTitle, 'Chief Geologist');
    assert.equal(omar.displayNameAr, 'Omar New');
    assert.ok(t.repo.auditLogs.some((a) => a.action === 'user.jit_create'));
    assert.equal(t.refreshAudits().length, 1);
  });
});

describe('createProfileRefresher', () => {
  test('a refused manager lookup is logged once, not at every sign-in', async () => {
    const repo = createMemoryUserRepo();
    const salma = repo.users.find((u) => u.email === SALMA);
    const graph = fakeGraph({
      me: SALMA_ME,
      manager: new DelegatedGraphError('forbidden', 403),
    });
    const lines = [];
    const log = { info: (...a) => lines.push(a), warn: (...a) => lines.push(a) };
    const refresh = createProfileRefresher({ repo, graph });

    await refresh({ log, ip: '127.0.0.1' }, salma.id, TOKEN);
    await refresh({ log, ip: '127.0.0.1' }, salma.id, TOKEN);
    const refusals = lines.filter((a) =>
      a.some((x) => typeof x === 'string' && x.includes('/me/manager refused'))
    );
    assert.equal(refusals.length, 1);
    assert.doesNotMatch(JSON.stringify(lines), new RegExp(TOKEN));
  });
});

describe('planProfileRefresh', () => {
  const companies = [
    {
      id: 'c-gen',
      code: 'GEN',
      nameEn: 'Genesis Mining',
      nameAr: 'جينيسيس',
      domains: ['gen.test'],
    },
  ];
  const person = {
    id: 'p1',
    email: 'a@gen.test',
    companyId: 'c-gen',
    departmentId: null,
    managerId: 'm1',
    displayNameEn: 'A',
    displayNameAr: 'أ',
    jobTitle: 'Clerk',
    officeLocation: null,
    phone: null,
    mobilePhone: null,
    graphDepartment: null,
    graphCompanyName: null,
  };

  test('only fields that differ are written; an unknown manager is left alone', () => {
    const { data, changed } = planProfileRefresh({
      person,
      me: { displayName: ' A ', jobTitle: 'Engineer', businessPhones: [] },
      managerId: undefined,
      companies,
      departments: [],
    });
    assert.deepEqual(changed, ['jobTitle']);
    assert.equal(data.jobTitle, 'Engineer');
    assert.equal('displayNameAr' in data, false);
  });

  test('a person is never made their own manager', () => {
    const { changed } = planProfileRefresh({
      person: { ...person, jobTitle: null },
      me: { displayName: 'A' },
      managerId: 'p1',
      companies,
      departments: [],
    });
    assert.deepEqual(changed, []);
  });
});

describe('delegated Graph reader', () => {
  const respond = (status, body) => async (url, init) => {
    respond.last = { url, init };
    return { ok: status < 300, status, json: async () => body };
  };

  test('/me asks for the profile fields with the person’s token', async () => {
    const graph = createDelegatedGraph({ fetch: respond(200, { id: 'x', jobTitle: 'T' }) });
    assert.deepEqual(await graph.getMe(TOKEN), { id: 'x', jobTitle: 'T' });
    assert.match(respond.last.url, /\/v1\.0\/me\?\$select=/);
    for (const field of [
      'jobTitle',
      'department',
      'companyName',
      'officeLocation',
      'businessPhones',
      'mobilePhone',
    ]) {
      assert.ok(respond.last.url.includes(field), field);
    }
    assert.equal(respond.last.init.headers.Authorization, `Bearer ${TOKEN}`);
  });

  test('/me/manager: an id, none (404), or refused (403)', async () => {
    assert.deepEqual(
      await createDelegatedGraph({ fetch: respond(200, { id: 'M' }) }).getMyManager(TOKEN),
      { id: 'M' }
    );
    assert.equal(
      await createDelegatedGraph({ fetch: respond(404, {}) }).getMyManager(TOKEN),
      null
    );
    await assert.rejects(
      createDelegatedGraph({ fetch: respond(403, {}) }).getMyManager(TOKEN),
      (err) => err.code === 'forbidden' && !err.message.includes(TOKEN)
    );
  });
});
