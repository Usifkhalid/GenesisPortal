/**
 * prepare-test-db.js — gets the test database ready: created when missing,
 * migrated, emptied, and (with --seed) seeded with the development users that
 * mock sign-in lists. Run by `npm test` (pretest) and before the e2e server.
 *
 * It only ever touches the database named by DATABASE_URL_TEST, or
 * DATABASE_URL's name plus `_test` (config/test-db.js). With no database
 * configured it does nothing: tests then run on the in-memory stores.
 */

import { fileURLToPath } from 'node:url';

import '../src/config/env.js';
import { resolveTestDatabaseUrl } from '../src/config/test-db.js';
import { cleanTestDatabase, ensureDatabase, migrateDeploy } from './db-admin.js';

/** @param {{ seed?: boolean }} [options] */
export async function prepareTestDatabase({ seed = false } = {}) {
  const url = resolveTestDatabaseUrl(process.env);
  if (!url || url.includes('CHANGE_ME')) {
    console.log('test database: none configured, tests use memory.');
    return null;
  }

  const created = await ensureDatabase(url);
  migrateDeploy(url);
  await cleanTestDatabase(url);

  if (seed) {
    // seed() goes through lib/prisma.js, which reads DATABASE_URL.
    process.env.DATABASE_URL = url;
    const [{ getPrisma, disconnectPrisma }, { seed: runSeed }] = await Promise.all([
      import('../src/lib/prisma.js'),
      import('../prisma/seed.js'),
    ]);
    try {
      await runSeed(await getPrisma());
    } finally {
      await disconnectPrisma();
    }
  }

  const done = `${created ? 'created, ' : ''}migrated, cleaned${seed ? ', seeded' : ''}`;
  console.log(`test database: ${done}.`);
  return url;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await prepareTestDatabase({ seed: process.argv.includes('--seed') });
  } catch (err) {
    console.error(`test database: ${err.message}`);
    process.exitCode = 1;
  }
}
