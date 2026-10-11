/**
 * seed.js — loads seed-data.js into the database: the three companies, their
 * departments, twelve fake users for AUTH_MODE=mock to list, and six HQ rooms.
 *
 * Idempotent: rows are matched on natural keys (company code, department name
 * within a company, user email, room mailbox), so `npm run db:seed` can be run again after
 * editing seed-data.js. It updates and adds; it never deletes.
 */

import { isProduction } from '../src/config/env.js';
import { disconnectPrisma, getPrisma } from '../src/lib/prisma.js';
import { ROLES } from '../src/lib/roles.js';
import { searchKeyOf } from '../src/lib/text-search.js';
import { COMPANIES, DEPARTMENTS, ROOMS, USERS, fakeEntraObjectId } from './seed-data.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<{ companies: number, departments: number, users: number, rooms: number }>}
 */
export async function seed(prisma) {
  const companyIds = new Map();
  for (const { code, ...data } of COMPANIES) {
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
      create: { email, entraObjectId: fakeEntraObjectId(index), ...data },
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

  try {
    const counts = await seed(await getPrisma());
    console.log(
      `Seeded ${counts.companies} companies, ${counts.departments} departments, ${counts.users} users, ${counts.rooms} rooms.`
    );
  } finally {
    await disconnectPrisma();
  }
}
