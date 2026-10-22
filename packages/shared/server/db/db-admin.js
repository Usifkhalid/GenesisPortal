/**
 * db-admin.js — creating, migrating, emptying and dropping SQL Server
 * databases, for each app's test-database, reset and live-setup scripts.
 * Never imported by a server. The app's config/env.js is imported first: the
 * clients made here are that app's (config/runtime.js), and the migrations
 * applied are those of the schema the script names.
 *
 * The only raw SQL in the project lives here: DDL that Prisma cannot express,
 * built from a database name that is checked against a strict pattern and,
 * for the destructive calls, from table names read out of the catalogue.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { dirname } from 'node:path';

import { databaseName, withDatabase } from '../config/test-db.js';
import { runtime } from '../config/runtime.js';

/** The Prisma CLI, installed once at the repository's root. */
const PRISMA_CLI = fileURLToPath(
  new URL('../../../../node_modules/prisma/build/index.js', import.meta.url)
);

/** A client of the running app's own generated Prisma client. */
async function clientFor(url) {
  const PrismaClient = await runtime().prismaClient();
  return new PrismaClient({ datasourceUrl: url });
}

const IDENTIFIER = /^[A-Za-z0-9_]{1,100}$/;

function assertName(name) {
  if (!IDENTIFIER.test(name ?? '')) throw new Error('Unsafe database name.');
  return name;
}

/** `host:port` of a sqlserver:// URL, for the locality check. */
export function hostOf(url) {
  const match = /^sqlserver:\/\/([^;]+)/i.exec(url ?? '');
  return match ? match[1] : null;
}

export function isLocalHost(url) {
  const host = (hostOf(url) ?? '').split(':')[0].toLowerCase();
  return ['localhost', '127.0.0.1', '::1', '(local)', '.'].includes(host);
}

/** Runs `fn` with a client on the server's master database. */
async function withMaster(url, fn) {
  const client = await clientFor(withDatabase(url, 'master'));
  try {
    return await fn(client);
  } finally {
    await client.$disconnect();
  }
}

async function exists(db, name) {
  const rows = await db.$queryRawUnsafe(`SELECT DB_ID(N'${name}') AS id`);
  return rows[0]?.id != null;
}

/**
 * Turns READ_COMMITTED_SNAPSHOT on, as Azure SQL has it by default: a reader
 * sees the last committed row instead of waiting on a writer's lock. Without
 * it a local database deadlocks readers against the directory sync, which
 * production never would (docs/DECISIONS.md D85). Changing it closes the
 * database's other connections, so it is done only when it is off.
 * @returns {Promise<boolean>} true when it had to be switched on
 */
async function ensureRowVersioning(db, name) {
  const rows = await db.$queryRawUnsafe(
    `SELECT is_read_committed_snapshot_on AS isOn FROM sys.databases WHERE name = N'${name}'`
  );
  if (rows[0]?.isOn) return false;
  await db.$executeRawUnsafe(
    `ALTER DATABASE [${name}] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE`
  );
  return true;
}

/** Whether the database `url` names exists on its server. Changes nothing. */
export async function databaseExists(url) {
  const name = assertName(databaseName(url));
  return withMaster(url, (db) => exists(db, name));
}

/**
 * Creates the database when it is missing, and makes sure it reads by row
 * version. @returns {Promise<boolean>} true when created
 */
export async function ensureDatabase(url) {
  const name = assertName(databaseName(url));
  return withMaster(url, async (db) => {
    const missing = !(await exists(db, name));
    if (missing) await db.$executeRawUnsafe(`CREATE DATABASE [${name}]`);
    await ensureRowVersioning(db, name);
    return missing;
  });
}

/** Drops the database (closing every connection to it first), then creates it empty. */
export async function recreateDatabase(url) {
  const name = assertName(databaseName(url));
  await withMaster(url, async (db) => {
    if (await exists(db, name)) {
      await db.$executeRawUnsafe(
        `ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`
      );
      await db.$executeRawUnsafe(`DROP DATABASE [${name}]`);
    }
    await db.$executeRawUnsafe(`CREATE DATABASE [${name}]`);
    await ensureRowVersioning(db, name);
  });
}

/**
 * Applies every pending migration of `schema` (an app's schema.prisma; the
 * running app's by default) to the database at `url`.
 */
export function migrateDeploy(url, schema = runtime().prismaSchema) {
  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy', '--schema', schema], {
    cwd: dirname(schema),
    env: { ...process.env, DATABASE_URL: url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Empties every table of a TEST database. AuditLog is append-only by trigger,
 * so the trigger is switched off for the delete and back on straight after.
 * Refuses any database whose name does not end in `_test`.
 */
export async function cleanTestDatabase(url) {
  const name = assertName(databaseName(url));
  if (!/_test$/i.test(name)) throw new Error('Refusing to empty a database not named *_test.');

  const db = await clientFor(url);
  try {
    const rows = await db.$queryRawUnsafe(
      `SELECT name FROM sys.tables WHERE name <> '_prisma_migrations' AND is_ms_shipped = 0`
    );
    const tables = rows.map((r) => r.name).filter((t) => IDENTIFIER.test(t));
    const hasAudit = tables.includes('AuditLog');

    for (const t of tables) {
      await db.$executeRawUnsafe(`ALTER TABLE [${t}] NOCHECK CONSTRAINT ALL`);
    }
    if (hasAudit) await db.$executeRawUnsafe('DISABLE TRIGGER ALL ON [AuditLog]');
    try {
      for (const t of tables) await db.$executeRawUnsafe(`DELETE FROM [${t}]`);
    } finally {
      if (hasAudit) await db.$executeRawUnsafe('ENABLE TRIGGER ALL ON [AuditLog]');
      for (const t of tables) {
        await db.$executeRawUnsafe(`ALTER TABLE [${t}] WITH CHECK CHECK CONSTRAINT ALL`);
      }
    }
  } finally {
    await db.$disconnect();
  }
}
