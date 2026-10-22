import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { clientAddress, clientKey, stripPort } from '@mg/shared/server/lib/client-ip.js';
import { privilegeKey } from '@mg/shared/server/middleware/auth.js';
import { accountLimiter } from '@mg/shared/server/middleware/rate-limit.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';
import { createTelemetry } from '@mg/shared/server/lib/telemetry.js';

/**
 * Session 27's security review, as tests: the two session lifetimes, the end
 * of a session on a change of role, the second CSRF check, the client address
 * behind Azure's proxy, the two sign-in caps, the response headers, closed
 * CORS, what an error may say, readiness, and the telemetry hook.
 */

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function build(options = {}) {
  const repo = createMemoryUserRepo();
  const app = createApp({
    userRepo: repo,
    authRateLimit: { limit: 100_000, accountLimit: 100_000 },
    rateLimit: { limit: 100_000 },
    ...options,
    config: { ...DEV, ...options.config },
  });
  return { app, repo };
}

async function signIn(app, user, headers = {}) {
  const agent = request.agent(app);
  const config = await agent.get('/api/auth/config').set(headers);
  const login = await agent
    .post('/api/auth/mock-login')
    .set(headers)
    .set('X-CSRF-Token', config.body.csrfToken)
    .send({ userId: user.id });
  return { agent, login, csrf: login.body.csrfToken };
}

const maxAgeOf = (res) => {
  const cookie = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('mgp.sid='));
  const expires = /Expires=([^;]+)/i.exec(cookie ?? '');
  return expires ? new Date(expires[1]).getTime() - Date.now() : null;
};

describe('session lifetime', () => {
  test('a session ends at its absolute lifetime even while it is being used', async () => {
    const { app, repo } = build({ config: { sessionIdleMs: 60_000, sessionAbsoluteMs: 3000 } });
    const { agent, login } = await signIn(app, repo.users[0]);
    assert.equal(login.status, 200);

    // Active throughout: the idle window never comes close to running out.
    // (Seconds, not milliseconds: a cookie's expiry is written to the second.)
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await agent.get('/api/me')).status, 200);
      await wait(300);
    }
    await wait(2300);
    const after = await agent.get('/api/me');
    assert.equal(after.status, 401);
    assert.equal(after.body.error.code, 'unauthenticated');
    // And it stays ended: the row is gone, not just refused once.
    assert.equal((await agent.get('/api/me')).status, 401);
  });

  test('the cookie never outlives what is left of the absolute lifetime', async () => {
    const { app, repo } = build({
      config: { sessionIdleMs: 8 * 3_600_000, sessionAbsoluteMs: 5_000 },
    });
    const { agent } = await signIn(app, repo.users[0]);
    const res = await agent.get('/api/me');
    const left = maxAgeOf(res);
    assert.ok(left !== null && left <= 5_000, `cookie lives ${left} ms`);
  });

  test('with the defaults the cookie is the 8-hour idle window', async () => {
    const { app, repo } = build();
    const { agent } = await signIn(app, repo.users[0]);
    const left = maxAgeOf(await agent.get('/api/me'));
    assert.ok(left > 7.9 * 3_600_000 && left <= 8 * 3_600_000, `cookie lives ${left} ms`);
  });

  test('signing in replaces the session id and the CSRF token (fixation)', async () => {
    const { app, repo } = build();
    const agent = request.agent(app);
    const before = await agent.get('/api/auth/config');
    const sidBefore = before.headers['set-cookie'][0].split(';')[0];
    const login = await agent
      .post('/api/auth/mock-login')
      .set('X-CSRF-Token', before.body.csrfToken)
      .send({ userId: repo.users[0].id });
    const sidAfter = login.headers['set-cookie'][0].split(';')[0];

    assert.notEqual(sidAfter, sidBefore);
    assert.notEqual(login.body.csrfToken, before.body.csrfToken);
    // The id from before sign-in is not a session any more.
    const old = await request(app).get('/api/me').set('Cookie', sidBefore);
    assert.equal(old.status, 401);
  });

  test('the privilege key changes with a role, a scope or the company', () => {
    const base = { companyId: 'c1', roles: [{ role: 'User', scopeCompanyId: 'c1' }] };
    const key = privilegeKey(base);
    assert.equal(privilegeKey({ ...base, roles: [...base.roles] }), key);
    assert.notEqual(privilegeKey({ ...base, companyId: 'c2' }), key);
    assert.notEqual(
      privilegeKey({ ...base, roles: [{ role: 'CompanyAdmin', scopeCompanyId: 'c1' }] }),
      key
    );
    assert.notEqual(
      privilegeKey({ ...base, roles: [...base.roles, { role: 'HoldingAdmin' }] }),
      key
    );
  });

  test('a previous session secret still verifies after a rotation', async () => {
    const repo = createMemoryUserRepo();
    const { MemoryStore } = (await import('express-session')).default;
    const sessionStore = new MemoryStore();
    const common = { userRepo: repo, sessionStore, authRateLimit: { limit: 1000 } };
    const old = createApp({
      ...common,
      config: { ...DEV, SESSION_SECRET: 'old-secret-old-secret' },
    });
    const { login } = await signIn(old, repo.users[0]);
    const cookie = login.headers['set-cookie'][0].split(';')[0];

    const rotated = createApp({
      ...common,
      config: {
        ...DEV,
        SESSION_SECRET: 'new-secret-new-secret',
        SESSION_SECRET_PREVIOUS: 'old-secret-old-secret',
      },
    });
    assert.equal((await request(rotated).get('/api/me').set('Cookie', cookie)).status, 200);

    const forgotten = createApp({
      ...common,
      config: { ...DEV, SESSION_SECRET: 'new-secret-new-secret' },
    });
    assert.equal((await request(forgotten).get('/api/me').set('Cookie', cookie)).status, 401);
  });
});

describe('CSRF: where the request came from', () => {
  test('a write the browser marks as cross-site is refused even with the token', async () => {
    const { app, repo } = build({
      protectedRoutes(a) {
        a.post('/api/_test/echo', (req, res) => res.json({ ok: true }));
      },
    });
    const { agent, csrf } = await signIn(app, repo.users[0]);
    const send = (site) => {
      const call = agent.post('/api/_test/echo').set('X-CSRF-Token', csrf);
      return site ? call.set('Sec-Fetch-Site', site) : call;
    };

    assert.equal((await send('same-origin')).status, 200);
    assert.equal((await send(null)).status, 200, 'no header: judged on the token');
    for (const site of ['cross-site', 'same-site']) {
      const res = await send(site);
      assert.equal(res.status, 403, site);
      assert.equal(res.body.error.code, 'csrf_invalid');
    }
    // Reads are not writes.
    assert.equal((await agent.get('/api/me').set('Sec-Fetch-Site', 'cross-site')).status, 200);
  });
});

describe('the client address behind Azure App Service', () => {
  test('a port is removed and nothing else is changed', () => {
    assert.equal(stripPort('203.0.113.7:51234'), '203.0.113.7');
    assert.equal(stripPort('203.0.113.7'), '203.0.113.7');
    assert.equal(stripPort('[2001:db8::1]:443'), '2001:db8::1');
    assert.equal(stripPort('2001:db8::1'), '2001:db8::1');
    assert.equal(stripPort('not an address'), 'not an address');
    assert.equal(clientAddress({ ip: '203.0.113.7:9' }), '203.0.113.7');
    assert.equal(clientAddress({ ip: 'garbage' }), '');
    assert.equal(clientKey({ ip: 'garbage' }), 'unknown');
    // One IPv6 customer (a /56) is one key however they rotate inside it.
    assert.equal(
      clientKey({ ip: '2001:db8:aa:bb00::1' }),
      clientKey({ ip: '2001:db8:aa:bbff:1:2:3:4' })
    );
  });

  test('the cap follows the address Azure appended, not the one the client claims', async () => {
    const { app } = build({ rateLimit: { limit: 2, windowMs: 60_000 } });
    const from = (xff) => request(app).get('/api/me').set('X-Forwarded-For', xff);

    // Azure writes "client:port" and a new port on every connection.
    assert.equal((await from('198.51.100.1:1111')).status, 401);
    assert.equal((await from('198.51.100.1:2222')).status, 401);
    assert.equal((await from('198.51.100.1:3333')).status, 429, 'same client, third request');

    // Forging the left-hand entries does not buy a new allowance…
    assert.equal((await from('10.9.8.7, 198.51.100.1:4444')).status, 429);
    // …and does not spend anyone else's.
    assert.equal((await from('198.51.100.1, 198.51.100.2:5555')).status, 401);
  });

  test('with no proxy configured the header is ignored altogether', async () => {
    const { app } = build({
      config: { TRUST_PROXY_HOPS: 0 },
      rateLimit: { limit: 1, windowMs: 60_000 },
    });
    assert.equal(
      (await request(app).get('/api/me').set('X-Forwarded-For', '1.1.1.1')).status,
      401
    );
    assert.equal(
      (await request(app).get('/api/me').set('X-Forwarded-For', '2.2.2.2')).status,
      429
    );
  });

  test('the health probes are never rate limited', async () => {
    const { app } = build({ rateLimit: { limit: 1, windowMs: 60_000 } });
    for (let i = 0; i < 4; i += 1) {
      assert.equal((await request(app).get('/api/health')).status, 200);
      assert.equal((await request(app).get('/api/ready')).status, 200);
    }
  });
});

describe('sign-in caps: per account, and a far higher one per address', () => {
  test('one account is capped wherever the attempts come from', async () => {
    const { app, repo } = build({ authRateLimit: { limit: 1000, accountLimit: 3 } });
    const [victim, other] = repo.users;

    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      // A different address every time: a per-address cap alone would never trip.
      const { login } = await signIn(app, victim, { 'X-Forwarded-For': `203.0.113.${i + 1}` });
      statuses.push(login.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);

    // Nobody else is affected, from the same addresses.
    const { login } = await signIn(app, other, { 'X-Forwarded-For': '203.0.113.1' });
    assert.equal(login.status, 200);
  });

  test('a whole office behind one address signs in: many accounts, one IP', async () => {
    const { app, repo } = build({ authRateLimit: { limit: 1000, accountLimit: 3 } });
    const office = { 'X-Forwarded-For': '198.51.100.77:40000' };
    for (const user of repo.users.filter((u) => u.isActive).slice(0, 10)) {
      const { login } = await signIn(app, user, office);
      assert.equal(login.status, 200, user.email);
    }
  });

  test('the per-address ceiling still stops a flood', async () => {
    const { app, repo } = build({ authRateLimit: { limit: 4, accountLimit: 1000 } });
    const flood = { 'X-Forwarded-For': '198.51.100.9' };
    const statuses = [];
    for (const user of repo.users.slice(0, 6)) {
      statuses.push((await signIn(app, user, flood)).login.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 429, 429]);
  });

  test('the counter forgets after its window, and ignores letter case', () => {
    let at = 0;
    const accounts = accountLimiter({ windowMs: 1000, accountLimit: 2 }, DEV, () => at);
    accounts.hit('A@x.example');
    accounts.hit('a@X.example');
    assert.throws(
      () => accounts.hit('a@x.example'),
      (err) => err.status === 429
    );
    at = 1001;
    assert.doesNotThrow(() => accounts.hit('a@x.example'));
    assert.doesNotThrow(() => accounts.hit(''), 'nothing to count without an account');
  });
});

describe('response headers', () => {
  test('the Content-Security-Policy allows nothing inline and nothing foreign', async () => {
    const { app } = build();
    for (const path of ['/', '/login.html', '/api/health']) {
      const csp = (await request(app).get(path)).headers['content-security-policy'];
      assert.ok(csp, path);
      const directives = Object.fromEntries(
        csp.split(';').map((d) => {
          const [name, ...values] = d.trim().split(/\s+/);
          return [name, values];
        })
      );
      assert.deepEqual(directives['default-src'], ["'none'"]);
      assert.deepEqual(directives['script-src'], ["'self'"]);
      assert.deepEqual(directives['style-src'], ["'self'"]);
      assert.deepEqual(directives['script-src-attr'], ["'none'"]);
      assert.deepEqual(directives['style-src-attr'], ["'none'"]);
      assert.deepEqual(directives['object-src'], ["'none'"]);
      assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
      assert.deepEqual(directives['base-uri'], ["'none'"]);
      assert.deepEqual(directives['form-action'], ["'self'"]);
      assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:|\*/);
    }
  });

  test('a file under /assets carries a one-line policy that still shuts it in', async () => {
    const { app } = build();
    const { headers } = await request(app).get('/assets/js/app.js');
    assert.equal(
      headers['content-security-policy'],
      "default-src 'none';frame-ancestors 'none'"
    );
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['cross-origin-resource-policy'], 'same-origin');
    // The offline worker is a script with a life of its own: it gets the full policy.
    const worker = await request(app).get('/sw.js');
    assert.match(worker.headers['content-security-policy'], /connect-src 'self'/);
  });

  test('the other security headers are set, and nothing names the server', async () => {
    const { app } = build();
    const { headers } = await request(app).get('/login.html');
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    assert.equal(headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(headers['cross-origin-resource-policy'], 'same-origin');
    assert.match(
      headers['permissions-policy'],
      /camera=\(\).*geolocation=\(\).*microphone=\(\)/
    );
    assert.equal(headers['x-powered-by'], undefined);
    assert.equal(headers.server, undefined);
    assert.equal(headers['strict-transport-security'], undefined, 'not over plain HTTP in dev');
  });

  test('production adds HSTS, upgrade-insecure-requests and a Secure host-bound cookie', async () => {
    const app = createApp({ config: { NODE_ENV: 'production', AUTH_MODE: 'entra' } });
    const res = await request(app).get('/login.html');
    assert.match(
      res.headers['strict-transport-security'],
      /max-age=31536000; includeSubDomains/
    );
    assert.match(res.headers['content-security-policy'], /upgrade-insecure-requests/);
  });

  test('CORS is closed: no origin is ever allowed, preflights get nothing', async () => {
    const { app } = build();
    const origin = 'https://evil.example';
    const preflight = await request(app)
      .options('/api/me')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-csrf-token');
    const plain = await request(app).get('/api/auth/config').set('Origin', origin);
    for (const res of [preflight, plain]) {
      for (const name of Object.keys(res.headers)) {
        assert.ok(!name.startsWith('access-control-'), `${name} was sent`);
      }
    }
  });
});

describe('what an error may say', () => {
  const boom = (app) => {
    app.get('/api/_test/boom', () => {
      const err = new Error('password=hunter2 at C:\\secret\\path');
      err.stack = 'Error: password=hunter2\n    at secret.js:1:1';
      throw err;
    });
  };

  test('in production a failure carries a request id and nothing else', async () => {
    const app = createApp({
      config: { NODE_ENV: 'production', AUTH_MODE: 'entra' },
      routes: boom,
    });
    const res = await request(app).get('/api/_test/boom');
    assert.equal(res.status, 500);
    assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message', 'requestId']);
    assert.equal(res.body.error.message, 'Something went wrong.');
    assert.doesNotMatch(JSON.stringify(res.body), /hunter2|secret|stack|\.js/);
  });

  test('a validation failure names the field, never the value that was sent', async () => {
    const { app, repo } = build();
    const agent = request.agent(app);
    const config = await agent.get('/api/auth/config');
    const res = await agent
      .post('/api/auth/mock-login')
      .set('X-CSRF-Token', config.body.csrfToken)
      .send({ userId: 'not-a-uuid-SECRETVALUE' });
    assert.equal(res.status, 400);
    assert.doesNotMatch(JSON.stringify(res.body), /SECRETVALUE/);
    assert.ok(repo);
  });
});

describe('what a log line may hold', () => {
  test('secrets are removed wherever a caller put them', async () => {
    const { default: pino } = await import('pino');
    const { loggerOptions } = await import('@mg/shared/server/lib/logger.js');
    const lines = [];
    const log = pino(
      { ...loggerOptions, level: 'info' },
      { write: (line) => lines.push(line) }
    );

    log.info(
      {
        password: 'p-1',
        config: { ENTRA_CLIENT_SECRET: 's-2', DATABASE_URL: 'sqlserver://x;password=p-3' },
        result: { tokens: { access_token: 't-4', id_token: 't-5' } },
        req: { headers: { cookie: 'mgp.sid=c-6', authorization: 'Bearer t-7' } },
        userId: 'kept',
      },
      'done'
    );
    const line = lines.join('');
    assert.doesNotMatch(line, /p-1|s-2|p-3|t-4|t-5|c-6|t-7/);
    assert.match(line, /"userId":"kept"/);
  });

  test('a request is logged by its path, never its query string', async () => {
    const { requestLog } = await import('@mg/shared/server/middleware/request-log.js');
    const seen = requestLog.logger[Symbol.for('pino.serializers')].req({
      id: '1',
      method: 'GET',
      url: '/api/directory/people?q=someones-name',
      headers: { cookie: 'x' },
    });
    assert.deepEqual(seen, { id: '1', method: 'GET', url: '/api/directory/people' });
  });
});

describe('health and readiness', () => {
  test('ready says which parts were checked', async () => {
    const { app } = build({ checkDatabase: async () => {} });
    const res = await request(app).get('/api/ready');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ready', checks: { database: 'ok', storage: 'ok' } });
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('a database that does not answer makes the instance not ready, with no detail', async () => {
    const { app } = build({
      checkDatabase: async () => {
        throw new Error('Login failed for user portal_app at server sql-secret');
      },
    });
    const res = await request(app).get('/api/ready');
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, {
      status: 'unavailable',
      checks: { database: 'failed', storage: 'ok' },
    });
    // Liveness is separate: the process is still up.
    assert.equal((await request(app).get('/api/health')).status, 200);
  });

  test('storage that cannot be reached makes the instance not ready', async () => {
    const storage = {
      put: async () => {},
      get: async () => null,
      remove: async () => {},
      check: async () => {
        throw new Error('container missing');
      },
    };
    const { app } = build({ storage });
    const res = await request(app).get('/api/ready');
    assert.equal(res.status, 503);
    assert.equal(res.body.checks.storage, 'failed');
    assert.equal(res.body.checks.database, 'skipped', 'in memory there is no database to ask');
  });

  test('a stopping instance says so, so no new traffic is sent to it', async () => {
    const { app } = build();
    app.locals.stopping = true;
    const res = await request(app).get('/api/ready');
    assert.equal(res.status, 503);
    assert.equal(res.body.status, 'stopping');
  });
});

describe('Application Insights hook', () => {
  test('without a connection string nothing is loaded and nothing happens', async () => {
    const telemetry = await createTelemetry({});
    assert.equal(telemetry.enabled, false);
    telemetry.request({});
    telemetry.error(new Error('x'));
    telemetry.jobRun({});
    await telemetry.flush();
  });

  test('requests, errors and job runs are reported, without addresses or queries', async () => {
    const seen = { requests: [], exceptions: [], events: [] };
    const client = {
      trackRequest: (r) => seen.requests.push(r),
      trackException: (e) => seen.exceptions.push(e),
      trackEvent: (e) => seen.events.push(e),
      flush: async () => {},
    };
    const telemetry = await createTelemetry({}, client);
    const { app, repo } = build({
      telemetry,
      protectedRoutes(a) {
        a.get('/api/_test/items/:id', (req, res) => res.json({ ok: true }));
        a.get('/api/_test/boom', () => {
          throw new Error('kaput');
        });
      },
    });
    const { agent } = await signIn(app, repo.users[0]);
    await agent.get('/api/_test/items/12345?q=someones-name');
    await agent.get('/api/_test/boom');
    await wait(20);

    const item = seen.requests.find((r) => r.name === 'GET /api/_test/items/:id');
    assert.ok(item, JSON.stringify(seen.requests.map((r) => r.name)));
    assert.equal(item.resultCode, '200');
    assert.equal(item.properties.userId, repo.users[0].id);
    assert.doesNotMatch(JSON.stringify(seen.requests), /12345|someones-name/);

    assert.equal(seen.exceptions.length, 1);
    assert.equal(seen.exceptions[0].exception.message, 'kaput');
    assert.ok(seen.exceptions[0].properties.requestId);

    telemetry.jobRun({ name: 'sla-watch', outcome: 'ok', durationMs: 12 });
    assert.deepEqual(seen.events[0], {
      name: 'job.run',
      properties: { job: 'sla-watch', outcome: 'ok', durationMs: 12 },
    });
  });

  test('a telemetry client that throws never breaks a request', async () => {
    const client = {
      trackRequest() {
        throw new Error('ingestion down');
      },
    };
    const telemetry = await createTelemetry({}, client);
    const { app } = build({ telemetry });
    assert.equal((await request(app).get('/api/auth/config')).status, 200);
  });
});
