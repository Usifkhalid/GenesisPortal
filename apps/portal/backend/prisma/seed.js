/**
 * seed.js — loads seed-data.js into the database: the three companies, their
 * departments, fourteen fake users for AUTH_MODE=mock to list and six HQ rooms.
 * The IT helpdesk's demo data is the helpdesk app's (apps/helpdesk, D146).
 *
 * Idempotent: rows are matched on natural keys (company code, department name
 * within a company, user email, room mailbox), so `npm run db:seed` can be run again after
 * editing seed-data.js. It updates and adds; it never deletes.
 */

import { env, isProduction } from '../src/config/env.js';
import { disconnectPrisma, getPrisma } from '@mg/shared/server/lib/prisma.js';
import { COMPANIES, ROOMS } from '@mg/shared/server/demo/seed-data.js';
import { seedCompanies, seedPeople } from '@mg/shared/server/demo/seed.js';

export { seedCompanies };

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<{ companies: number, departments: number, users: number, rooms: number }>}
 */
export async function seed(prisma) {
  const companyIds = await seedCompanies(prisma, COMPANIES);
  return seedDemo(prisma, companyIds);
}

/** Departments, fake people and rooms: the demo database only. */
async function seedDemo(prisma, companyIds) {
  const { departmentIds, userIds } = await seedPeople(prisma, companyIds);

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
