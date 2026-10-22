/**
 * migrate-deploy.js — applies the running app's pending migrations:
 * `npm run db:deploy` in either app.
 *
 * This is the deploy step that changes the schema; the app never does (its
 * database login cannot). It connects as the migration login when
 * MIGRATE_DATABASE_URL is set, otherwise as DATABASE_URL (a developer's
 * machine, where one login does both). See docs/DEPLOY.md.
 *
 * `prisma migrate deploy` only ever applies the migration files in the
 * repository, in order; it never resets or generates anything.
 */

import { migrateDeploy } from '../db/db-admin.js';

/** The command line: the app's script calls this after importing its env.js. */
export function cli() {
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url || url.includes('CHANGE_ME')) {
    console.error('db:deploy: set MIGRATE_DATABASE_URL (or DATABASE_URL) first.');
    process.exit(1);
  }

  try {
    migrateDeploy(url);
    console.log('db:deploy: migrations are up to date.');
  } catch (err) {
    // Prisma's own output names the migration; the connection string is never printed.
    console.error('db:deploy: failed.');
    console.error(String(err.stderr ?? err.message).replaceAll(url, '<connection string>'));
    process.exit(1);
  }
}
