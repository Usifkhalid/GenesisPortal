/**
 * The two links published for the helpdesk, /new (every employee) and /queue
 * (the IT team), and sign-in returning a person to the link they opened.
 * A return address comes from the address bar, so most of this file is about
 * what is refused: anything that is not a path on this site.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import request from 'supertest';

import { createApp } from '../src/app.js';
import { safeReturnPath } from '@mg/shared/server/lib/return-path.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';
import { buildApp } from '@mg/shared/server/testing/ticket-world.js';

const SALMA = 'salma.ibrahim@genesismining-eg.com';

describe('safeReturnPath', () => {
  test('keeps a path on this site, with its query and #address', () => {
    for (const ok of [
      '/new',
      '/queue',
      '/',
      '/#tickets/new',
      '/#tickets/2b1f8c1e-1111-4c39-9b3a-1c2d3e4f5a6b',
      '/new?from=email',
      '/queue#assigned',
    ]) {
      assert.equal(safeReturnPath(ok), ok, ok);
    }
  });

  test('refuses another site, however it is written', () => {
    for (const bad of [
      'https://evil.example/new',
      'http://evil.example',
      '//evil.example',
      '//evil.example/new',
      '/\\evil.example',
      '\\\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/.//evil.example',
      '/./\\evil.example',
      'javascript:alert(1)',
      'data:text/html,x',
      'evil.example/new',
      'new',
      '',
      '   /new',
      '/new\u0000',
    ]) {
      assert.equal(safeReturnPath(bad), null, JSON.stringify(bad));
    }
  });

  test('refuses what is not a page: the API, sign-in and sign-out, and things that are not text', () => {
    for (const bad of [
      '/api/me',
      '/api/tickets/mine',
      '/auth/login',
      '/auth/callback?code=x',
      '/login.html',
      '/LOGIN.HTML?next=/new',
      '/login',
      undefined,
      null,
      42,
      ['/new'],
      { toString: () => '/new' },
      `/${'a'.repeat(600)}`,
    ]) {
      assert.equal(safeReturnPath(bad), null, String(bad).slice(0, 40));
    }
  });
});

describe('the published links', () => {
  test('/new and /queue answer with the helpdesk page, signed in or not', async () => {
    const { app } = buildApp(createApp);
    const home = (await request(app).get('/')).text;
    for (const path of ['/new', '/queue']) {
      const res = await request(app).get(path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers['content-type'], /text\/html/);
      assert.equal(res.text, home, `${path} is the same page as the bare address`);
      assert.match(res.headers['content-security-policy'], /script-src 'self'/);
      assert.equal(res.headers['cache-control'], 'no-cache');
    }
    // The API behind them still says no to someone who is not signed in.
    assert.equal((await request(app).get('/api/me')).status, 401);
  });

  test('a trailing slash is sent to the link itself, so the page’s relative files still load', async () => {
    const { app } = buildApp(createApp);
    const res = await request(app).get('/new/?x=1');
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, '/new?x=1');
    assert.equal((await request(app).get('/queue/')).headers.location, '/queue');
  });

  test('other made-up addresses are still not found', async () => {
    const { app } = buildApp(createApp);
    for (const path of ['/news', '/queue.html', '/new/x', '/tickets']) {
      assert.equal((await request(app).get(path)).status, 404, path);
    }
  });
});

describe('sign-in goes back to the link that was opened (mock sign-in)', () => {
  const person = (repo) => repo.users.find((u) => u.email === SALMA);

  test('the login page learns the link only if it is one of ours', async () => {
    const { app } = buildApp(createApp);
    const next = async (value) =>
      (await request(app).get('/api/auth/config').query({ next: value })).body.next;

    assert.equal(await next('/new'), '/new');
    assert.equal(await next('/queue'), '/queue');
    assert.equal(await next('/#tickets/abc'), '/#tickets/abc');
    for (const bad of ['https://evil.example', '//evil.example', '/api/me', '/login.html']) {
      assert.equal(await next(bad), null, bad);
    }
    assert.equal((await request(app).get('/api/auth/config')).body.next, null);
    // A list where a string belongs does not break the login page.
    const odd = await request(app).get('/api/auth/config?next=/new&next=/queue');
    assert.equal(odd.status, 200);
    assert.equal(odd.body.next, null);
  });

  test('mock sign-in returns to the link, or to the usual page when the link is refused', async () => {
    const { app, repo } = buildApp(createApp);
    const login = async (next) => {
      const agent = request.agent(app);
      const config = await agent.get('/api/auth/config');
      const body = { userId: person(repo).id, ...(next === undefined ? {} : { next }) };
      return agent
        .post('/api/auth/mock-login')
        .set('X-CSRF-Token', config.body.csrfToken)
        .send(body);
    };

    assert.equal((await login('/new')).body.redirectTo, '/new');
    assert.equal((await login('/queue')).body.redirectTo, '/queue');
    assert.equal((await login('/#tickets/abc')).body.redirectTo, '/#tickets/abc');
    assert.equal((await login()).body.redirectTo, '/');
    for (const bad of [
      'https://evil.example/',
      '//evil.example',
      '/\\evil.example',
      '/api/me',
    ]) {
      const res = await login(bad);
      assert.equal(res.status, 200, bad);
      assert.equal(res.body.redirectTo, '/', bad);
    }
  });
});

describe('sign-in goes back to the link that was opened (Microsoft sign-in)', () => {
  const TENANT = '11111111-2222-4333-8444-555555555555';
  const ENTRA = {
    NODE_ENV: 'development',
    AUTH_MODE: 'entra',
    ENTRA_TENANT_ID: TENANT,
    ENTRA_CLIENT_ID: 'client-id',
    ENTRA_CLIENT_SECRET: 'client-secret',
    APP_BASE_URL: 'https://helpdesk.test',
  };

  /** Behaves like MSAL for one sign-in: remembers the request, signs in Salma. */
  function fakeMsal() {
    const oid = createMemoryUserRepo().users.find((u) => u.email === SALMA).entraObjectId;
    const calls = { url: null };
    return {
      calls,
      async getAuthCodeUrl(req) {
        calls.url = req;
        return `https://login.example/authorize?state=${encodeURIComponent(req.state)}`;
      },
      async acquireTokenByCode() {
        return { idTokenClaims: { tid: TENANT, nonce: calls.url.nonce, oid } };
      },
      clearCache() {},
    };
  }

  async function signInVia(loginPath) {
    const msalClient = fakeMsal();
    const { app } = buildApp(createApp, { config: ENTRA, msalClient });
    const agent = request.agent(app);
    const login = await agent.get(loginPath);
    assert.equal(login.status, 302, loginPath);
    return agent
      .get('/auth/callback')
      .query({ code: 'good', state: msalClient.calls.url.state });
  }

  test('the callback returns to the link given at /auth/login', async () => {
    assert.equal((await signInVia('/auth/login?next=%2Fnew')).headers.location, '/new');
    assert.equal((await signInVia('/auth/login?next=%2Fqueue')).headers.location, '/queue');
    assert.equal(
      (await signInVia(`/auth/login?next=${encodeURIComponent('/#tickets/abc')}`)).headers
        .location,
      '/#tickets/abc'
    );
  });

  test('no link, or one that is refused, lands on the usual page', async () => {
    assert.equal((await signInVia('/auth/login')).headers.location, '/');
    for (const bad of [
      'https://evil.example/',
      '//evil.example',
      '/\\evil.example',
      '/api/me',
      '/auth/login',
    ]) {
      const res = await signInVia(`/auth/login?next=${encodeURIComponent(bad)}`);
      assert.equal(res.headers.location, '/', bad);
    }
  });

  test('a link is used once: the next sign-in without one lands on the usual page', async () => {
    const msalClient = fakeMsal();
    const { app } = buildApp(createApp, { config: ENTRA, msalClient });
    const agent = request.agent(app);

    await agent.get('/auth/login?next=%2Fqueue');
    const first = await agent
      .get('/auth/callback')
      .query({ code: 'good', state: msalClient.calls.url.state });
    assert.equal(first.headers.location, '/queue');

    const other = request.agent(app);
    await other.get('/auth/login');
    const second = await other
      .get('/auth/callback')
      .query({ code: 'good', state: msalClient.calls.url.state });
    assert.equal(second.headers.location, '/');
  });
});
