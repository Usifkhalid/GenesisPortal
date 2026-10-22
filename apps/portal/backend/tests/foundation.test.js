import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';
import { z } from 'zod';

import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import {
  databaseName,
  liveDatabaseUrl,
  resolveTestDatabaseUrl,
} from '@mg/shared/server/config/test-db.js';
import { snapshot, writeAudit } from '@mg/shared/server/lib/audit.js';
import { guardAuditLog } from '@mg/shared/server/lib/prisma.js';
import { HttpError } from '@mg/shared/server/middleware/errors.js';
import { accountLimitFor, authLimitFor } from '@mg/shared/server/middleware/rate-limit.js';
import { createFakePrisma } from './helpers/fake-prisma.js';

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** An app with a few routes that fail in the ways the error handler must cover. */
const app = createApp({
  routes(app) {
    app.get('/api/_test/boom', () => {
      throw new Error('connection string sa:hunter2@db leaked');
    });
    app.get('/api/_test/async-boom', async () => {
      throw new Error('async failure');
    });
    app.get('/api/_test/forbidden', () => {
      throw new HttpError(403, 'forbidden');
    });
    app.post('/api/_test/validate', (req, res) => {
      res.json(z.strictObject({ name: z.string().min(1) }).parse(req.body));
    });
    app.get('/api/_test/big', (req, res) => {
      res.json({ text: 'portal '.repeat(2000) });
    });
  },
});

describe('request IDs', () => {
  test('every response carries a fresh X-Request-Id', async () => {
    const [a, b] = await Promise.all([request(app).get('/api/health'), request(app).get('/')]);
    assert.match(a.headers['x-request-id'], UUID);
    assert.match(b.headers['x-request-id'], UUID);
    assert.notEqual(a.headers['x-request-id'], b.headers['x-request-id']);
  });

  test('an inbound X-Request-Id is not adopted', async () => {
    const res = await request(app).get('/api/health').set('X-Request-Id', 'forged-id');
    assert.notEqual(res.headers['x-request-id'], 'forged-id');
    assert.match(res.headers['x-request-id'], UUID);
  });
});

describe('error handler', () => {
  test('an unexpected error is a 500 that names the request', async () => {
    const res = await request(app).get('/api/_test/boom');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'internal_error');
    assert.equal(res.body.error.message, 'Something went wrong.');
    assert.equal(res.body.error.requestId, res.headers['x-request-id']);
  });

  test('a rejected async handler is caught too', async () => {
    const res = await request(app).get('/api/_test/async-boom');
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'internal_error');
  });

  test('an HttpError keeps its status and code', async () => {
    const res = await request(app).get('/api/_test/forbidden');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'forbidden');
  });

  test('a zod failure is a 400 listing fields, never the rejected values', async () => {
    const res = await request(app)
      .post('/api/_test/validate')
      .send({ name: '', password: 'do-not-echo' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'validation_failed');
    assert.ok(res.body.error.details.some((d) => d.path === 'name'));
    assert.doesNotMatch(JSON.stringify(res.body), /do-not-echo/);
  });

  test('malformed JSON is a 400, not a 500', async () => {
    const res = await request(app)
      .post('/api/_test/validate')
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'bad_request');
  });

  test('an oversized body is a 413', async () => {
    const res = await request(app)
      .post('/api/_test/validate')
      .send({ name: 'x'.repeat(200_000) });

    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'payload_too_large');
  });
});

describe('404', () => {
  test('an unknown page is a 404 without a stack or framework page', async () => {
    const res = await request(app).get('/no/such/page');
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /text\/plain/);
    assert.doesNotMatch(res.text, /Cannot GET|<html/i);
  });

  test('an /api error is JSON with the request ID', async () => {
    const res = await request(app).get('/api/nope');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthenticated');
    assert.match(res.body.error.requestId, UUID);
  });
});

describe('headers and compression', () => {
  test('helmet headers are set and Express is not advertised', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-security-policy'], /script-src 'self'/);
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('a large response is compressed when the client accepts it', async () => {
    const res = await request(app).get('/api/_test/big').set('Accept-Encoding', 'gzip');
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.body.text.length, 14_000);
  });
});

describe('rate limiter', () => {
  test('/api answers 429 past the limit, but never for the health probe', async () => {
    const limited = createApp({ rateLimit: { limit: 2, windowMs: 60_000 } });

    assert.equal((await request(limited).get('/api/a')).status, 401);
    assert.equal((await request(limited).get('/api/b')).status, 401);

    const res = await request(limited).get('/api/c');
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'rate_limited');
    assert.ok(res.headers['ratelimit']);

    assert.equal((await request(limited).get('/api/health')).status, 200);
    assert.equal((await request(limited).get('/styleguide.html')).status, 200);
  });

  test('the sign-in routes have their own stricter limit', async () => {
    const limited = createApp({ authRateLimit: { limit: 1, windowMs: 60_000 } });

    // No CSRF token, so the first is refused for that; the second never gets that far.
    assert.equal((await request(limited).post('/api/auth/mock-login')).status, 403);
    assert.equal((await request(limited).post('/api/auth/mock-login')).status, 429);
    assert.equal((await request(limited).get('/auth/login')).status, 429);
    assert.equal((await request(limited).get('/api/other')).status, 401);
  });

  test('drawing the login page does not count as a sign-in attempt', async () => {
    const limited = createApp({ authRateLimit: { limit: 1, windowMs: 60_000 } });

    for (let i = 0; i < 3; i += 1) {
      assert.equal((await request(limited).get('/api/auth/config')).status, 200);
    }
  });
});

describe('auth rate limit by environment', () => {
  test('production keeps AUTH_RATE_LIMIT_MAX; only mock development is raised', () => {
    const base = { AUTH_RATE_LIMIT_MAX: 20, AUTH_ACCOUNT_RATE_LIMIT_MAX: 10 };
    assert.equal(accountLimitFor({ ...base, NODE_ENV: 'production', AUTH_MODE: 'entra' }), 10);
    assert.ok(accountLimitFor({ ...base, NODE_ENV: 'development', AUTH_MODE: 'mock' }) >= 1000);
    assert.equal(authLimitFor({ ...base, NODE_ENV: 'production', AUTH_MODE: 'entra' }), 20);
    assert.equal(authLimitFor({ ...base, NODE_ENV: 'development', AUTH_MODE: 'entra' }), 20);
    assert.equal(authLimitFor({ ...base, NODE_ENV: 'test', AUTH_MODE: 'mock' }), 20);
    assert.ok(authLimitFor({ ...base, NODE_ENV: 'development', AUTH_MODE: 'mock' }) >= 1000);
  });

  test('production blocks the 21st sign-in attempt in a window', async () => {
    const app = createApp({ config: { NODE_ENV: 'production', AUTH_RATE_LIMIT_MAX: 20 } });
    const statuses = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await request(app).get('/auth/login')).status);
    }
    assert.notEqual(statuses[19], 429);
    assert.equal(statuses[20], 429);
  });
});

describe('config loader', () => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'sqlserver://db;database=x;user=u;password=p',
    SESSION_SECRET: 'a-long-enough-secret-of-32-characters-or-more',
    APP_BASE_URL: 'https://portal.example.com',
    AUTH_MODE: 'entra',
    GRAPH_MODE: 'real',
    NOREPLY_MAILBOX: 'no-reply@portal.example.com',
    STORAGE_DRIVER: 'azure',
    AZURE_STORAGE_ACCOUNT_URL: 'https://mgportal.blob.core.windows.net',
    SCAN_MODE: 'defender',
    ENTRA_TENANT_ID: 't',
    ENTRA_CLIENT_ID: 'c',
    ENTRA_CLIENT_SECRET: 's',
  };

  test('development boots with nothing set', () => {
    const env = loadEnv({});
    assert.equal(env.PORT, 3000);
    assert.equal(env.AUTH_MODE, 'mock');
    assert.equal(env.hasDatabase, false);
  });

  test('INITIAL_HOLDING_ADMINS is a list of lower-case emails, and nothing else', () => {
    assert.deepEqual(loadEnv({}).INITIAL_HOLDING_ADMINS, []);
    assert.deepEqual(
      loadEnv({ INITIAL_HOLDING_ADMINS: ' A@x.eg, ,b@Y.eg ' }).INITIAL_HOLDING_ADMINS,
      ['a@x.eg', 'b@y.eg']
    );
    assert.throws(
      () => loadEnv({ INITIAL_HOLDING_ADMINS: 'a@x.eg, not-an-email' }),
      /INITIAL_HOLDING_ADMINS/
    );
  });

  test('a placeholder DATABASE_URL does not count as a database', () => {
    assert.equal(
      loadEnv({ DATABASE_URL: 'sqlserver://x;password=CHANGE_ME' }).hasDatabase,
      false
    );
  });

  test('production accepts a complete configuration', () => {
    assert.equal(loadEnv(production).LOG_LEVEL, 'info');
  });

  test('production refuses missing secrets, placeholders and mock sign-in', () => {
    assert.throws(() => loadEnv({ ...production, DATABASE_URL: undefined }), /DATABASE_URL/);
    assert.throws(
      () => loadEnv({ ...production, SESSION_SECRET: 'CHANGE_ME_LONG_RANDOM_STRING' }),
      /SESSION_SECRET/
    );
    assert.throws(() => loadEnv({ ...production, AUTH_MODE: 'mock' }), /AUTH_MODE/);
    assert.throws(() => loadEnv({ ...production, APP_BASE_URL: undefined }), /APP_BASE_URL/);
    assert.throws(
      () => loadEnv({ ...production, ENTRA_CLIENT_SECRET: 'CHANGE_ME' }),
      /ENTRA_CLIENT_SECRET/
    );
  });

  test('production refuses anything mocked, weak or left at its development default', () => {
    const refuses = (change, name) =>
      assert.throws(() => loadEnv({ ...production, ...change }), name, JSON.stringify(change));
    refuses({ GRAPH_MODE: 'mock' }, /GRAPH_MODE/);
    refuses({ STORAGE_DRIVER: 'local' }, /STORAGE_DRIVER/);
    refuses({ SCAN_MODE: 'mock' }, /SCAN_MODE/);
    refuses({ AZURE_STORAGE_ACCOUNT_URL: undefined }, /AZURE_STORAGE_ACCOUNT_URL/);
    refuses({ APP_BASE_URL: 'http://portal.example.com' }, /APP_BASE_URL/);
    refuses({ SESSION_SECRET: 'sixteen-chars-ok' }, /SESSION_SECRET/);
    refuses(
      { SESSION_SECRET_PREVIOUS: 'CHANGE_ME_LONG_RANDOM_STRING' },
      /SESSION_SECRET_PREVIOUS/
    );
    refuses(
      { SESSION_IDLE_MINUTES: '900', SESSION_ABSOLUTE_HOURS: '12' },
      /SESSION_ABSOLUTE_HOURS/
    );
  });

  test('the directory has its own Graph mode, following GRAPH_MODE when absent', () => {
    assert.equal(loadEnv({}).GRAPH_DIRECTORY_MODE, 'mock');
    assert.equal(loadEnv(production).GRAPH_DIRECTORY_MODE, 'real');
    assert.throws(
      () => loadEnv({ ...production, GRAPH_DIRECTORY_MODE: 'mock' }),
      /GRAPH_DIRECTORY_MODE/
    );
    const entra = { ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', ENTRA_CLIENT_SECRET: 's' };
    const live = { PORTAL_DATA: 'live', AUTH_MODE: 'entra', GRAPH_DIRECTORY_MODE: 'real' };
    const env = loadEnv({ ...entra, ...live });
    // Mail, calendar and rooms stay mocked beside the real directory.
    assert.equal(env.GRAPH_MODE, 'mock');
    assert.equal(env.GRAPH_DIRECTORY_MODE, 'real');
    assert.throws(() => loadEnv({ ...live }), /ENTRA_CLIENT_SECRET/);
  });

  test('PORTAL_DATA keeps fake and real people apart', () => {
    const entra = { ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', ENTRA_CLIENT_SECRET: 's' };
    assert.equal(loadEnv({}).PORTAL_DATA, 'demo');
    assert.equal(loadEnv(production).PORTAL_DATA, 'live');
    assert.throws(() => loadEnv({ ...production, PORTAL_DATA: 'demo' }), /PORTAL_DATA/);
    // live: only the real directory and real sign-in.
    assert.throws(
      () => loadEnv({ ...entra, PORTAL_DATA: 'live', AUTH_MODE: 'entra' }),
      /GRAPH_DIRECTORY_MODE/
    );
    assert.throws(
      () => loadEnv({ ...entra, PORTAL_DATA: 'live', GRAPH_DIRECTORY_MODE: 'real' }),
      /AUTH_MODE/
    );
    // demo: never the real directory.
    assert.throws(
      () => loadEnv({ ...entra, AUTH_MODE: 'entra', GRAPH_DIRECTORY_MODE: 'real' }),
      /GRAPH_DIRECTORY_MODE/
    );
  });

  test('the live database is the demo one plus _live, never a test one', () => {
    const url = 'sqlserver://localhost:1433;database=mgportal;user=u;password=p';
    assert.equal(databaseName(liveDatabaseUrl(url)), 'mgportal_live');
    assert.equal(liveDatabaseUrl(liveDatabaseUrl(url)), liveDatabaseUrl(url));
    assert.throws(() => liveDatabaseUrl(url.replace('mgportal', 'mgportal_test')), /_test/);
    // The tests' database still comes from the demo name.
    assert.equal(databaseName(resolveTestDatabaseUrl({ DATABASE_URL: url })), 'mgportal_test');
  });

  test('on Azure App Service a missing NODE_ENV stops the start', () => {
    // Without this the default (development) would open mock sign-in to the internet.
    assert.throws(() => loadEnv({ WEBSITE_SITE_NAME: 'mg-portal' }), /NODE_ENV/);
    assert.throws(
      () => loadEnv({ WEBSITE_SITE_NAME: 'mg-portal', NODE_ENV: 'development' }),
      /NODE_ENV/
    );
    assert.equal(loadEnv({ ...production, WEBSITE_SITE_NAME: 'mg-portal' }).AUTH_MODE, 'entra');
  });

  test('session lifetimes are configurable and default to 8 h idle, 12 h absolute', () => {
    const defaults = loadEnv({});
    assert.equal(defaults.sessionIdleMs, 8 * 3_600_000);
    assert.equal(defaults.sessionAbsoluteMs, 12 * 3_600_000);
    const custom = loadEnv({ SESSION_IDLE_MINUTES: '30', SESSION_ABSOLUTE_HOURS: '4' });
    assert.equal(custom.sessionIdleMs, 30 * 60_000);
    assert.equal(custom.sessionAbsoluteMs, 4 * 3_600_000);
  });

  test('an invalid value is named without being echoed', () => {
    assert.throws(
      () => loadEnv({ SESSION_SECRET: 'short' }),
      (err) => /SESSION_SECRET/.test(err.message) && !/short/.test(err.message)
    );
  });
});

describe('audit log', () => {
  const req = { user: { id: 'actor-1' }, ip: '203.0.113.7' };

  test('writeAudit records actor, entity, snapshots and IP', async () => {
    const tx = createFakePrisma();
    const before = { id: 'dep-1', companyId: 'co-1', nameEn: 'Old' };
    const after = { ...before, nameEn: 'New' };

    await writeAudit(req, 'department.update', 'Department', before, after, { tx });

    const [row] = tx.auditLog.rows;
    assert.equal(row.actorId, 'actor-1');
    assert.equal(row.action, 'department.update');
    assert.equal(row.entity, 'Department');
    assert.equal(row.entityId, 'dep-1');
    assert.equal(row.companyId, 'co-1');
    assert.equal(row.ip, '203.0.113.7');
    assert.deepEqual(JSON.parse(row.before), before);
    assert.deepEqual(JSON.parse(row.after), after);
  });

  test('create has no before, delete has no after, a Company scopes to itself', async () => {
    const tx = createFakePrisma();
    await writeAudit(
      req,
      'company.create',
      'Company',
      null,
      { id: 'co-9', code: 'NEW' },
      { tx }
    );
    await writeAudit(
      req,
      'department.delete',
      'Department',
      { id: 'd', companyId: 'co-1' },
      null,
      { tx }
    );
    await writeAudit(
      req,
      'role.grant',
      'RoleAssignment',
      null,
      { id: 'r' },
      { tx, companyId: null }
    );

    const [created, deleted, holdingWide] = tx.auditLog.rows;
    assert.equal(created.before, null);
    assert.equal(created.companyId, 'co-9');
    assert.equal(deleted.after, null);
    assert.equal(deleted.entityId, 'd');
    assert.equal(holdingWide.companyId, null);
  });

  test('snapshots drop secrets and survive BigInt and Date', () => {
    const json = snapshot({
      id: 1n,
      at: new Date(0),
      clientSecret: 'x',
      nested: { apiToken: 'y' },
    });
    assert.deepEqual(JSON.parse(json), {
      id: '1',
      at: '1970-01-01T00:00:00.000Z',
      clientSecret: '[redacted]',
      nested: { apiToken: '[redacted]' },
    });
  });

  test('the Prisma client refuses to change or remove audit rows', async () => {
    const { PrismaClient } = await import('@prisma/client');
    // Never connects: the guard throws before any query is sent.
    const prisma = guardAuditLog(
      new PrismaClient({
        datasourceUrl: 'sqlserver://localhost:1;database=none;user=u;password=p',
      })
    );

    for (const op of ['update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      await assert.rejects(
        async () => prisma.auditLog[op]({ where: { id: 'x' } }),
        /append-only/,
        op
      );
    }
  });
});
