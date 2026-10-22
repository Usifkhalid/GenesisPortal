/**
 * The portal's helpdesk moves into the helpdesk's database (D145,
 * src/modules/migration/from-portal.js), on fake data: a fake portal (arrays,
 * tests/helpers/portal-source.js) into a real SQL Server database of its own,
 * mghelpdesk_migrate_test, emptied before each test. Covers the dry run, the
 * copy and what it keeps (numbers, dates, the IT team and its settings, SLA
 * clocks, ratings, notes, history, attachments and their verdicts, unread and
 * keyed notifications, the audit trail), a second run, the ticket counter,
 * the refusals, the attachment check, the read-only portal, and that
 * db:setup-live, the directory sync and the HR import all work on top of it
 * without duplicates. Skipped when no database is set up.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';

import { env } from '../src/config/env.js';
import {
  MigrationRefused,
  emptyTarget,
  helpdeskLink,
  migrateFromPortal,
  verifyMigration,
} from '../src/modules/migration/from-portal.js';
import { readOnly, readOnlyFiles } from '../src/modules/migration/source.js';
import { formatSummary } from '../src/modules/migration/summary.js';
import {
  companiesFromPortal,
  ensureDefaults,
  settingsFromPortal,
} from '../src/modules/admin/defaults.js';
import { createArraySource, portalFixture } from './helpers/portal-source.js';
import { runtime } from '@mg/shared/server/config/runtime.js';
import { databaseName, withDatabase } from '@mg/shared/server/config/test-db.js';
import {
  cleanTestDatabase,
  ensureDatabase,
  migrateDeploy,
} from '@mg/shared/server/db/db-admin.js';
import { createSyncRunner } from '@mg/shared/server/jobs/syncUsers.js';
import { disconnectPrisma, getPrisma } from '@mg/shared/server/lib/prisma.js';
import { createMemoryStorage } from '@mg/shared/server/lib/storage.js';
import { runHrImport } from '@mg/shared/server/modules/directory/hr-import.js';
import { createPrismaDirectoryStore } from '@mg/shared/server/modules/directory/store-prisma.js';
import { ensureHelpdeskDefaults } from '@mg/shared/server/modules/tickets/defaults.js';
import { ticketNumber } from '@mg/shared/server/modules/tickets/rules.js';

const NOW = new Date('2026-10-22T10:00:00Z');

/** This file's own database: the other SQL Server tests use mghelpdesk_test at the same time. */
function migrationDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  const name = databaseName(url);
  if (!env.hasDatabase || !name || !/_test$/i.test(name)) return null;
  return withDatabase(url, name.replace(/_test$/i, '_migrate_test'));
}

async function prepare() {
  const url = migrationDatabaseUrl();
  if (!url) return { reason: 'no test database is configured' };
  try {
    await ensureDatabase(url);
    migrateDeploy(url);
    // The shared stores (sync, HR import) use the process's client: point it here.
    process.env.DATABASE_URL = url;
    return { url };
  } catch {
    return { reason: 'SQL Server is unreachable' };
  }
}

describe('migrate:from-portal (D145)', async () => {
  const { url, reason } = await prepare();
  let db;
  const skip = reason;

  before(async () => {
    if (!skip) db = await getPrisma();
  });
  beforeEach(async () => {
    if (!skip) await cleanTestDatabase(url);
  });
  after(async () => {
    await disconnectPrisma();
  });

  /** A fake portal and both file stores. */
  function world(change) {
    const fx = portalFixture();
    change?.(fx);
    const portalFiles = createMemoryStorage();
    for (const [key, bytes] of fx.files) portalFiles.files.set(key, bytes);
    const helpdeskFiles = createMemoryStorage();
    const options = {
      source: readOnly(createArraySource(fx.tables)),
      target: db,
      sourceFiles: readOnlyFiles(portalFiles),
      targetFiles: helpdeskFiles,
      asEmail: fx.users.admin.email,
      now: () => NOW,
    };
    const run = (extra = {}) => migrateFromPortal({ ...options, ...extra });
    const verify = (report) => verifyMigration({ ...options, report });
    return { fx, run, verify, portalFiles, helpdeskFiles, options };
  }

  test('a dry run counts per table and per company and writes nothing', { skip }, async () => {
    const w = world();
    const report = await w.run({ dryRun: true });
    const t = report.tables;

    assert.equal(report.dryRun, true);
    assert.deepEqual(t.Ticket.byCompany, { GEN: 1, MSR: 1, HLD: 1 });
    assert.equal(t.Ticket.created, 3);
    assert.equal(t.Company.created, 3);
    assert.equal(t.UserProfile.created, 9);
    assert.deepEqual(t.UserProfile.byCompany, { GEN: 4, HLD: 3, MSR: 2 });
    assert.equal(t.SupportTeamMember.created, 4);
    // Unread ones and keyed ones; not the read, unkeyed one, nor the booking's.
    assert.equal(t.Notification.source, 4);
    assert.equal(t.AuditLog.source, 2, 'ticket and IT-settings rows only');
    assert.equal(t.RoleAssignment.source, 10, 'User roles and the --as HoldingAdmin');
    assert.deepEqual(report.sequences, [
      { prefix: 'IT', year: 2026, last: 7 },
      { prefix: 'IT', year: 2025, last: 12 },
    ]);
    assert.match(formatSummary(report), /Dry run: nothing was written/);
    assert.match(formatSummary(report), /Ticket\s+3\s+3\s+0\s+0\s+0\s+GEN 1, HLD 1, MSR 1/);

    for (const model of ['company', 'userProfile', 'ticket', 'portalImport', 'auditLog']) {
      assert.equal(await db[model].count(), 0, `${model} untouched`);
    }
    assert.equal(w.helpdeskFiles.files.size, 0);
  });

  test('a dry run before mghelpdesk_live exists plans against nothing', async () => {
    const w = world();
    const report = await w.run({ dryRun: true, target: emptyTarget() });
    assert.equal(report.tables.Ticket.created, 3);
    assert.equal(
      report.copied,
      Object.values(report.tables).reduce((n, t) => n + t.created, 0)
    );
  });

  test('the real run copies everything as it was, and the check passes', { skip }, async () => {
    const w = world();
    const { fx } = w;
    const report = await w.run();
    const check = await w.verify(report);
    assert.deepEqual(check.problems, []);
    assert.equal(check.ok, true);
    assert.equal(check.checked.ticketNumbers, 3);
    assert.equal(check.checked.attachmentFiles, 3);

    // Tickets: same ids, numbers, dates, clocks, ratings and close reasons.
    const t1 = await db.ticket.findUnique({ where: { number: 'IT-2026-00005' } });
    assert.equal(t1.id, fx.ids.T1);
    assert.equal(t1.createdAt.toISOString(), '2026-10-19T10:00:00.000Z');
    assert.equal(t1.updatedAt.toISOString(), '2026-10-20T09:00:00.000Z');
    assert.equal(t1.rating, 5);
    assert.equal(t1.ratingFeedback, 'Quick, thank you.');
    assert.equal(t1.closeMode, 'confirmed');
    const t2 = await db.ticket.findUnique({ where: { number: 'IT-2026-00007' } });
    assert.equal(t2.status, 'Pending');
    assert.equal(t2.slaPausedMinutes, 30);
    assert.equal(t2.slaPausedAt.toISOString(), '2026-10-21T12:00:00.000Z');
    assert.equal(t2.source, 'phone');
    const t3 = await db.ticket.findUnique({ where: { number: 'IT-2025-00012' } });
    assert.equal(t3.closeReason, 'The requester left the company.');

    // Replies, internal notes, history.
    const notes = await db.ticketComment.findMany({ where: { ticketId: fx.ids.T1 } });
    assert.deepEqual(notes.map((c) => c.isInternal).sort(), [false, true]);
    assert.equal(await db.ticketEvent.count(), 5);

    // The IT team: the portal's three leads and agent, its hours, SLA and categories.
    const members = await db.supportTeamMember.findMany({});
    assert.equal(members.filter((m) => m.role === 'Lead').length, 3);
    assert.equal(members.filter((m) => m.role === 'Agent').length, 1);
    const calendar = await db.businessCalendar.findFirst({});
    assert.equal(calendar.startMin, 540);
    const p1 = await db.slaPolicy.findFirst({ where: { priority: 'P1' } });
    assert.equal(p1.firstResponseMinutes, 33);
    const categories = await db.ticketCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    assert.deepEqual(
      categories.map((c) => c.nameEn),
      ['Laptop / PC', 'Printers and scanning', 'Old category']
    );
    assert.equal(await db.holiday.count(), 1);
    assert.equal(await db.cannedReply.count(), 1);
    assert.equal(await db.ticketLocation.count(), 2);

    // People: everyone, HR's fields and staff id kept, managers set.
    assert.equal(await db.userProfile.count(), 9);
    const req1 = await db.userProfile.findUnique({ where: { email: fx.users.req1.email } });
    assert.equal(req1.id, fx.users.req1.id);
    assert.equal(req1.staffId, 'S100');
    assert.equal(req1.hrFields, 'departmentId,jobTitle');
    assert.equal(req1.departmentId, fx.ids.dept);
    assert.equal(req1.managerId, fx.users.lead3.id);
    assert.equal(req1.language, 'ar');
    // Roles: plain User roles, and the --as person as the helpdesk's administrator only.
    const admins = await db.roleAssignment.findMany({ where: { role: { not: 'User' } } });
    assert.deepEqual(
      admins.map((r) => [r.userId, r.role, r.scopeCompanyId]),
      [[fx.users.admin.id, 'HoldingAdmin', null]]
    );
    assert.equal(await db.companyDomain.count(), 4);

    // Notifications: unread and keyed only; IT's links are this app's.
    const copied = await db.notification.findMany({});
    assert.equal(copied.length, 4);
    assert.ok(copied.every((n) => n.templateKey.startsWith('ticket.')));
    const assigned = copied.find((n) => n.templateKey === 'ticket.assigned');
    assert.equal(JSON.parse(assigned.payload).link, `#tickets/${fx.ids.T2}`);
    assert.equal(
      copied.filter((n) => n.dedupeKey === `sla:${fx.ids.T2}:resolve:75`).length,
      2,
      'the alert already sent (bell and email) is on record, so it is never sent again'
    );
    assert.equal(await db.notificationPreference.count(), 1);

    // Attachments: the bytes with the same hash, the verdicts as they were.
    assert.deepEqual([...w.helpdeskFiles.files.keys()].sort(), [
      'ticket-a1.png',
      'ticket-a2.png',
      'ticket-a4.png',
    ]);
    const scans = new Map((await db.fileScan.findMany({})).map((s) => [s.storageKey, s]));
    assert.equal(scans.get('ticket-a1.png').state, 'clean');
    assert.equal(scans.get('ticket-a2.png').state, 'pending', 'still unscanned: never served');
    assert.equal(scans.get('ticket-a2.png').link, `#tickets/${fx.ids.T1}`);
    assert.equal(scans.get('ticket-a3.png').state, 'infected');
    assert.equal(scans.has('ticket-a4.png'), false, 'no verdict: the gate scans it first');
    assert.equal(report.attachments.infected, 1);

    // The audit trail: the ticket and settings rows, marked, with time and actor.
    const audit = await db.auditLog.findMany({ where: { origin: 'portal' } });
    assert.deepEqual(audit.map((a) => a.action).sort(), [
      'helpdesk.sla.update',
      'ticket.created',
    ]);
    const created = audit.find((a) => a.action === 'ticket.created');
    assert.equal(created.at.toISOString(), '2026-10-19T10:00:00.000Z');
    assert.equal(created.actorId, fx.users.req1.id);
    assert.equal(created.ip, '10.0.0.1');
    const runs = await db.auditLog.findMany({
      where: { action: 'helpdesk.migrate_from_portal' },
    });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].actorId, fx.users.admin.id);
    assert.equal(runs[0].origin, null);
    assert.equal(JSON.parse(runs[0].after).tables.Ticket.created, 3);
  });

  test('a second run copies nothing new', { skip }, async () => {
    const w = world();
    await w.run();
    const counts = async () =>
      Promise.all(
        [
          'userProfile',
          'ticket',
          'ticketComment',
          'notification',
          'portalImport',
          'fileScan',
        ].map((m) => db[m].count())
      );
    const first = await counts();
    const again = await w.run();
    assert.equal(again.copied, 0);
    assert.ok(Object.values(again.tables).every((t) => t.created === 0 && t.matched === 0));
    assert.equal(again.tables.Ticket.already, 3);
    assert.deepEqual(await counts(), first);
    assert.equal((await w.verify(again)).ok, true);
    // Each run is audited, even one that had nothing left to do.
    assert.equal(
      await db.auditLog.count({ where: { action: 'helpdesk.migrate_from_portal' } }),
      2
    );
  });

  test('the yearly counter continues after the highest number', { skip }, async () => {
    // The portal's counter says 3, but IT-2026-00007 exists: the next must be 8.
    const w = world((fx) => {
      fx.tables.ticketSequence[0].last = 3;
    });
    await w.run();
    const rows = await db.ticketSequence.findMany({ orderBy: { year: 'asc' } });
    assert.deepEqual(
      rows.map((s) => [s.prefix, s.year, s.last]),
      [
        ['IT', 2025, 12],
        ['IT', 2026, 7],
      ]
    );
    // What the ticket store does for the next ticket (store-prisma.js nextTicketNumber).
    await db.ticketSequence.updateMany({
      where: { prefix: 'IT', year: 2026 },
      data: { last: { increment: 1 } },
    });
    const next = await db.ticketSequence.findFirst({ where: { prefix: 'IT', year: 2026 } });
    assert.equal(ticketNumber('IT', 2026, next.last), 'IT-2026-00008');
  });

  test(
    'tickets that did not come from the portal: refused, unless --force-merge',
    { skip },
    async () => {
      const w = world();
      await w.run();
      // A ticket raised in the helpdesk itself, after the first run.
      const t1 = await db.ticket.findUnique({ where: { id: w.fx.ids.T1 } });
      await db.ticket.create({
        data: { ...t1, id: randomUUID(), number: 'IT-2026-00100', subject: 'Raised here' },
      });

      // The portal gained a ticket since: a rerun would add it beside the helpdesk's own.
      const fresh = structuredClone(w.fx.tables.ticket[0]);
      fresh.id = randomUUID();
      fresh.number = 'IT-2026-00008';
      w.fx.tables.ticket.push(fresh);

      await assert.rejects(w.run(), (err) => {
        assert.ok(err instanceof MigrationRefused);
        assert.match(
          err.message,
          /1 ticket\(s\) that did not come from the portal.*--force-merge/
        );
        return true;
      });
      assert.equal(await db.ticket.count(), 4, 'nothing written');

      const merged = await w.run({ forceMerge: true });
      assert.equal(merged.tables.Ticket.created, 1);
      assert.ok(await db.ticket.findUnique({ where: { number: 'IT-2026-00008' } }));
      const seq = await db.ticketSequence.findFirst({ where: { year: 2026 } });
      assert.equal(seq.last, 100, 'after the highest number here, whichever app gave it');
    }
  );

  test(
    'a portal number already used by another ticket here is refused, even merging',
    { skip },
    async () => {
      const w = world();
      await w.run();
      // Forget that T1 came from the portal: it now looks like the helpdesk's own IT-2026-00005.
      await db.portalImport.deleteMany({ where: { entity: 'Ticket', sourceId: w.fx.ids.T1 } });
      await assert.rejects(
        w.run({ forceMerge: true }),
        /ticket number\(s\) are already used here/
      );
    }
  );

  test('the check finds a file that differs or is missing', { skip }, async () => {
    const w = world();
    const report = await w.run();
    w.helpdeskFiles.files.set('ticket-a1.png', Buffer.from('fake image ONE'));
    w.helpdeskFiles.files.delete('ticket-a4.png');
    const check = await w.verify(report);
    assert.equal(check.ok, false);
    assert.equal(check.problems.length, 2);
    assert.ok(check.problems.some((p) => /size or hash differs/.test(p)));
    assert.ok(check.problems.some((p) => /file missing here/.test(p)));
    assert.match(formatSummary({ ...report, verification: check }), /CHECK FAILED \(2\)/);
  });

  test(
    'people already here are matched by Entra id, then email, never duplicated',
    { skip },
    async () => {
      const w = world();
      const { fx } = w;
      // The helpdesk already knows GEN and two people (a directory sync ran first).
      const gen = await db.company.create({
        data: {
          code: 'GEN',
          nameEn: 'Fake Mining',
          nameAr: 'تعدين',
          domain: 'gen.example.org',
          accentColor: '#225588',
        },
      });
      await db.companyDomain.create({ data: { companyId: gen.id, domain: 'gen.example.org' } });
      const byOid = await db.userProfile.create({
        data: {
          entraObjectId: fx.users.req1.entraObjectId,
          email: 'renamed.requester@gen.example.org',
          companyId: gen.id,
          displayNameEn: 'Fake requester.one',
          displayNameAr: 'مستخدم',
        },
      });
      const byEmail = await db.userProfile.create({
        data: {
          entraObjectId: randomUUID(),
          email: fx.users.agent.email,
          companyId: gen.id,
          displayNameEn: 'Fake agent.one',
          displayNameAr: 'مستخدم',
        },
      });

      const report = await w.run();
      assert.equal(report.tables.Company.matched, 1);
      assert.equal(report.tables.UserProfile.matched, 2);
      assert.equal(await db.userProfile.count(), 9);
      assert.equal(await db.company.count(), 3);
      const t1 = await db.ticket.findUnique({ where: { id: fx.ids.T1 } });
      assert.equal(t1.requesterId, byOid.id);
      assert.equal(t1.assigneeId, byEmail.id);
      // HR had not been imported here for them: the portal's HR fields come along.
      const req1 = await db.userProfile.findUnique({ where: { id: byOid.id } });
      assert.equal(req1.staffId, 'S100');
      assert.equal(req1.jobTitle, 'Fake Surveyor');
      assert.equal(req1.email, 'renamed.requester@gen.example.org', 'their own fields stay');
      assert.equal((await w.verify(report)).ok, true);
    }
  );

  test('db:setup-live adds no default settings on top of the portal’s', { skip }, async () => {
    const w = world();
    await w.run();
    const before = await db.ticketCategory.count();
    assert.equal(await settingsFromPortal(db), true);
    assert.equal(await companiesFromPortal(db), true);

    const result = await ensureDefaults(db);
    assert.ok(Object.values(result.created).every((n) => n === 0));
    assert.equal(await db.ticketCategory.count(), before);
    assert.equal(await db.slaPolicy.count(), 4);
    assert.equal(await db.cannedReply.count(), 1);
    assert.equal(await db.holiday.count(), 1);

    // Without the guard the defaults would add their own categories beside the portal's.
    const plain = await ensureHelpdeskDefaults(db);
    assert.ok(plain.created.categories > 0, 'the guard is what keeps them out');
  });

  test('the directory sync and the HR import match the migrated people', { skip }, async () => {
    const w = world();
    const { fx } = w;
    await w.run();
    const active = Object.values(fx.users).filter((u) => u.isActive);
    const graphUsers = active.map((u) => ({
      id: u.entraObjectId,
      displayName: u.displayNameEn,
      mail: u.email,
      userPrincipalName: u.email,
      accountEnabled: true,
      userType: 'Member',
    }));
    const store = createPrismaDirectoryStore();
    const runner = createSyncRunner({
      store,
      getGraph: async () => ({
        listUsers: async () => graphUsers,
        getManager: async () => null,
      }),
      now: () => NOW,
    });
    await runner.start();
    await runner.idle();
    const run = await db.syncRun.findFirst({ orderBy: { startedAt: 'desc' } });
    assert.equal(run.status, 'success', run.warnings);
    assert.equal(run.created, 0);
    assert.equal(run.deactivated, 0);
    assert.equal(await db.userProfile.count(), 9);

    const people = [
      'staff_id,full_name,position,company_code,department,hr_department_original,location,employment_category,hire_date',
      'S100,Someone Else Entirely,Senior Fake Surveyor,GEN,Information Technology,IT,Fake Mine Site,Staff,2020-01-05',
    ].join('\n');
    const departments = [
      'company_code,department,name_ar,people',
      'GEN,Information Technology,تقنية المعلومات,1',
    ].join('\n');
    const { plan } = await runHrImport({
      portalData: 'live',
      dataVar: 'HELPDESK_DATA',
      store,
      files: { people, departments, matches: null },
      asEmail: fx.users.admin.email,
      dryRun: false,
      now: () => NOW,
    });
    assert.equal(plan.counts.GEN.matched, 1, 'by the staff id the portal stored');
    assert.equal(await db.userProfile.count(), 9);
    assert.equal(await db.department.count(), 1);
    const req1 = await db.userProfile.findUnique({ where: { id: fx.users.req1.id } });
    assert.equal(req1.jobTitle, 'Senior Fake Surveyor');
  });

  test(
    'refused while the portal’s helpdesk jobs still run; a dry run only warns',
    { skip },
    async () => {
      const w = world((fx) => {
        fx.tables.jobLease[0].lastStartedAt = new Date(NOW.getTime() - 5 * 60_000);
      });
      await assert.rejects(w.run(), /PORTAL_HELPDESK_JOBS=off.*Nothing was copied/);
      assert.equal(await db.ticket.count(), 0);
      const dry = await w.run({ dryRun: true });
      assert.match(dry.warnings.join(' '), /PORTAL_HELPDESK_JOBS=off/);
    }
  );

  test('refused while a helpdesk server works on the same database', { skip }, async () => {
    const w = world();
    await db.jobLease.create({
      data: {
        name: 'sla-watch',
        lockedUntil: NOW,
        holder: 'helpdesk',
        lastStartedAt: new Date(NOW.getTime() - 60_000),
      },
    });
    await assert.rejects(w.run(), /A helpdesk server is working on this database/);
  });

  test('--as must be an active holding-wide HoldingAdmin of the portal', { skip }, async () => {
    const w = world();
    for (const email of [
      w.fx.users.caMsr.email,
      w.fx.users.lead1.email,
      'nobody@hld.example.org',
    ]) {
      await assert.rejects(w.run({ asEmail: email }), MigrationRefused);
    }
    assert.equal(await db.portalImport.count(), 0);
  });

  test('the portal is read-only: every write is refused before it is sent', async () => {
    const calls = [];
    const spy = new Proxy(
      {},
      {
        get: (_t, model) =>
          new Proxy(
            {},
            {
              get:
                (_d, op) =>
                (...args) =>
                  calls.push([model, op, args]),
            }
          ),
      }
    );
    const portal = readOnly(spy);
    for (const op of [
      'create',
      'update',
      'upsert',
      'delete',
      'deleteMany',
      'updateMany',
      'createMany',
    ]) {
      assert.throws(() => portal.ticket[op]({}), /read-only/);
    }
    for (const raw of ['$executeRaw', '$executeRawUnsafe', '$queryRawUnsafe', '$transaction']) {
      assert.throws(() => portal[raw], /read-only/);
    }
    await portal.ticket.findMany({});
    await portal.ticket.count({});
    assert.deepEqual(
      calls.map(([m, op]) => `${m}.${op}`),
      ['ticket.findMany', 'ticket.count']
    );
    const files = readOnlyFiles({
      get: async () => null,
      put: async () => {},
      remove: async () => {},
    });
    assert.deepEqual(Object.keys(files), ['get']);
  });

  test('reads a database built by the portal’s own migrations', { skip }, async () => {
    // The real source: the portal's schema (its AuditLog has no `origin`, and
    // it has tables the helpdesk does not), read through the helpdesk's client.
    const portalSchema = fileURLToPath(
      new URL('../../../portal/backend/prisma/schema.prisma', import.meta.url)
    );
    if (!existsSync(portalSchema)) return;
    const portalUrl = withDatabase(
      url,
      databaseName(url).replace(/_migrate_test$/i, '_portalsrc_test')
    );
    await ensureDatabase(portalUrl);
    migrateDeploy(portalUrl, portalSchema);
    await cleanTestDatabase(portalUrl);

    const PrismaClient = await runtime().prismaClient();
    const writer = new PrismaClient({ datasourceUrl: portalUrl });
    const fx = portalFixture();
    try {
      // createMany returns no rows, so nothing asks the portal for a column it lacks.
      for (const [model, rows] of Object.entries(fx.tables)) {
        if (rows.length) await writer[model].createMany({ data: rows });
      }
      const portalFiles = createMemoryStorage();
      for (const [key, bytes] of fx.files) portalFiles.files.set(key, bytes);
      const options = {
        source: readOnly(writer),
        target: db,
        sourceFiles: readOnlyFiles(portalFiles),
        targetFiles: createMemoryStorage(),
        asEmail: fx.users.admin.email,
        now: () => NOW,
      };
      const report = await migrateFromPortal(options);
      assert.equal(report.tables.Ticket.created, 3);
      assert.equal(report.tables.AuditLog.created, 2);
      const check = await verifyMigration({ ...options, report });
      assert.deepEqual(check.problems, []);
    } finally {
      await writer.$disconnect();
    }
  });

  test('IT’s portal links become the helpdesk’s', () => {
    assert.equal(helpdeskLink('/helpdesk#tickets/abc'), '#tickets/abc');
    assert.equal(helpdeskLink('#tickets/abc'), '#tickets/abc');
    assert.equal(helpdeskLink(null), null);
  });
});
