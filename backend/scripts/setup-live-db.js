/**
 * setup-live-db.js — `npm run db:live:setup`: makes the live database
 * (PORTAL_DATA=live, "<name>_live", e.g. mgportal_live) ready for the real
 * tenant: created when missing, migrated, given the companies with their
 * mail domains, and given the IT helpdesk's reference data (the IT team, its
 * hours, SLA targets, categories, canned replies, locations, holidays: the same
 * as the demo seed, see modules/tickets/defaults.js). Nothing else: no
 * departments, no fake people or tickets, no rooms, no announcements. People
 * arrive only through the directory sync and Entra sign-in. Safe to run again:
 * it adds what is missing and never deletes or edits.
 *
 *   npm run db:live:setup
 *   npm run db:live:setup -- --domain HLD=example.com   a company's real domain
 *   npm run db:live:setup -- --it-leads a@x.com,b@x.com --it-members c@x.com
 *
 * `--it-leads` / `--it-members` put existing active users on the IT team (it
 * adds or changes a role, never removes). An email that is not an active user
 * refuses the whole run before anything is written. Output is counts only.
 *
 * Refuses unless PORTAL_DATA=live, NODE_ENV is development and the server is
 * on this machine. Prints the database name, never the connection string.
 */

import { fileURLToPath } from 'node:url';

import { databaseName } from '../src/config/test-db.js';
import { ensureDatabase, isLocalHost, migrateDeploy } from './db-admin.js';

const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * The companies the live database starts with: seed-data.js's, with any
 * `--domain CODE=domain` applied. A placeholder ".example" domain is left out
 * of the result's `ready` list so the caller can say so. Pure, for tests.
 * @param {{ code: string, domain: string }[]} companies
 * @param {string[]} args
 */
export function liveCompanies(companies, args) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--domain') values.push(args[++i]);
    else if (args[i].startsWith('--domain=')) values.push(args[i].slice('--domain='.length));
  }
  const overrides = new Map();
  for (const value of values) {
    const [code, domain] = String(value ?? '').split('=');
    const lower = String(domain ?? '')
      .trim()
      .toLowerCase();
    if (!code || !DOMAIN.test(lower)) throw new Error(`Bad --domain value: ${value}`);
    overrides.set(code.trim().toUpperCase(), lower);
  }
  for (const code of overrides.keys()) {
    if (!companies.some((c) => c.code === code)) throw new Error(`No company ${code}.`);
  }
  const list = companies.map((c) => ({ ...c, domain: overrides.get(c.code) ?? c.domain }));
  return {
    list,
    overridden: [...overrides.keys()],
    placeholders: list.filter((c) => c.domain.endsWith('.example')),
  };
}

async function main(args) {
  const { env } = await import('../src/config/env.js');
  if (env.PORTAL_DATA !== 'live') {
    throw new Error('Set PORTAL_DATA=live in .env first: this sets up the live database only.');
  }
  if (env.NODE_ENV !== 'development') throw new Error('Only on a development machine.');
  if (!env.hasDatabase) throw new Error('DATABASE_URL is not configured.');

  const url = process.env.DATABASE_URL;
  const name = databaseName(url);
  if (!/_live$/i.test(name ?? '')) throw new Error('The live database name must end in _live.');
  if (!isLocalHost(url))
    throw new Error('Refusing: the database server is not on this machine.');

  const { COMPANIES } = await import('../prisma/seed-data.js');
  const { list, overridden, placeholders } = liveCompanies(COMPANIES, args);
  const [{ ensureHelpdeskDefaults }, { parseTeamArgs, setItMembers }] = await Promise.all([
    import('../src/modules/tickets/defaults.js'),
    import('../src/modules/tickets/team-members.js'),
  ]);
  const team = parseTeamArgs(args);

  const created = await ensureDatabase(url);
  migrateDeploy(url);

  const [{ getPrisma, disconnectPrisma }, { seedCompanies }] = await Promise.all([
    import('../src/lib/prisma.js'),
    import('../prisma/seed.js'),
  ]);
  try {
    const db = await getPrisma();
    const ids = await seedCompanies(db, list);
    // A real domain given now replaces the placeholder an earlier run stored.
    for (const code of overridden) {
      await db.companyDomain.deleteMany({
        where: { companyId: ids.get(code), domain: { endsWith: '.example' } },
      });
    }
    const helpdesk = await ensureHelpdeskDefaults(db);
    const members =
      team.leads || team.members
        ? await setItMembers(db, { teamId: helpdesk.teamId, ...team })
        : null;
    const [companies, departments, people, itLeads, itAgents] = await Promise.all([
      db.company.findMany({ select: { code: true, domains: { select: { domain: true } } } }),
      db.department.count(),
      db.userProfile.count(),
      db.supportTeamMember.count({ where: { teamId: helpdesk.teamId, role: 'Lead' } }),
      db.supportTeamMember.count({ where: { teamId: helpdesk.teamId, role: 'Agent' } }),
    ]);
    console.log(`Live database "${name}": ${created ? 'created, ' : ''}migrated.`);
    for (const c of companies) {
      console.log(`  ${c.code.padEnd(5)} ${c.domains.map((d) => d.domain).join(', ')}`);
    }
    console.log(`  ${departments} departments, ${people} people.`);
    const added = Object.values(helpdesk.created).reduce((a, b) => a + b, 0);
    console.log(
      `  IT helpdesk: ${added} default rows added (${helpdesk.created.team ? 'team created' : 'team existed'}).`
    );
    if (members) {
      console.log(
        `  IT team members: ${members.added} added, ${members.changed} role changed, ${members.unchanged} unchanged.`
      );
    }
    console.log(`  IT team now: ${itLeads} leads, ${itAgents} agents.`);
    if (!itLeads) {
      console.log('Note: the IT team has no lead yet. Run again with --it-leads <email>.');
    }
    for (const c of placeholders) {
      console.log(
        `Note: ${c.code} still has the placeholder domain ${c.domain}. ` +
          `Run again with --domain ${c.code}=<real domain>.`
      );
    }
  } finally {
    await disconnectPrisma();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main(process.argv.slice(2));
  } catch (err) {
    console.error(`db:live:setup: ${err.message}`);
    process.exitCode = 1;
  }
}
