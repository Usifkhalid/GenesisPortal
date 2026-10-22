/**
 * import-hr.js — `npm run import:hr` (portal and helpdesk alike): HR's staff
 * list into the live app's people (modules/directory/hr-import.js, D140).
 * Each app's backend/scripts/import-hr.js imports its config/env.js and calls
 * cli(); the company and department rules are the same for both.
 *
 *   npm run import:hr -- --as you@company.eg --dry-run   plan and report only
 *   npm run import:hr -- --as you@company.eg             write the changes
 *
 * Reads private/hr-people.csv, private/hr-departments.csv and, when present,
 * private/hr-matches.csv (staff_id,email: matches made by hand). `--dir <path>`
 * reads them from elsewhere. Only with PORTAL_DATA=live (HELPDESK_DATA=live), only for an active
 * HoldingAdmin (`--as`), and every change is audited under their name.
 *
 * Prints counts only, never a name or staff id. The details, with a reason
 * per row, go to reports/hr-import-<Cairo date>.csv (git-ignored).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runtime } from '../config/runtime.js';

/** @param {string[]} args */
export function parseArgs(args) {
  const out = { dryRun: false, as: null, dir: null };
  for (let i = 0; i < args.length; i += 1) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    const value = () => inline ?? args[++i];
    if (flag === '--dry-run') out.dryRun = true;
    else if (flag === '--as') out.as = value();
    else if (flag === '--dir') out.dir = value();
    else throw new Error(`Unknown option ${args[i]}.`);
  }
  return out;
}

/** "2026-10-19": the day in Cairo, for the report's name. */
export const cairoDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(date);

/** The counts table. Pure, for tests: no names, no staff ids. */
export function summary(plan, { invalid = [], dryRun = false, reportPath = '' } = {}) {
  const cols = [
    ['matched', 'matched'],
    ['changed', 'changed'],
    ['ambiguous', 'ambiguous'],
    ['unmatched', 'no account'],
    ['notInHr', 'not in HR'],
    ['pending', 'pending co.'],
    ['skipped', 'unknown co.'],
    ['departmentsCreated', 'depts new'],
  ];
  const codes = Object.keys(plan.counts).sort();
  const total = Object.fromEntries(
    cols.map(([key]) => [key, codes.reduce((n, c) => n + plan.counts[c][key], 0)])
  );
  const row = (label, c) =>
    label.padEnd(16) +
    cols.map(([key, head]) => String(c[key]).padStart(head.length + 2)).join('');
  const lines = [
    dryRun ? 'HR import, dry run (nothing written):' : 'HR import, written:',
    ''.padEnd(16) + cols.map(([, head]) => head.padStart(head.length + 2)).join(''),
    ...codes.map((code) => row(code, plan.counts[code])),
    row('total', total),
    '',
    `Rows refused as invalid: ${invalid.length}`,
    'matched = HR rows tied to one portal account; no account = HR rows with no Microsoft account;',
    'not in HR = active portal accounts HR does not list; pending co. = companies not added yet.',
  ];
  if (reportPath) lines.push(`Details (names, reasons): ${reportPath}`);
  return lines.join('\n');
}

async function main(args) {
  const options = parseArgs(args);
  const { env, repoRoot: ROOT, dataVar } = runtime();
  const { databaseName } = await import('../config/test-db.js');
  if (!env.hasDatabase) throw new Error('DATABASE_URL is not configured.');
  const name = databaseName(process.env.DATABASE_URL);
  if (
    env[dataVar] === 'live' &&
    env.NODE_ENV === 'development' &&
    !/_live$/i.test(name ?? '')
  ) {
    throw new Error(`${dataVar}=live but the database is not a *_live one.`);
  }
  console.log(`HR import: data ${env[dataVar]}, database "${name}".`);

  const dir = options.dir ?? join(ROOT, 'private');
  const read = (file, required = true) => {
    const path = join(dir, file);
    if (!existsSync(path)) {
      if (required) throw new Error(`Missing ${path}.`);
      return null;
    }
    return readFileSync(path, 'utf8');
  };

  const [{ runHrImport, reportCsv }, { createPrismaDirectoryStore }, prismaLib] =
    await Promise.all([
      import('../modules/directory/hr-import.js'),
      import('../modules/directory/store-prisma.js'),
      import('../lib/prisma.js'),
    ]);
  try {
    const files = {
      people: env[dataVar] === 'live' ? read('hr-people.csv') : '',
      departments: env[dataVar] === 'live' ? read('hr-departments.csv') : '',
      matches: env[dataVar] === 'live' ? read('hr-matches.csv', false) : null,
    };
    const { plan, invalid } = await runHrImport({
      portalData: env[dataVar],
      dataVar,
      store: createPrismaDirectoryStore(),
      files,
      asEmail: options.as,
      dryRun: options.dryRun,
    });

    const reports = join(ROOT, 'reports');
    mkdirSync(reports, { recursive: true });
    const reportPath = join(reports, `hr-import-${cairoDate()}.csv`);
    writeFileSync(reportPath, reportCsv(plan.report));
    console.log(summary(plan, { invalid, dryRun: options.dryRun, reportPath }));
    return 0;
  } finally {
    await prismaLib.disconnectPrisma();
  }
}

/** The command line: the app's script calls this after importing its env.js. */
export async function cli(args = process.argv.slice(2)) {
  try {
    process.exitCode = await main(args);
  } catch (err) {
    console.error(`import:hr: ${err.message}`);
    process.exitCode = 1;
  }
}
