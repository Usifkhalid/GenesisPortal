/**
 * seed.js — the helpdesk's demo database (HELPDESK_DATA=demo, mghelpdesk):
 * the companies and their domains, departments, the fake people mock sign-in
 * lists, and the IT helpdesk (team, members, categories, locations, targets,
 * hours, holidays, canned replies). The same demo data as the portal's
 * (packages/shared/server/demo), without rooms or announcements. No tickets:
 * they are raised in the app.
 *
 * Idempotent: rows are matched on natural keys, so `npm run db:seed` can be
 * run again. It updates and adds; it never deletes.
 */

import { env, isProduction } from '../src/config/env.js';
import { COMPANIES } from '@mg/shared/server/demo/seed-data.js';
import { seedCompanies, seedHelpdesk, seedPeople } from '@mg/shared/server/demo/seed.js';
import { disconnectPrisma, getPrisma } from '@mg/shared/server/lib/prisma.js';

/**
 * @param {object} prisma  the helpdesk's client
 * @returns {Promise<{ companies: number, departments: number, users: number }>}
 */
export async function seed(prisma) {
  const companyIds = await seedCompanies(prisma, COMPANIES);
  const { departmentIds, userIds } = await seedPeople(prisma, companyIds);
  await seedHelpdesk(prisma, userIds);
  return { companies: companyIds.size, departments: departmentIds.size, users: userIds.size };
}

// Run only as `node backend/prisma/seed.js`, not when a test imports seed().
if (import.meta.main) {
  if (isProduction) throw new Error('Refusing to seed fake users into production.');
  if (env.HELPDESK_DATA === 'live') {
    throw new Error('Refusing to seed fake users into the live database (HELPDESK_DATA=live).');
  }

  try {
    const counts = await seed(await getPrisma());
    console.log(
      `Seeded ${counts.companies} companies, ${counts.departments} departments, ${counts.users} users.`
    );
  } finally {
    await disconnectPrisma();
  }
}
