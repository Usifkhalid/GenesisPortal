/**
 * db-admin.js — creating, migrating, emptying and dropping SQL Server
 * databases, for the test-database and reset scripts. Never imported by the
 * server.
 *
 * The only raw SQL in the project lives here: DDL that Prisma cannot express,
 * built from a database name that is checked against a strict pattern and,
 * for the destructive calls, from table names read out of the catalogue.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { databaseName, withDatabase } from '../src/config/test-db.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PRISMA_CLI = fileURLToPath(
  new URL('../../node_modules/prisma/build/index.js', import.meta.url)
);
const SCHEMA = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));

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
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasourceUrl: withDatabase(url, 'master') });
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

/** Creates the database when it is missing. @returns {Promise<boolean>} true when created */
export async function ensureDatabase(url) {
  const name = assertName(databaseName(url));
  return withMaster(url, async (db) => {
    if (await exists(db, name)) return false;
    await db.$executeRawUnsafe(`CREATE DATABASE [${name}]`);
    return true;
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
  });
}

/** Applies every pending migration to the database at `url`. */
export function migrateDeploy(url) {
  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy', '--schema', SCHEMA], {
    cwd: ROOT,
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

  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
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
