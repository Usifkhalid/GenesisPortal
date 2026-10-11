import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { ROLES } from '../src/lib/roles.js';
import {
  assertCompanyAdmin,
  assertRecordAccess,
  hasRole,
  scopeWhere,
  scopesOf,
} from '../src/lib/scope.js';
import { PrismaSessionStore, SESSION_TTL_MS, sessionCookie } from '../src/lib/session.js';
import { requireRole } from '../src/middleware/auth.js';
import { createMemoryUserRepo } from '../src/modules/auth/repo-memory.js';

/** Mock sign-in only answers in development, so the tests say they are there. */
const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };

/**
 * An app over its own copy of the seed users, with temporary routes standing
 * in for a business module: records that belong to a company, and an admin
 * action on a company.
 */
function build(options = {}) {
  const repo = createMemoryUserRepo();
  const id = (code) => repo.companies.find((c) => c.code === code).id;

  const records = [
    { id: 'rec-hld', companyId: id('HLD'), title: 'Holding record' },
    { id: 'rec-gen', companyId: id('GEN'), title: 'Genesis record' },
    { id: 'rec-msr', companyId: id('MSR'), title: 'Masar record' },
  ];

  const app = createApp({
    config: DEV,
    userRepo: repo,
    authRateLimit: { limit: 10_000 },
    protectedRoutes(app) {
      app.get('/api/_test/records', (req, res) => {
        const where = scopeWhere(req);
        const ids = where.companyId?.in ?? (where.companyId ? [where.companyId] : null);
        res.json({ items: records.filter((r) => !ids || ids.includes(r.companyId)) });
      });
      app.get('/api/_test/records/:id', (req, res) => {
        res.json(
          assertRecordAccess(
            req,
            records.find((r) => r.id === req.params.id)
          )
        );
      });
      app.post(
        '/api/_test/companies/:companyId/settings',
        requireRole(ROLES.HOLDING_ADMIN, ROLES.COMPANY_ADMIN),
        (req, res) => {
          assertCompanyAdmin(req, req.params.companyId);
          res.json({ changed: req.params.companyId, by: req.user.id });
        }
      );
      app.post('/api/_test/echo', (req, res) => res.json({ got: req.body }));
    },
    ...options,
  });

  return { app, repo, id, records };
}

/** Signs in as the first seeded user of a company holding a role. */
async function signIn(app, companyCode, role) {
  const agent = request.agent(app);
  const config = await agent.get('/api/auth/config');
  const list = await agent.get('/api/auth/mock-users');

  const company = list.body.companies.find((c) => c.code === companyCode);
  const person = company.users.find((u) => u.role === role);

  const login = await agent
    .post('/api/auth/mock-login')
    .set('X-CSRF-Token', config.body.csrfToken)
    .send({ userId: person.id });
  assert.equal(login.status, 200);

  return { agent, csrf: login.body.csrfToken, person, preLoginCsrf: config.body.csrfToken };
}

describe('unauthenticated', () => {
  const { app } = build();

  test('every API route but health and sign-in answers 401', async () => {
    for (const path of ['/api/me', '/api/_test/records', '/api/_test/records/rec-gen']) {
      const res = await request(app).get(path);
      assert.equal(res.status, 401, path);
      assert.equal(res.body.error.code, 'unauthenticated');
    }
    assert.equal((await request(app).get('/api/health')).status, 200);
    assert.equal((await request(app).get('/api/auth/config')).status, 200);
  });

  test('the login page itself is public', async () => {
    assert.equal((await request(app).get('/login.html')).status, 200);
  });

  test('a session cookie that was never issued is not a session', async () => {
    const res = await request(app).get('/api/me').set('Cookie', 'mgp.sid=s%3Aforged.signature');
    assert.equal(res.status, 401);
  });

  test('API answers are never cached', async () => {
    const res = await request(app).get('/api/auth/config');
    assert.equal(res.headers['cache-control'], 'no-store');
  });
});

describe('mock sign-in', () => {
  test('is refused outside development', async () => {
    for (const NODE_ENV of ['test', 'production']) {
      const { app } = build({ config: { NODE_ENV, AUTH_MODE: 'mock' } });
      const res = await request(app).get('/api/auth/mock-users');
      assert.equal(res.status, 404, NODE_ENV);
      assert.equal(res.body.error.code, 'not_found');
    }

    // And signing in is refused even with a valid CSRF token and a real user id.
    const { app, repo } = build({ config: { NODE_ENV: 'test', AUTH_MODE: 'mock' } });
    const agent = request.agent(app);
    const config = await agent.get('/api/auth/config');
    const login = await agent
      .post('/api/auth/mock-login')
      .set('X-CSRF-Token', config.body.csrfToken)
      .send({ userId: repo.users[0].id });
    assert.equal(login.status, 404);
    assert.equal((await agent.get('/api/me')).status, 401);
  });

  test('is refused when AUTH_MODE is entra, even in development', async () => {
    const { app } = build({
      config: {
        NODE_ENV: 'development',
        AUTH_MODE: 'entra',
        ENTRA_TENANT_ID: 'tenant',
        ENTRA_CLIENT_ID: 'client',
        ENTRA_CLIENT_SECRET: 'secret',
      },
      msalClient: {},
    });
    assert.equal((await request(app).get('/api/auth/mock-users')).status, 404);
  });

  test('lists the seeded users by company with their role, and nothing private', async () => {
    const { app } = build();
    const res = await request(app).get('/api/auth/mock-users');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.companies.map((c) => c.code).sort(), ['GEN', 'HLD', 'MSR']);
    for (const company of res.body.companies) {
      assert.equal(company.users.length, 4);
      assert.match(company.accentColor, /^#[0-9a-f]{6}$/);
      assert.ok(company.nameEn && company.nameAr);
    }

    const hld = res.body.companies.find((c) => c.code === 'HLD');
    assert.deepEqual(
      hld.users.map((u) => u.role),
      [ROLES.HOLDING_ADMIN, ROLES.COMPANY_ADMIN, ROLES.USER, ROLES.USER]
    );
    assert.doesNotMatch(JSON.stringify(res.body), /@|entraObjectId|phone/);
  });

  test('rejects a malformed or unknown user', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const { csrfToken } = (await agent.get('/api/auth/config')).body;
    const post = (body) =>
      agent.post('/api/auth/mock-login').set('X-CSRF-Token', csrfToken).send(body);

    assert.equal((await post({ userId: 'not-an-id' })).status, 400);
    assert.equal(
      (await post({ userId: crypto.randomUUID(), role: 'HoldingAdmin' })).status,
      400
    );
    assert.equal((await post({ userId: crypto.randomUUID() })).status, 404);
    assert.equal((await agent.get('/api/me')).status, 401);
  });

  test('signing in replaces the session id and sets a locked-down cookie', async () => {
    const { app, repo } = build();
    const agent = request.agent(app);

    const config = await agent.get('/api/auth/config');
    const before = config.headers['set-cookie'][0];
    const login = await agent
      .post('/api/auth/mock-login')
      .set('X-CSRF-Token', config.body.csrfToken)
      .send({ userId: repo.users[0].id });
    const after = login.headers['set-cookie'][0];

    assert.notEqual(before.split(';')[0], after.split(';')[0]);
    assert.match(after, /^mgp\.sid=/);
    assert.match(after, /HttpOnly/i);
    assert.match(after, /SameSite=Lax/i);
    assert.match(after, /Path=\//);
    assert.doesNotMatch(after, /Secure/i);

    const maxAge = Number(/Max-Age=(\d+)/i.exec(after)?.[1] ?? 0);
    const expires = Date.parse(/Expires=([^;]+)/i.exec(after)[1]);
    assert.ok(maxAge === SESSION_TTL_MS / 1000 || expires - Date.now() <= SESSION_TTL_MS);
    assert.ok(expires - Date.now() > SESSION_TTL_MS - 60_000);
  });

  test('in production the cookie is Secure and bound to the host', () => {
    const { name, options } = sessionCookie({ NODE_ENV: 'production' });
    assert.equal(name, '__Host-mgp.sid');
    assert.deepEqual(options, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    assert.equal(SESSION_TTL_MS, 8 * 60 * 60 * 1000);
  });
});

describe('GET /api/me', () => {
  test('describes a company admin: profile, branding, roles, nav', async () => {
    const { app, id } = build();
    const { agent, person } = await signIn(app, 'GEN', ROLES.COMPANY_ADMIN);
    const { status, body } = await agent.get('/api/me');

    assert.equal(status, 200);
    assert.equal(body.user.id, person.id);
    assert.equal(body.user.displayNameEn, 'Hany Soliman');
    assert.equal(body.user.displayNameAr, 'هاني سليمان');
    assert.equal(body.user.email, 'hany.soliman@genesismining-eg.com');
    assert.equal(body.user.language, 'ar');
    assert.equal(body.user.department.nameEn, 'Mining Operations');

    assert.deepEqual(body.company, {
      id: id('GEN'),
      code: 'GEN',
      nameEn: 'Genesis Mining',
      nameAr: 'جينيسيس للتعدين',
      accentColor: '#1c7a4a',
      logoUrl: 'assets/img/companies/gen.svg',
    });
    assert.deepEqual(
      body.companies.map((c) => c.code),
      ['GEN']
    );
    assert.deepEqual(body.roles, [{ role: ROLES.COMPANY_ADMIN, scopeCompanyId: id('GEN') }]);
    assert.deepEqual(
      body.nav.map((n) => n.key),
      ['home', 'announcements', 'rooms', 'tickets', 'directory', 'admin', 'auditLog']
    );
    assert.equal(body.authMode, 'mock');
    assert.ok(body.csrfToken);
  });

  test('a plain user sees no admin navigation', async () => {
    const { app } = build();
    const { agent } = await signIn(app, 'MSR', ROLES.USER);
    const { body } = await agent.get('/api/me');

    assert.deepEqual(
      body.nav.map((n) => n.group),
      ['main', 'main', 'main', 'main', 'main']
    );
    assert.deepEqual(
      body.companies.map((c) => c.code),
      ['MSR']
    );
  });

  test('a holding admin may work in every company, their own first', async () => {
    const { app } = build();
    const { agent } = await signIn(app, 'HLD', ROLES.HOLDING_ADMIN);
    const { body } = await agent.get('/api/me');

    assert.deepEqual(
      body.companies.map((c) => c.code),
      ['HLD', 'GEN', 'MSR']
    );
    assert.deepEqual(body.roles, [{ role: ROLES.HOLDING_ADMIN, scopeCompanyId: null }]);
    assert.ok(body.nav.some((n) => n.key === 'auditLog'));
  });

  test('an unknown API path is a 404 once signed in', async () => {
    const { app } = build();
    const { agent } = await signIn(app, 'GEN', ROLES.USER);
    const res = await agent.get('/api/nothing-here');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
  });
});

describe('company scoping through a session', () => {
  test('a GEN user cannot read an MSR record', async () => {
    const { app } = build();
    const { agent } = await signIn(app, 'GEN', ROLES.USER);

    const own = await agent.get('/api/_test/records/rec-gen');
    assert.equal(own.status, 200);
    assert.equal(own.body.title, 'Genesis record');

    // 404, not 403: the record's existence is not disclosed.
    const foreign = await agent.get('/api/_test/records/rec-msr');
    assert.equal(foreign.status, 404);
    assert.doesNotMatch(JSON.stringify(foreign.body), /Masar/);

    const list = await agent.get('/api/_test/records');
    assert.deepEqual(
      list.body.items.map((r) => r.id),
      ['rec-gen']
    );
  });

  test('a CompanyAdmin cannot act outside their company', async () => {
    const { app, id } = build();
    const { agent, csrf, person } = await signIn(app, 'GEN', ROLES.COMPANY_ADMIN);
    const act = (code) =>
      agent.post(`/api/_test/companies/${id(code)}/settings`).set('X-CSRF-Token', csrf);

    const own = await act('GEN');
    assert.equal(own.status, 200);
    assert.deepEqual(own.body, { changed: id('GEN'), by: person.id });

    assert.equal((await act('MSR')).status, 404);
    assert.equal((await act('HLD')).status, 404);
    assert.equal((await agent.get('/api/_test/records/rec-msr')).status, 404);
  });

  test('a HoldingAdmin can act in any company', async () => {
    const { app, id } = build();
    const { agent, csrf } = await signIn(app, 'HLD', ROLES.HOLDING_ADMIN);

    for (const code of ['HLD', 'GEN', 'MSR']) {
      const res = await agent
        .post(`/api/_test/companies/${id(code)}/settings`)
        .set('X-CSRF-Token', csrf);
      assert.equal(res.status, 200, code);
    }
    const list = await agent.get('/api/_test/records');
    assert.equal(list.body.items.length, 3);
  });

  test('a plain user cannot take an admin action, even in their own company', async () => {
    const { app, id } = build();
    const { agent, csrf } = await signIn(app, 'GEN', ROLES.USER);

    const res = await agent
      .post(`/api/_test/companies/${id('GEN')}/settings`)
      .set('X-CSRF-Token', csrf);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'forbidden');
  });

  test('a revoked role or a deactivated person takes effect on the next request', async () => {
    const { app, repo, id } = build();
    const { agent, csrf, person } = await signIn(app, 'MSR', ROLES.COMPANY_ADMIN);
    const act = () =>
      agent.post(`/api/_test/companies/${id('MSR')}/settings`).set('X-CSRF-Token', csrf);
    assert.equal((await act()).status, 200);

    const row = repo.users.find((u) => u.id === person.id);
    row.roles = [{ role: ROLES.USER, scopeCompanyId: id('MSR') }];
    assert.equal((await act()).status, 403);

    row.isActive = false;
    assert.equal((await agent.get('/api/me')).status, 401);
  });
});

describe('CSRF', () => {
  test('a state-changing request without the token is rejected', async () => {
    const { app } = build();
    const { agent, csrf, preLoginCsrf } = await signIn(app, 'GEN', ROLES.USER);

    const missing = await agent.post('/api/_test/echo').send({ a: 1 });
    assert.equal(missing.status, 403);
    assert.equal(missing.body.error.code, 'csrf_invalid');

    const wrong = await agent
      .post('/api/_test/echo')
      .set('X-CSRF-Token', 'guess')
      .send({ a: 1 });
    assert.equal(wrong.status, 403);

    // The token from before sign-in died with that session.
    const stale = await agent
      .post('/api/_test/echo')
      .set('X-CSRF-Token', preLoginCsrf)
      .send({ a: 1 });
    assert.equal(stale.status, 403);

    const good = await agent.post('/api/_test/echo').set('X-CSRF-Token', csrf).send({ a: 1 });
    assert.equal(good.status, 200);
    assert.deepEqual(good.body, { got: { a: 1 } });
  });

  test('it covers every method that changes state, and sign-in itself', async () => {
    const { app, repo } = build();
    const { agent } = await signIn(app, 'GEN', ROLES.USER);

    for (const method of ['post', 'put', 'patch', 'delete']) {
      const res = await agent[method]('/api/_test/echo');
      assert.equal(res.status, 403, method);
      assert.equal(res.body.error.code, 'csrf_invalid', method);
    }

    const anonymous = await request(app)
      .post('/api/auth/mock-login')
      .send({ userId: repo.users[0].id });
    assert.equal(anonymous.status, 403);
    assert.equal(anonymous.body.error.code, 'csrf_invalid');
  });
});

describe('sign-out', () => {
  test('ends the session and needs the CSRF token', async () => {
    const { app } = build();
    const { agent, csrf } = await signIn(app, 'GEN', ROLES.USER);

    assert.equal((await agent.post('/api/auth/logout')).status, 403);
    assert.equal((await agent.get('/api/me')).status, 200);

    const out = await agent.post('/api/auth/logout').set('X-CSRF-Token', csrf);
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { redirectTo: '/login.html' });
    assert.match(out.headers['set-cookie'][0], /^mgp\.sid=;/);

    assert.equal((await agent.get('/api/me')).status, 401);
  });
});

describe('Entra sign-in (stand-in MSAL client)', () => {
  const TENANT = '11111111-2222-4333-8444-555555555555';
  const ENTRA = {
    NODE_ENV: 'development',
    AUTH_MODE: 'entra',
    ENTRA_TENANT_ID: TENANT,
    ENTRA_CLIENT_ID: 'client-id',
    ENTRA_CLIENT_SECRET: 'client-secret',
    APP_BASE_URL: 'https://portal.test',
  };

  /** Behaves like MSAL for one sign-in: remembers the request, returns `claims`. */
  function fakeMsal(claims = {}) {
    const calls = { url: null, token: null, cleared: 0 };
    return {
      calls,
      async getAuthCodeUrl(req) {
        calls.url = req;
        return `https://login.example/authorize?state=${encodeURIComponent(req.state)}`;
      },
      async acquireTokenByCode(req) {
        calls.token = req;
        if (req.code === 'bad-code')
          throw Object.assign(new Error('x'), { errorCode: 'invalid_grant' });
        return { idTokenClaims: { tid: TENANT, nonce: calls.url.nonce, ...claims } };
      },
      clearCache() {
        calls.cleared += 1;
      },
    };
  }

  async function start(claims) {
    const msalClient = fakeMsal(claims);
    const built = build({ config: ENTRA, msalClient });
    const agent = request.agent(built.app);
    const login = await agent.get('/auth/login');
    return { ...built, agent, login, msal: msalClient.calls };
  }

  test('/auth/login sends the browser to Entra with state, nonce and a PKCE challenge', async () => {
    const { login, msal } = await start();

    assert.equal(login.status, 302);
    assert.match(login.headers.location, /^https:\/\/login\.example\/authorize/);
    assert.equal(msal.url.redirectUri, 'https://portal.test/auth/callback');
    assert.equal(msal.url.codeChallengeMethod, 'S256');
    assert.ok(msal.url.codeChallenge.length >= 43);
    assert.ok(msal.url.state.length >= 32);
    assert.ok(msal.url.nonce.length >= 32);
    assert.notEqual(msal.url.state, msal.url.nonce);
    // The verifier stays in the session; only its hash leaves.
    assert.equal(msal.url.codeVerifier, undefined);
  });

  test('the callback redeems the code with the verifier and signs in by object id', async () => {
    // The object id of a seeded profile, in the other letter case.
    const oid = createMemoryUserRepo()
      .users.find((u) => u.email === 'salma.ibrahim@genesismining-eg.com')
      .entraObjectId.toUpperCase();
    const second = await start({ oid });
    const ok = await second.agent
      .get('/auth/callback')
      .query({ code: 'good', state: second.msal.url.state, session_state: 'extra' });

    assert.equal(ok.status, 302);
    assert.equal(ok.headers.location, '/');
    assert.equal(second.msal.token.code, 'good');
    assert.equal(second.msal.token.redirectUri, 'https://portal.test/auth/callback');
    assert.equal(
      createHash('sha256').update(second.msal.token.codeVerifier).digest('base64url'),
      second.msal.url.codeChallenge
    );
    assert.equal(second.msal.cleared, 1);

    const me = await second.agent.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.displayNameEn, 'Salma Ibrahim');
    assert.equal(me.body.authMode, 'entra');
    // No token reaches the browser.
    assert.doesNotMatch(JSON.stringify(me.body), /idToken|accessToken|codeVerifier/);
  });

  test('a profile not yet tied to Entra is matched by email, then tied', async () => {
    const oid = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
    const { agent, msal, repo } = await start({
      oid,
      preferred_username: 'Yasmine.Nabil@masar.eg',
    });

    const res = await agent
      .get('/auth/callback')
      .query({ code: 'good', state: msal.url.state });
    assert.equal(res.headers.location, '/');

    const me = await agent.get('/api/me');
    assert.equal(me.body.user.email, 'yasmine.nabil@masar.eg');
    assert.equal(me.body.company.code, 'MSR');
    assert.equal(
      repo.users.find((u) => u.email === 'yasmine.nabil@masar.eg').entraObjectId,
      oid
    );
  });

  test('someone with no profile, or a deactivated one, is not let in', async () => {
    const stranger = await start({
      oid: crypto.randomUUID(),
      preferred_username: 'who@else.eg',
    });
    const res = await stranger.agent
      .get('/auth/callback')
      .query({ code: 'good', state: stranger.msal.url.state });
    assert.equal(res.headers.location, '/login.html?error=not_provisioned');
    assert.equal((await stranger.agent.get('/api/me')).status, 401);

    const gone = await start({ preferred_username: 'rania.farouk@masar.eg' });
    gone.repo.users.find((u) => u.email === 'rania.farouk@masar.eg').isActive = false;
    const refused = await gone.agent
      .get('/auth/callback')
      .query({ code: 'good', state: gone.msal.url.state });
    assert.equal(refused.headers.location, '/login.html?error=not_provisioned');
  });

  test('a wrong state, a replay, an Entra error and a failed redemption all fail closed', async () => {
    const email = { preferred_username: 'ahmed.shawky@masar.eg' };
    const failed = '/login.html?error=signin_failed';

    const forged = await start(email);
    const wrong = await forged.agent
      .get('/auth/callback')
      .query({ code: 'good', state: 'forged' });
    assert.equal(wrong.status, 302);
    assert.equal(wrong.headers.location, failed);
    assert.equal(forged.msal.token, null);
    // The pending sign-in was spent by that attempt: the true state is now useless.
    const replay = await forged.agent
      .get('/auth/callback')
      .query({ code: 'good', state: forged.msal.url.state });
    assert.equal(replay.headers.location, failed);

    // A callback in a browser that never started a sign-in.
    const cold = await request(forged.app)
      .get('/auth/callback')
      .query({ code: 'c', state: 's' });
    assert.equal(cold.headers.location, failed);

    const denied = await start(email);
    const cancel = await denied.agent
      .get('/auth/callback')
      .query({ error: 'access_denied', state: denied.msal.url.state });
    assert.equal(cancel.headers.location, failed);

    const bad = await start(email);
    const redeem = await bad.agent
      .get('/auth/callback')
      .query({ code: 'bad-code', state: bad.msal.url.state });
    assert.equal(redeem.headers.location, failed);

    const tenant = await start({ ...email, tid: crypto.randomUUID() });
    const other = await tenant.agent
      .get('/auth/callback')
      .query({ code: 'good', state: tenant.msal.url.state });
    assert.equal(other.headers.location, failed);

    const nonce = await start({ ...email, nonce: 'someone-elses' });
    const swapped = await nonce.agent
      .get('/auth/callback')
      .query({ code: 'good', state: nonce.msal.url.state });
    assert.equal(swapped.headers.location, failed);

    for (const { agent } of [forged, denied, bad, tenant, nonce]) {
      assert.equal((await agent.get('/api/me')).status, 401);
    }
  });

  test('sign-out also leaves the Entra session', async () => {
    const { agent, msal } = await start({ preferred_username: 'tarek.elmasry@masar.eg' });
    await agent.get('/auth/callback').query({ code: 'good', state: msal.url.state });
    const { csrfToken } = (await agent.get('/api/me')).body;

    for (const path of ['/auth/logout', '/api/auth/logout']) {
      assert.equal((await agent.post(path)).status, 403, path);
    }
    const out = await agent.post('/auth/logout').set('X-CSRF-Token', csrfToken);
    assert.equal(
      out.body.redirectTo,
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/logout` +
        '?post_logout_redirect_uri=https%3A%2F%2Fportal.test%2Flogin.html'
    );
    assert.equal((await agent.get('/api/me')).status, 401);
  });

  test('the Entra routes do not exist in mock mode', async () => {
    const { app } = build();
    for (const path of ['/auth/login', '/auth/callback']) {
      assert.equal((await request(app).get(path)).status, 404, path);
    }
  });
});

describe('roles', () => {
  const user = (roles) => ({ id: 'u', companyId: 'co-gen', roles });

  test('hasRole counts a HoldingAdmin only holding-wide and a CompanyAdmin only with a company', () => {
    const holding = user([{ role: ROLES.HOLDING_ADMIN, scopeCompanyId: null }]);
    const scopedHolding = user([{ role: ROLES.HOLDING_ADMIN, scopeCompanyId: 'co-gen' }]);
    const admin = user([{ role: ROLES.COMPANY_ADMIN, scopeCompanyId: 'co-gen' }]);
    const unscopedAdmin = user([{ role: ROLES.COMPANY_ADMIN, scopeCompanyId: null }]);

    assert.equal(hasRole(holding, ROLES.HOLDING_ADMIN), true);
    assert.equal(hasRole(scopedHolding, ROLES.HOLDING_ADMIN), false);
    assert.equal(hasRole(admin, ROLES.COMPANY_ADMIN), true);
    assert.equal(hasRole(unscopedAdmin, ROLES.COMPANY_ADMIN), false);
    assert.equal(hasRole(admin, ROLES.HOLDING_ADMIN), false);
    assert.equal(hasRole(user(undefined), ROLES.USER), false);
  });

  test('scopesOf is what scope.js would answer, worked out once', () => {
    assert.deepEqual(scopesOf(user([{ role: ROLES.HOLDING_ADMIN, scopeCompanyId: null }])), {
      holdingAdmin: true,
      companyIds: null,
      adminCompanyIds: null,
    });
    assert.deepEqual(
      scopesOf(user([{ role: ROLES.COMPANY_ADMIN, scopeCompanyId: 'co-msr' }])),
      {
        holdingAdmin: false,
        companyIds: ['co-gen', 'co-msr'],
        adminCompanyIds: ['co-msr'],
      }
    );
    assert.deepEqual(scopesOf(user([{ role: ROLES.USER, scopeCompanyId: 'co-gen' }])), {
      holdingAdmin: false,
      companyIds: ['co-gen'],
      adminCompanyIds: [],
    });
  });

  test('requireRole is 401 with nobody signed in and 403 without the role', () => {
    const gate = requireRole(ROLES.HOLDING_ADMIN);
    const status = (code) => (err) => err.status === code;

    assert.throws(() => gate({}, {}, () => {}), status(401));
    assert.throws(
      () =>
        gate({ user: user([{ role: ROLES.USER, scopeCompanyId: 'co-gen' }]) }, {}, () => {}),
      status(403)
    );

    let passed = false;
    gate({ user: user([{ role: ROLES.HOLDING_ADMIN, scopeCompanyId: null }]) }, {}, () => {
      passed = true;
    });
    assert.equal(passed, true);
  });
});

describe('PrismaSessionStore (over an in-memory Session table)', () => {
  /** The Prisma calls the store makes, over a Map. */
  function fakeDb() {
    const rows = new Map();
    const matching = (where) =>
      [...rows.values()].filter(
        (row) =>
          (where.sid === undefined || row.sid === where.sid) &&
          (where.expiresAt === undefined || row.expiresAt < where.expiresAt.lt)
      );
    return {
      rows,
      session: {
        findUnique: async ({ where }) => rows.get(where.sid) ?? null,
        create: async ({ data }) => {
          if (rows.has(data.sid)) throw Object.assign(new Error('unique'), { code: 'P2002' });
          rows.set(data.sid, { ...data });
        },
        updateMany: async ({ where, data }) => {
          const found = matching(where);
          for (const row of found) Object.assign(row, data);
          return { count: found.length };
        },
        deleteMany: async ({ where }) => {
          const found = matching(where);
          for (const row of found) rows.delete(row.sid);
          return { count: found.length };
        },
      },
    };
  }

  const call = (store, method, ...args) =>
    new Promise((resolve, reject) => {
      store[method](...args, (err, value) => (err ? reject(err) : resolve(value)));
    });

  const inHours = (hours) => new Date(Date.now() + hours * 3_600_000);

  test('stores, reads back, renews and ends a session', async () => {
    const db = fakeDb();
    const store = new PrismaSessionStore({ getDb: async () => db });
    const sess = {
      cookie: { expires: inHours(8).toISOString() },
      userId: 'user-1',
      csrfToken: 't',
    };

    await call(store, 'set', 'sid-1', sess);
    assert.equal(db.rows.get('sid-1').userId, 'user-1');
    assert.deepEqual(await call(store, 'get', 'sid-1'), sess);
    assert.equal(await call(store, 'get', 'no-such-sid'), null);

    const later = inHours(9);
    await call(store, 'touch', 'sid-1', { cookie: { expires: later } });
    assert.equal(db.rows.get('sid-1').expiresAt.getTime(), later.getTime());

    await call(store, 'destroy', 'sid-1');
    await call(store, 'destroy', 'sid-1');
    assert.equal(await call(store, 'get', 'sid-1'), null);
  });

  test('an expired session is not returned, and prune removes what is left', async () => {
    const db = fakeDb();
    const store = new PrismaSessionStore({ getDb: async () => db });

    await call(store, 'set', 'old', { cookie: { expires: inHours(-1) } });
    await call(store, 'set', 'older', { cookie: { expires: inHours(-2) } });
    await call(store, 'set', 'live', { cookie: { expires: inHours(1) } });

    assert.equal(await call(store, 'get', 'old'), null);
    assert.equal(db.rows.has('old'), false);

    assert.equal(await store.prune(), 1);
    assert.deepEqual([...db.rows.keys()], ['live']);
  });

  test('saving a new session that another request has just inserted updates it', async () => {
    const db = fakeDb();
    const { updateMany } = db.session;
    let first = true;
    // The other request's INSERT lands between this one's UPDATE and INSERT.
    db.session.updateMany = async (args) => {
      const result = await updateMany(args);
      if (first) {
        first = false;
        db.rows.set('sid', { sid: 'sid', data: '{}', userId: null, expiresAt: inHours(1) });
      }
      return result;
    };
    const store = new PrismaSessionStore({ getDb: async () => db });

    await call(store, 'set', 'sid', { cookie: { expires: inHours(8) }, userId: 'user-1' });
    assert.equal(db.rows.size, 1);
    assert.equal(db.rows.get('sid').userId, 'user-1');
  });

  test('without a cookie expiry the idle window is eight hours', async () => {
    const db = fakeDb();
    const store = new PrismaSessionStore({ getDb: async () => db });

    await call(store, 'set', 'sid', { cookie: {} });
    const left = db.rows.get('sid').expiresAt.getTime() - Date.now();
    assert.ok(left > SESSION_TTL_MS - 5_000 && left <= SESSION_TTL_MS);
  });

  test('a database failure reaches the caller instead of looking like no session', async () => {
    const store = new PrismaSessionStore({
      getDb: async () => {
        throw new Error('database unreachable');
      },
    });
    await assert.rejects(call(store, 'get', 'sid'), /unreachable/);
  });
});
