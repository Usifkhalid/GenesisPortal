/**
 * migrate-from-portal.js — `npm run migrate:from-portal -- --as <email>`: the
 * portal's IT helpdesk (tickets, the IT team and its settings, the people,
 * their ticket notifications, attachments, the ticket audit trail) copied
 * into the helpdesk's live database (D145; the rules are
 * backend/src/modules/migration/from-portal.js).
 *
 *   npm run migrate:from-portal -- --as you@x.com --dry-run   counts per table and company, nothing written
 *   npm run migrate:from-portal -- --as you@x.com             create + migrate mghelpdesk_live, copy, check
 *   npm run migrate:from-portal -- --as you@x.com --verify    the check again, nothing written
 *   ... --force-merge   allow tickets in mghelpdesk_live that did not come from the portal
 *
 * Reads the portal's database at PORTAL_SOURCE_DATABASE_URL (read-only: every
 * write is refused before it is sent) and its files at PORTAL_SOURCE_STORAGE_DIR
 * (default <repo>/storage). Writes only mghelpdesk_live and the helpdesk's own
 * storage. Only with HELPDESK_DATA=live, NODE_ENV=development and SQL Server on
 * this machine, like db:setup-live. The --as person must be an active
 * holding-wide HoldingAdmin of the portal; they become the helpdesk's first
 * administrator and the run is audited under them.
 *
 * The report (counts, warnings, the check) goes to the terminal and to
 * reports/helpdesk-migration-<Cairo date and time>.json (git-ignored). Prints
 * database names, never a connection string. Exit code 1 when refused or
 * when the check fails.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ROOT, env } from '../src/config/env.js';
import {
  emptyTarget,
  migrateFromPortal,
  verifyMigration,
} from '../src/modules/migration/from-portal.js';
import { readOnly, readOnlyFiles } from '../src/modules/migration/source.js';
import { formatSummary } from '../src/modules/migration/summary.js';
import { runtime } from '@mg/shared/server/config/runtime.js';
import { databaseName } from '@mg/shared/server/config/test-db.js';
import {
  databaseExists,
  ensureDatabase,
  isLocalHost,
  migrateDeploy,
} from '@mg/shared/server/db/db-admin.js';
import { createLocalStorage, defaultStorage } from '@mg/shared/server/lib/storage.js';

/** @param {string[]} args */
function parseArgs(args) {
  const out = { as: null, dryRun: false, verify: false, forceMerge: false };
  for (let i = 0; i < args.length; i += 1) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    if (flag === '--as') out.as = inline ?? args[++i];
    else if (flag === '--dry-run') out.dryRun = true;
    else if (flag === '--verify') out.verify = true;
    else if (flag === '--force-merge') out.forceMerge = true;
    else throw new Error(`Unknown option ${args[i]}.`);
  }
  if (!out.as)
    throw new Error('Name yourself with --as <email> (a HoldingAdmin of the portal).');
  return out;
}

const stamp = (date = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'short',
    timeStyle: 'medium',
  })
    .format(date)
    .replace(' ', 'T')
    .replaceAll(':', '-');

async function main(args) {
  const options = parseArgs(args);
  const writes = !options.dryRun && !options.verify;

  if (env.HELPDESK_DATA !== 'live') {
    throw new Error(
      'Set HELPDESK_DATA=live in apps/helpdesk/.env first: this fills the live database.'
    );
  }
  if (env.NODE_ENV !== 'development') throw new Error('Only on a development machine.');
  if (!env.hasDatabase) throw new Error('DATABASE_URL is not configured.');
  const url = process.env.DATABASE_URL;
  const name = databaseName(url);
  if (!/_live$/i.test(name ?? '')) throw new Error('The live database name must end in _live.');
  if (!isLocalHost(url))
    throw new Error('Refusing: the database server is not on this machine.');

  const sourceUrl = env.PORTAL_SOURCE_DATABASE_URL;
  if (!sourceUrl || sourceUrl.includes('CHANGE_ME')) {
    throw new Error(
      'Set PORTAL_SOURCE_DATABASE_URL in apps/helpdesk/.env (the portal’s live database).'
    );
  }
  const sourceName = databaseName(sourceUrl);
  if (!sourceName) throw new Error('PORTAL_SOURCE_DATABASE_URL names no database.');
  if (sourceName.toLowerCase() === name.toLowerCase()) {
    throw new Error('PORTAL_SOURCE_DATABASE_URL is the helpdesk’s own database.');
  }
  if (/helpdesk/i.test(sourceName)) {
    throw new Error('PORTAL_SOURCE_DATABASE_URL names a helpdesk database, not the portal’s.');
  }
  console.log(`Portal (read-only): "${sourceName}"  →  helpdesk: "${name}"`);

  let created = false;
  const exists = await databaseExists(url);
  if (writes) {
    created = await ensureDatabase(url);
    migrateDeploy(url);
    console.log(`Helpdesk database "${name}": ${created ? 'created, ' : ''}migrated.`);
  } else if (!exists) {
    console.log(`Helpdesk database "${name}" does not exist yet: planned as empty.`);
  }

  const PrismaClient = await runtime().prismaClient();
  const portal = new PrismaClient({ datasourceUrl: sourceUrl });
  const source = readOnly(portal);
  const { getPrisma, disconnectPrisma } = await import('@mg/shared/server/lib/prisma.js');
  try {
    const target = exists || writes ? await getPrisma() : emptyTarget();
    const files = {
      sourceFiles: readOnlyFiles(
        createLocalStorage(resolve(ROOT, env.PORTAL_SOURCE_STORAGE_DIR ?? 'storage'))
      ),
      // The bytes go in as they are; their verdict is copied, not scanned again.
      targetFiles: defaultStorage(env),
    };
    const report = await migrateFromPortal({
      source,
      target,
      ...files,
      asEmail: options.as,
      dryRun: !writes,
      forceMerge: options.forceMerge,
    });
    if (writes || (options.verify && exists)) {
      report.verification = await verifyMigration({ source, target, ...files, report });
    }
    if (options.verify) report.verifyOnly = true;
    report.portalDatabase = sourceName;
    report.helpdeskDatabase = name;

    const reports = join(ROOT, 'reports');
    mkdirSync(reports, { recursive: true });
    const kind = writes ? '' : options.verify ? '-check' : '-dry-run';
    const reportPath = join(reports, `helpdesk-migration${kind}-${stamp()}.json`);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(formatSummary(report, { reportPath }));
    if (report.verification && !report.verification.ok) process.exitCode = 1;
  } finally {
    await portal.$disconnect();
    await disconnectPrisma();
  }
}

try {
  await main(process.argv.slice(2));
} catch (err) {
  // A refusal (MigrationRefused) says what to do; other errors name what failed.
  console.error(`migrate:from-portal: ${err.message}`);
  process.exitCode = 1;
}
