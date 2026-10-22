/**
 * reset-db.js — `npm run db:reset`: drops and recreates the DEVELOPMENT
 * database, applies every migration and seeds it. Everything in it is lost.
 *
 * Refuses unless NODE_ENV is development (the default when unset), the server
 * is on this machine, and the database is not a test one.
 */

import { runtime } from '../config/runtime.js';
import { databaseName } from '../config/test-db.js';
import { isLocalHost, migrateDeploy, recreateDatabase } from '../db/db-admin.js';

const refuse = (mode) => {
  throw new Error(`Refusing to reset: NODE_ENV is ${mode}, not development.`);
};

async function main() {
  const { env, dataVar } = runtime();
  if (env.NODE_ENV !== 'development') refuse(env.NODE_ENV);
  if (!env.hasDatabase) throw new Error('DATABASE_URL is not configured.');
  // The live database holds real people and is never wiped or filled with fakes.
  if (env[dataVar] === 'live') {
    throw new Error(
      `Refusing to reset the live database (${dataVar}=live). Use ${dataVar}=demo.`
    );
  }

  const url = env.DATABASE_URL;
  const name = databaseName(url);
  if (!name) throw new Error('DATABASE_URL has no database= part.');
  if (!isLocalHost(url)) {
    throw new Error('Refusing to reset a database that is not on this machine.');
  }

  console.log(`Resetting database "${name}"...`);
  await recreateDatabase(url);
  migrateDeploy(url);

  const [{ getPrisma, disconnectPrisma }, seed] = await Promise.all([
    import('../lib/prisma.js'),
    runtime().seed(),
  ]);
  try {
    const counts = await seed(await getPrisma());
    console.log(
      `Reset done: ${counts.companies} companies, ${counts.departments} departments, ${counts.users} users.`
    );
  } finally {
    await disconnectPrisma();
  }
}

/**
 * The command line. `loadApp` imports the app's config/env.js: only after
 * this check, since a production environment would fail its own validation
 * there, with a less useful message.
 * @param {() => Promise<unknown>} loadApp
 */
export async function cli(loadApp) {
  try {
    if ((process.env.NODE_ENV ?? 'development') !== 'development') refuse(process.env.NODE_ENV);
    await loadApp();
    await main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
