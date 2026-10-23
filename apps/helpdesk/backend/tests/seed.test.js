import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COMPANIES,
  DEPARTMENTS,
  HOLIDAYS,
  SUPPORT_TEAMS,
  TICKET_LOCATIONS,
  USERS,
  fakeEntraObjectId,
} from '@mg/shared/server/demo/seed-data.js';
import { seed } from '../prisma/seed.js';
import { env } from '../src/config/env.js';
import { disconnectPrisma, getPrisma } from '@mg/shared/server/lib/prisma.js';
import { ROLES } from '@mg/shared/server/lib/roles.js';
import { createFakePrisma } from './helpers/fake-prisma.js';

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;
const countBy = (items, key) => Object.groupBy(items, (item) => item[key]);

describe('seed data', () => {
  test('the three companies, named in both languages', () => {
    assert.deepEqual(COMPANIES.map((c) => c.code).sort(), ['GEN', 'HLD', 'MSR']);
    for (const company of COMPANIES) {
      assert.match(company.nameEn, LATIN);
      assert.match(company.nameAr, ARABIC);
      assert.match(company.accentColor, /^#[0-9a-f]{6}$/);
      assert.ok(company.domain);
    }
    assert.equal(new Set(COMPANIES.map((c) => c.domain)).size, 3);
  });

  test('three departments per company, named in both languages', () => {
    const byCompany = countBy(DEPARTMENTS, 'company');
    for (const { code } of COMPANIES) assert.equal(byCompany[code].length, 3, code);
    for (const department of DEPARTMENTS) {
      assert.match(department.nameEn, LATIN);
      assert.match(department.nameAr, ARABIC);
    }
  });

  test('fourteen users: 1 HoldingAdmin, 1 CompanyAdmin per company, the rest Users', () => {
    assert.equal(USERS.length, 14);

    const byRole = countBy(USERS, 'role');
    assert.equal(byRole[ROLES.HOLDING_ADMIN].length, 1);
    assert.equal(byRole[ROLES.HOLDING_ADMIN][0].company, 'HLD');
    assert.deepEqual(byRole[ROLES.COMPANY_ADMIN].map((u) => u.company).sort(), [
      'GEN',
      'HLD',
      'MSR',
    ]);
    assert.equal(byRole[ROLES.USER].length, 10);

    for (const { code } of COMPANIES)
      assert.ok(
        USERS.some((u) => u.company === code),
        code
      );
  });

  test('every user is well formed and belongs where they say', () => {
    const domains = new Map(COMPANIES.map((c) => [c.code, c.domain]));
    const departments = new Set(DEPARTMENTS.map((d) => `${d.company}/${d.key}`));
    const byEmail = new Map(USERS.map((u) => [u.email, u]));

    assert.equal(byEmail.size, USERS.length, 'emails are unique');

    for (const user of USERS) {
      assert.match(user.displayNameEn, LATIN);
      assert.doesNotMatch(user.displayNameEn, ARABIC);
      assert.match(user.displayNameAr, ARABIC);
      assert.ok(['en', 'ar'].includes(user.language));
      assert.ok(user.email.endsWith(`@${domains.get(user.company)}`), user.email);
      assert.ok(departments.has(`${user.company}/${user.department}`), user.email);

      if (user.manager) {
        const manager = byEmail.get(user.manager);
        assert.ok(manager, `${user.email}: manager exists`);
        assert.equal(
          manager.company,
          user.company,
          `${user.email}: manager is in the same company`
        );
      }
    }
  });

  test('the IT helpdesk: one team for every company, a lead and two agents, in both languages', () => {
    assert.equal(SUPPORT_TEAMS.length, 1);
    const [it] = SUPPORT_TEAMS;
    assert.equal(it.code, 'IT');
    assert.equal(it.servesAllCompanies, true);
    assert.deepEqual(it.members.map((m) => m.role).sort(), ['Agent', 'Agent', 'Lead']);
    for (const member of it.members) {
      assert.ok(
        USERS.some((u) => u.email === member.email),
        member.email
      );
    }
    assert.deepEqual(
      it.categories.map((c) => c.nameEn),
      [
        'Laptop / PC',
        'Printer / scanner',
        'Email & Teams',
        'Accounts & passwords',
        'Network / Wi-Fi / VPN',
        'Software & installs',
        'Phone',
        'New equipment request',
        'Other',
      ]
    );
    assert.deepEqual(
      it.sla.map((p) => [p.priority, p.firstResponseMinutes / 60, p.resolveMinutes / 60]),
      [
        ['P1', 1, 4],
        ['P2', 4, 8],
        ['P3', 8, 24],
        ['P4', 16, 40],
      ]
    );
    assert.deepEqual(it.calendar, {
      timeZone: 'Africa/Cairo',
      workingDays: '0,1,2,3,4',
      startMin: 480,
      endMin: 1020,
    });
    assert.equal(it.cannedReplies.length, 4);
    assert.deepEqual(
      TICKET_LOCATIONS.map((l) => l.nameEn),
      ['HQ Cairo', 'Sebaiya site', 'Dakhla site', 'Masar project site', 'Remote / other']
    );
    for (const row of [...it.categories, ...TICKET_LOCATIONS, ...HOLIDAYS]) {
      assert.match(row.nameAr, ARABIC, row.nameEn);
    }
    for (const reply of it.cannedReplies) {
      assert.match(reply.titleAr, ARABIC);
      assert.match(reply.bodyAr, ARABIC);
      assert.match(reply.bodyEn, LATIN);
    }
    assert.equal(new Set(HOLIDAYS.map((h) => h.date)).size, HOLIDAYS.length);
    for (const { date } of HOLIDAYS) assert.match(date, /^202[67]-\d{2}-\d{2}$/);
  });

  test('seeded people keep the ids the mocked Graph gives them', () => {
    // The first twelve by position; the helpdesk agents carry their own.
    const sherif = USERS.find((u) => u.email === 'sherif.awad@mgholding.example');
    assert.equal(sherif.entraObjectId, '00000000-0000-4000-9000-000000000003');
    assert.equal(
      USERS.findIndex((u) => u.entraObjectId),
      12
    );
    assert.equal(USERS[4].email, 'hany.soliman@genesismining-eg.com');
  });

  test('fake Entra object ids are distinct UUID-shaped strings', () => {
    const ids = USERS.map((_, i) => fakeEntraObjectId(i));
    assert.equal(new Set(ids).size, USERS.length);
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  });
});

/** The same assertions for the in-memory fake and for a real database. */
function assertSeeded({ companies, departments, users, roles }) {
  const companyIds = new Map(companies.map((c) => [c.id, c.code]));
  const codeOf = (id) => companyIds.get(id);

  for (const department of departments) assert.ok(codeOf(department.companyId));

  for (const user of users) {
    const source = USERS.find((u) => u.email === user.email);
    assert.equal(codeOf(user.companyId), source.company);

    const department = departments.find((d) => d.id === user.departmentId);
    assert.equal(department.companyId, user.companyId, 'department is in the user’s company');

    const manager = users.find((u) => u.id === user.managerId);
    assert.equal(manager?.email ?? null, source.manager);

    const own = roles.filter((r) => r.userId === user.id);
    assert.deepEqual(
      own.map((r) => r.role),
      [source.role]
    );
    assert.equal(
      own[0].scopeCompanyId,
      source.role === ROLES.HOLDING_ADMIN ? null : user.companyId,
      'only the HoldingAdmin is holding-wide'
    );
  }
}

describe('seed()', () => {
  test('writes every record with its relations resolved', async () => {
    const db = createFakePrisma();
    const counts = await seed(db);

    assert.deepEqual(counts, { companies: 3, departments: 9, users: 14 });

    // The helpdesk, with its members resolved to people.
    assert.equal(db.supportTeam.rows.length, 1);
    const emailOf = (id) => db.userProfile.rows.find((u) => u.id === id).email;
    assert.deepEqual(db.supportTeamMember.rows.map((m) => [emailOf(m.userId), m.role]).sort(), [
      ['omar.fahmy@mgholding.example', 'Lead'],
      ['sherif.awad@mgholding.example', 'Agent'],
      ['tamer.gad@mgholding.example', 'Agent'],
    ]);
    assert.equal(db.ticketCategory.rows.length, 9);
    assert.deepEqual(
      db.ticketCategory.rows.map((c) => c.sortOrder),
      [0, 1, 2, 3, 4, 5, 6, 7, 8]
    );
    assert.equal(db.slaPolicy.rows.length, 4);
    assert.equal(db.businessCalendar.rows.length, 1);
    assert.equal(db.cannedReply.rows.length, 4);
    assert.equal(db.ticketLocation.rows.length, 5);
    assert.equal(db.holiday.rows.length, HOLIDAYS.length);
    assertSeeded({
      companies: db.company.rows,
      departments: db.department.rows,
      users: db.userProfile.rows,
      roles: db.roleAssignment.rows,
    });
  });

  test('is idempotent: a second run adds nothing', async () => {
    const db = createFakePrisma();
    await seed(db);
    const ids = db.userProfile.rows.map((u) => u.id);
    await seed(db);

    assert.equal(db.company.rows.length, 3);
    assert.equal(db.department.rows.length, 9);
    assert.equal(db.userProfile.rows.length, 14);
    assert.equal(db.roleAssignment.rows.length, 14);
    assert.equal(db.supportTeam.rows.length, 1);
    assert.equal(db.supportTeamMember.rows.length, 3);
    assert.equal(db.ticketCategory.rows.length, 9);
    assert.equal(db.slaPolicy.rows.length, 4);
    assert.equal(db.cannedReply.rows.length, 4);
    assert.equal(db.ticketLocation.rows.length, 5);
    assert.equal(db.holiday.rows.length, HOLIDAYS.length);
    assert.deepEqual(
      db.userProfile.rows.map((u) => u.id),
      ids
    );
  });
});

/** A migrated database to seed for real, or the reason there is none. */
async function findDatabase() {
  if (!env.hasDatabase) return { reason: 'DATABASE_URL is not configured' };
  try {
    const prisma = await getPrisma();
    await prisma.company.count();
    return { prisma };
  } catch {
    await disconnectPrisma();
    return { reason: 'the database is unreachable or not migrated' };
  }
}

describe('seed() against SQL Server', async () => {
  const { prisma, reason } = await findDatabase();

  test('seeds twice and leaves exactly the seed set', { skip: reason }, async (t) => {
    t.after(disconnectPrisma);

    await seed(prisma);
    await seed(prisma);

    const emails = USERS.map((u) => u.email);
    const users = await prisma.userProfile.findMany({ where: { email: { in: emails } } });
    assert.equal(users.length, 14);

    const team = await prisma.supportTeam.findUnique({ where: { code: 'IT' } });
    assert.equal(await prisma.supportTeamMember.count({ where: { teamId: team.id } }), 3);
    assert.equal(await prisma.ticketCategory.count({ where: { teamId: team.id } }), 9);
    assert.equal(await prisma.slaPolicy.count({ where: { teamId: team.id } }), 4);
    assert.equal(await prisma.cannedReply.count({ where: { teamId: team.id } }), 4);
    assert.equal(await prisma.businessCalendar.count({ where: { teamId: team.id } }), 1);
    assert.equal(await prisma.ticketLocation.count(), 5);
    assert.equal(await prisma.holiday.count(), HOLIDAYS.length);

    assertSeeded({
      companies: await prisma.company.findMany(),
      departments: await prisma.department.findMany(),
      users,
      roles: await prisma.roleAssignment.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
      }),
    });
  });
});
