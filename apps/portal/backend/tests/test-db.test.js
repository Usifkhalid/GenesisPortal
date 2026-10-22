import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { env } from '../src/config/env.js';
import { databaseName, resolveTestDatabaseUrl } from '@mg/shared/server/config/test-db.js';

const DEV = 'sqlserver://localhost:1433;database=mgportal;user=u;password=p;encrypt=true';

describe('test database selection', () => {
  test('derives <name>_test from DATABASE_URL and keeps the rest', () => {
    const url = resolveTestDatabaseUrl({ DATABASE_URL: DEV });
    assert.equal(databaseName(url), 'mgportal_test');
    assert.match(url, /user=u;password=p;encrypt=true$/);
  });

  test('DATABASE_URL_TEST wins when it is a *_test database', () => {
    const own = 'sqlserver://other:1433;database=ci_test;user=u;password=p';
    assert.equal(resolveTestDatabaseUrl({ DATABASE_URL: DEV, DATABASE_URL_TEST: own }), own);
  });

  test('refuses a test URL that is not named *_test or is the dev database', () => {
    assert.throws(() => resolveTestDatabaseUrl({ DATABASE_URL: DEV, DATABASE_URL_TEST: DEV }));
    const odd = DEV.replace('mgportal', 'staging');
    assert.throws(() => resolveTestDatabaseUrl({ DATABASE_URL: DEV, DATABASE_URL_TEST: odd }));
  });

  test('nothing configured means no test database', () => {
    assert.equal(resolveTestDatabaseUrl({}), null);
  });

  test('under test the process uses the test database, never the development one', () => {
    if (!env.hasDatabase) return;
    assert.match(databaseName(process.env.DATABASE_URL), /_test$/i);
  });
});
