/**
 * sync-users.js — `npm run sync:users`: one directory sync from the command
 * line, the same run as Administration > Directory sync (jobs/syncUsers.js),
 * safety stops included, then a report: people per company and how many have
 * a manager, departments Entra names that the portal does not have (recorded,
 * never created), and people on mail domains no company owns.
 *
 *   npm run sync:users                 run it and write the changes
 *   npm run sync:users -- --dry-run    plan only, the database is not changed
 *   npm run sync:users -- --allow-large-deactivation
 *
 * It works on whatever database PORTAL_DATA selects and prints that database's
 * name, never the connection string.
 */

import { fileURLToPath } from 'node:url';

/**
 * The report, from the people the portal holds (or would hold) after the run.
 * Pure, for tests.
 * @param {object} input
 * @param {{ companyCode: string, isActive: boolean, hasManager: boolean }[]} input.people
 * @param {object[]} input.warnings
 * @param {string[]} input.companyCodes  every company, so one with nobody shows 0
 */
export function syncReport({ people, warnings, companyCodes }) {
  const perCompany = Object.fromEntries(
    companyCodes.map((code) => [code, { active: 0, withManager: 0 }])
  );
  for (const p of people) {
    if (!p.isActive) continue;
    perCompany[p.companyCode] ??= { active: 0, withManager: 0 };
    perCompany[p.companyCode].active += 1;
    if (p.hasManager) perCompany[p.companyCode].withManager += 1;
  }

  const unknownDomains = {};
  for (const w of warnings.filter((w) => w.code === 'unplaced_user')) {
    const domain = w.domain ?? '(none)';
    unknownDomains[domain] = (unknownDomains[domain] ?? 0) + 1;
  }

  const of = (code) => warnings.filter((w) => w.code === code);
  return {
    perCompany,
    withManager: Object.values(perCompany).reduce((n, c) => n + c.withManager, 0),
    active: Object.values(perCompany).reduce((n, c) => n + c.active, 0),
    unmatchedDepartments: of('unmatched_department').map(({ companyCode, name, count }) => ({
      companyCode,
      name,
      count,
    })),
    unknownDomains,
    unknownDomainPeople: Object.values(unknownDomains).reduce((n, c) => n + c, 0),
    guestsSkipped: of('guests_skipped').reduce((n, w) => n + w.count, 0),
    managerLookupsFailed: of('manager_lookup_failed').length,
    managersNotInPortal: of('manager_unresolved').length,
    stop: warnings.find((w) => ['graph_empty', 'deactivation_limit', 'error'].includes(w.code)),
  };
}

function print(report, { status, created, updated, deactivated, dryRun }) {
  const lines = [];
  lines.push(
    `${dryRun ? 'Dry run (nothing written)' : `Run ${status}`}: ` +
      `${created} created, ${updated} updated, ${deactivated} deactivated.`
  );
  if (report.stop) lines.push(`Stopped by a safety stop: ${JSON.stringify(report.stop)}`);
  lines.push('', 'Active people per company (with a manager):');
  for (const [code, c] of Object.entries(report.perCompany)) {
    lines.push(`  ${code.padEnd(5)} ${String(c.active).padStart(5)}  (${c.withManager})`);
  }
  lines.push(`  total ${String(report.active).padStart(5)}  (${report.withManager})`);
  lines.push(
    '',
    `Unmatched departments (recorded, not created): ${report.unmatchedDepartments.length}`
  );
  for (const d of report.unmatchedDepartments) {
    lines.push(`  ${d.companyCode.padEnd(5)} ${d.name} (${d.count})`);
  }
  lines.push('', `People on unknown domains (not imported): ${report.unknownDomainPeople}`);
  for (const [domain, count] of Object.entries(report.unknownDomains).sort(
    (a, b) => b[1] - a[1]
  )) {
    lines.push(`  ${domain} (${count})`);
  }
  lines.push('', `Guest accounts skipped: ${report.guestsSkipped}`);
  lines.push(`Manager lookups failed: ${report.managerLookupsFailed}`);
  lines.push(`Managers outside the portal: ${report.managersNotInPortal}`);
  console.log(lines.join('\n'));
}

async function main(args) {
  const dryRun = args.includes('--dry-run');
  const allowLargeDeactivation = args.includes('--allow-large-deactivation');

  const { env } = await import('../src/config/env.js');
  const { databaseName } = await import('../src/config/test-db.js');
  if (!env.hasDatabase) throw new Error('DATABASE_URL is not configured.');
  console.log(
    `Directory sync: data ${env.PORTAL_DATA}, database "${databaseName(process.env.DATABASE_URL)}", ` +
      `directory ${env.GRAPH_DIRECTORY_MODE}.`
  );

  const [{ graph }, { createSyncRunner, fetchManagers, planSync }, store, prismaLib] =
    await Promise.all([
      import('../src/integrations/graph/index.js'),
      import('../src/jobs/syncUsers.js'),
      import('../src/modules/directory/store-prisma.js'),
      import('../src/lib/prisma.js'),
    ]);
  const directoryStore = store.createPrismaDirectoryStore();
  const db = await prismaLib.getPrisma();
  try {
    const companies = await db.company.findMany({ select: { id: true, code: true } });
    const companyCodes = companies.map((c) => c.code).sort();
    const codeOf = new Map(companies.map((c) => [c.id, c.code]));

    if (dryRun) {
      const client = await graph();
      const graphUsers = await client.listUsers();
      const lookupWarnings = [];
      const managerIds = await fetchManagers(client, graphUsers, lookupWarnings);
      const plan = planSync({
        graphUsers,
        managerIds: new Map([...managerIds].filter(([, v]) => v !== undefined)),
        state: await directoryStore.loadSyncState(),
        allowLargeDeactivation,
      });
      const linked = new Map(plan.managerLinks.map((l) => [l.entraObjectId, l]));
      const people = [...plan.creates.map((c) => c.data), ...plan.updates.map((u) => u.data)]
        .filter((d) => d.companyId)
        .map((d) => ({
          companyCode: codeOf.get(d.companyId),
          isActive: d.isActive,
          hasManager: Boolean(linked.get(d.entraObjectId)?.managerEntraObjectId),
        }));
      const warnings = [
        ...(plan.abort ? [plan.abort] : []),
        ...lookupWarnings,
        ...plan.warnings,
      ];
      print(syncReport({ people, warnings, companyCodes }), { ...plan.counts, dryRun });
      return plan.abort ? 2 : 0;
    }

    const runner = createSyncRunner({ store: directoryStore, getGraph: graph });
    const started = await runner.start({ source: 'manual', allowLargeDeactivation });
    await runner.idle();
    const run = await db.syncRun.findUnique({ where: { id: started.id } });
    const rows = await db.userProfile.findMany({
      select: { companyId: true, isActive: true, managerId: true },
    });
    const people = rows.map((r) => ({
      companyCode: codeOf.get(r.companyId),
      isActive: r.isActive,
      hasManager: Boolean(r.managerId),
    }));
    print(syncReport({ people, warnings: JSON.parse(run.warnings), companyCodes }), run);
    return run.status === 'success' ? 0 : 2;
  } finally {
    await prismaLib.disconnectPrisma();
  }
}

/** After a 403: which application permissions the app's token really holds. */
async function explainRefusal() {
  try {
    const { graph } = await import('../src/integrations/graph/index.js');
    const client = await graph();
    if (!client.applicationPermissions) return;
    const roles = await client.applicationPermissions();
    console.error(
      `The app's token holds these application permissions: ${roles.join(', ') || '(none)'}.
` +
        'Reading the directory needs User.Read.All as an Application permission (not Delegated), ' +
        'with "Grant admin consent" done in Entra > App registrations > API permissions.'
    );
  } catch (err) {
    console.error(`Could not read the app's permissions: ${err.message}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`sync:users: ${err.message}`);
    if (err.status === 403) await explainRefusal();
    process.exitCode = 1;
  }
}
