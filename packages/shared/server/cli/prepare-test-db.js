/**
 * prepare-test-db.js — gets the running app's test database ready: created when missing,
 * migrated, emptied, and (with --seed) seeded with the development users that
 * mock sign-in lists. Run by `npm test` (pretest) and before the e2e server.
 *
 * It only ever touches the database named by DATABASE_URL_TEST, or
 * DATABASE_URL's name plus `_test` (config/test-db.js). With no database
 * configured it does nothing: tests then run on the in-memory stores.
 */

import { runtime } from '../config/runtime.js';
import { resolveTestDatabaseUrl } from '../config/test-db.js';
import { cleanTestDatabase, ensureDatabase, migrateDeploy } from '../db/db-admin.js';

/** @param {{ seed?: boolean }} [options] */
export async function prepareTestDatabase({ seed = false } = {}) {
  // env.js may already have switched DATABASE_URL to the test database (the
  // e2e server's environment); resolving again would name "<name>_test_test".
  // cleanTestDatabase still refuses any name that does not end in _test.
  const url =
    process.env.TEST_DATABASE_ACTIVE === '1'
      ? process.env.DATABASE_URL
      : resolveTestDatabaseUrl(process.env);
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
    const [{ getPrisma, disconnectPrisma }, runSeed] = await Promise.all([
      import('../lib/prisma.js'),
      runtime().seed(),
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

/** The command line: the app's script calls this after importing its env.js. */
export async function cli(args = process.argv.slice(2)) {
  try {
    await prepareTestDatabase({ seed: args.includes('--seed') });
  } catch (err) {
    console.error(`test database: ${err.message}`);
    process.exitCode = 1;
  }
}
