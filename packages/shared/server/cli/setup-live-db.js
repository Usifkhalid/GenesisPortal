/**
 * setup-live-db.js — the portal's `npm run db:live:setup` and the helpdesk's
 * `npm run db:setup-live`: makes the app's live database (PORTAL_DATA=live
 * or HELPDESK_DATA=live: "<name>_live", e.g. mgportal_live, mghelpdesk_live)
 * ready for the real
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
 * Refuses unless the app's data is live, NODE_ENV is development and the server is
 * on this machine. Prints the database name, never the connection string.
 */

import { runtime } from '../config/runtime.js';
import { databaseName } from '../config/test-db.js';
import { ensureDatabase, isLocalHost, migrateDeploy } from '../db/db-admin.js';

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

/**
 * @param {string[]} args
 * @param {object} [hooks]  the helpdesk's, once the portal's data was copied in (D145):
 *   companiesFromPortal(db) → true: companies already here keep their names and
 *     domains (only missing ones are added; --domain still sets one)
 *   settingsFromPortal(db) → true: say so; ensureDefaults then adds none
 *   ensureDefaults(db)  replaces ensureHelpdeskDefaults
 */
async function main(args, hooks = {}) {
  const { env, dataVar } = runtime();
  if (env[dataVar] !== 'live') {
    throw new Error(`Set ${dataVar}=live in .env first: this sets up the live database only.`);
  }
  if (env.NODE_ENV !== 'development') throw new Error('Only on a development machine.');
  if (!env.hasDatabase) throw new Error('DATABASE_URL is not configured.');

  const url = process.env.DATABASE_URL;
  const name = databaseName(url);
  if (!/_live$/i.test(name ?? '')) throw new Error('The live database name must end in _live.');
  if (!isLocalHost(url))
    throw new Error('Refusing: the database server is not on this machine.');

  const { COMPANIES } = await import('../demo/seed-data.js');
  const { list, overridden, placeholders } = liveCompanies(COMPANIES, args);
  const [{ ensureHelpdeskDefaults }, { parseTeamArgs, setItMembers }] = await Promise.all([
    import('../modules/tickets/defaults.js'),
    import('../modules/tickets/team-members.js'),
  ]);
  const team = parseTeamArgs(args);

  const created = await ensureDatabase(url);
  migrateDeploy(url);

  const [{ getPrisma, disconnectPrisma }, { seedCompanies }] = await Promise.all([
    import('../lib/prisma.js'),
    import('../demo/seed.js'),
  ]);
  try {
    const db = await getPrisma();
    const keepCompanies = Boolean(await hooks.companiesFromPortal?.(db));
    const ids = keepCompanies
      ? await addMissingCompanies(db, list, overridden, seedCompanies)
      : await seedCompanies(db, list);
    // A real domain given now replaces the placeholder an earlier run stored.
    for (const code of overridden) {
      await db.companyDomain.deleteMany({
        where: { companyId: ids.get(code), domain: { endsWith: '.example' } },
      });
    }
    const fromPortal = Boolean(await hooks.settingsFromPortal?.(db));
    const helpdesk = await (hooks.ensureDefaults ?? ensureHelpdeskDefaults)(db);
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
      fromPortal
        ? '  IT helpdesk: team and settings came from the portal; no defaults added.'
        : `  IT helpdesk: ${added} default rows added (${helpdesk.created.team ? 'team created' : 'team existed'}).`
    );
    if (keepCompanies) console.log('  Companies came from the portal: kept as they are.');
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

/**
 * Companies missing by code are created; those already here are left alone,
 * except a --domain given for one, which becomes its main domain.
 */
async function addMissingCompanies(db, list, overridden, seedCompanies) {
  const present = new Map(
    (await db.company.findMany({ select: { id: true, code: true } })).map((c) => [c.code, c.id])
  );
  const made = await seedCompanies(
    db,
    list.filter((c) => !present.has(c.code))
  );
  const ids = new Map([...present, ...made]);
  for (const code of overridden.filter((c) => present.has(c))) {
    const { domain } = list.find((c) => c.code === code);
    const companyId = ids.get(code);
    await db.companyDomain.upsert({
      where: { domain },
      update: { companyId },
      create: { companyId, domain },
    });
    await db.company.update({ where: { id: companyId }, data: { domain } });
  }
  return ids;
}

/**
 * The command line: the app's script calls this after importing its env.js.
 * @param {string} name  the npm script, for messages
 * @param {string[]} [args]
 * @param {object} [hooks]  see main()
 */
export async function cli(name, args = process.argv.slice(2), hooks = {}) {
  try {
    await main(args, hooks);
  } catch (err) {
    console.error(`${name}: ${err.message}`);
    process.exitCode = 1;
  }
}
