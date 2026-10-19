/**
 * seed.js — loads seed-data.js into the database: the three companies, their
 * departments, fourteen fake users for AUTH_MODE=mock to list, six HQ rooms, and
 * the IT helpdesk (team, members, categories, locations, targets, hours,
 * holidays, canned replies).
 *
 * Idempotent: rows are matched on natural keys (company code, department name
 * within a company, user email, room mailbox, team code, category and location
 * name, holiday date), so `npm run db:seed` can be run again after
 * editing seed-data.js. It updates and adds; it never deletes.
 */

import { env, isProduction } from '../src/config/env.js';
import { disconnectPrisma, getPrisma } from '../src/lib/prisma.js';
import { ROLES } from '../src/lib/roles.js';
import { searchKeyOf } from '../src/lib/text-search.js';
import {
  COMPANIES,
  DEPARTMENTS,
  HOLIDAYS,
  ROOMS,
  SUPPORT_TEAMS,
  TICKET_LOCATIONS,
  USERS,
  fakeEntraObjectId,
} from './seed-data.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<{ companies: number, departments: number, users: number, rooms: number }>}
 */
export async function seed(prisma) {
  const companyIds = await seedCompanies(prisma, COMPANIES);
  return seedDemo(prisma, companyIds);
}

/**
 * The companies and their mail domains, nothing else: all the live database
 * starts with (scripts/setup-live-db.js). Returns code → id.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {typeof COMPANIES} companies
 */
export async function seedCompanies(prisma, companies) {
  const companyIds = new Map();
  for (const { code, ...data } of companies) {
    const row = await prisma.company.upsert({
      where: { code },
      update: data,
      create: { code, ...data },
    });
    companyIds.set(code, row.id);
    // The domain is also a CompanyDomain row, which is what keeps it unique
    // across companies once admins can add more.
    await prisma.companyDomain.upsert({
      where: { domain: data.domain },
      update: { companyId: row.id },
      create: { companyId: row.id, domain: data.domain },
    });
  }
  return companyIds;
}

/** Departments, fake people, rooms and the helpdesk: the demo database only. */
async function seedDemo(prisma, companyIds) {
  const departmentIds = new Map();
  for (const { company, key, ...names } of DEPARTMENTS) {
    const companyId = companyIds.get(company);
    const row = await prisma.department.upsert({
      where: { companyId_nameEn: { companyId, nameEn: names.nameEn } },
      update: names,
      create: { companyId, ...names },
    });
    departmentIds.set(`${company}/${key}`, row.id);
  }

  // Users first without managers, so a manager may appear after their report.
  const userIds = new Map();
  for (const [index, user] of USERS.entries()) {
    const { email, company, department } = user;
    const data = {
      displayNameEn: user.displayNameEn,
      displayNameAr: user.displayNameAr,
      jobTitle: user.jobTitle,
      officeLocation: user.officeLocation,
      phone: user.phone,
      language: user.language,
      companyId: companyIds.get(company),
      departmentId: departmentIds.get(`${company}/${department}`),
      searchKey: searchKeyOf(user),
      lastSyncedAt: new Date(),
    };
    const row = await prisma.userProfile.upsert({
      where: { email },
      update: data,
      create: {
        email,
        entraObjectId: user.entraObjectId ?? fakeEntraObjectId(index),
        ...data,
      },
    });
    userIds.set(email, row.id);
  }

  for (const user of USERS) {
    const userId = userIds.get(user.email);

    await prisma.userProfile.update({
      where: { id: userId },
      data: { managerId: user.manager ? userIds.get(user.manager) : null },
    });

    // A HoldingAdmin's assignment is holding-wide; every other role is scoped
    // to the user's own company. Not an upsert: Prisma cannot address a
    // compound unique key that contains NULL.
    const assignment = {
      userId,
      role: user.role,
      scopeCompanyId: user.role === ROLES.HOLDING_ADMIN ? null : companyIds.get(user.company),
    };
    const existing = await prisma.roleAssignment.findFirst({ where: assignment });
    if (!existing) await prisma.roleAssignment.create({ data: assignment });
  }

  // Rooms are shared by every company: no restriction rows are seeded.
  for (const { mailboxEmail, equipment, ...room } of ROOMS) {
    const data = { ...room, equipment: equipment.join(',') };
    await prisma.room.upsert({
      where: { mailboxEmail },
      update: data,
      create: { mailboxEmail, ...data },
    });
  }

  // The helpdesk. Members, targets and hours are matched on their team;
  // an administrator's later edits to a seeded row are kept, except the
  // names and defaults listed in seed-data.js.
  for (const { members, calendar, sla, categories, cannedReplies, ...team } of SUPPORT_TEAMS) {
    const { code, ...teamData } = team;
    const row = await prisma.supportTeam.upsert({
      where: { code },
      update: teamData,
      create: { code, ...teamData },
    });
    const teamId = row.id;

    for (const member of members) {
      const userId = userIds.get(member.email);
      await prisma.supportTeamMember.upsert({
        where: { teamId_userId: { teamId, userId } },
        update: { role: member.role },
        create: { teamId, userId, role: member.role },
      });
    }
    await prisma.businessCalendar.upsert({
      where: { teamId },
      update: {},
      create: { teamId, ...calendar },
    });
    for (const policy of sla) {
      await prisma.slaPolicy.upsert({
        where: { teamId_priority: { teamId, priority: policy.priority } },
        update: {},
        create: { teamId, ...policy },
      });
    }
    for (const [sortOrder, category] of categories.entries()) {
      await prisma.ticketCategory.upsert({
        where: { teamId_nameEn: { teamId, nameEn: category.nameEn } },
        update: { nameAr: category.nameAr },
        create: { teamId, sortOrder, ...category },
      });
    }
    for (const [sortOrder, reply] of cannedReplies.entries()) {
      const existing = await prisma.cannedReply.findFirst({
        where: { teamId, titleEn: reply.titleEn },
      });
      if (!existing) await prisma.cannedReply.create({ data: { teamId, sortOrder, ...reply } });
    }
  }

  for (const [sortOrder, location] of TICKET_LOCATIONS.entries()) {
    await prisma.ticketLocation.upsert({
      where: { nameEn: location.nameEn },
      update: { nameAr: location.nameAr },
      create: { sortOrder, ...location },
    });
  }

  for (const { date, ...names } of HOLIDAYS) {
    await prisma.holiday.upsert({ where: { date }, update: {}, create: { date, ...names } });
  }

  return {
    companies: companyIds.size,
    departments: departmentIds.size,
    users: userIds.size,
    rooms: ROOMS.length,
  };
}

// Run only as `node backend/prisma/seed.js`, not when a test imports seed().
if (import.meta.main) {
  if (isProduction) throw new Error('Refusing to seed fake users into production.');
  if (env.PORTAL_DATA === 'live') {
    throw new Error('Refusing to seed fake users into the live database (PORTAL_DATA=live).');
  }

  try {
    const counts = await seed(await getPrisma());
    console.log(
      `Seeded ${counts.companies} companies, ${counts.departments} departments, ${counts.users} users, ${counts.rooms} rooms.`
    );
  } finally {
    await disconnectPrisma();
  }
}
