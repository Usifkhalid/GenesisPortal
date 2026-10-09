/**
 * repo-memory.js — repo.js's interface over prisma/seed-data.js, held in
 * memory. Used by the tests, and by `npm run dev` while no SQL Server is
 * configured, so sign-in can be seen working before the database exists.
 * Never used in production: config/env.js refuses to boot there without
 * DATABASE_URL.
 */

import { COMPANIES, DEPARTMENTS, USERS, fakeEntraObjectId } from '../../../prisma/seed-data.js';
import { ROLES } from '../../lib/roles.js';

/** A stable id for the nth row of a table, shaped like the UUIDs Prisma makes. */
const fakeId = (table, index) =>
  `${table}0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

export function createMemoryUserRepo() {
  const companies = COMPANIES.map((company, i) => ({
    id: fakeId(1, i),
    ...company,
    isActive: true,
  }));
  const companyByCode = new Map(companies.map((c) => [c.code, c]));

  const users = USERS.map((user, i) => {
    const company = companyByCode.get(user.company);
    const department = DEPARTMENTS.find(
      (d) => d.company === user.company && d.key === user.department
    );
    return {
      id: fakeId(2, i),
      entraObjectId: fakeEntraObjectId(i),
      email: user.email,
      companyId: company.id,
      displayNameEn: user.displayNameEn,
      displayNameAr: user.displayNameAr,
      jobTitle: user.jobTitle,
      language: user.language,
      isActive: true,
      company,
      department: department ? { nameEn: department.nameEn, nameAr: department.nameAr } : null,
      // The same rule as seed.js: only a HoldingAdmin is holding-wide.
      roles: [
        {
          role: user.role,
          scopeCompanyId: user.role === ROLES.HOLDING_ADMIN ? null : company.id,
        },
      ],
    };
  });

  const brief = (user) => (user ? { id: user.id, isActive: user.isActive } : null);

  return {
    /** The rows themselves, so a test can deactivate someone or change a role. */
    companies,
    users,

    async listCompaniesWithUsers() {
      return companies
        .filter((c) => c.isActive)
        .map((company) => ({
          ...company,
          users: users.filter((u) => u.companyId === company.id && u.isActive),
        }));
    },

    async getSessionUser(id) {
      return users.find((u) => u.id === id) ?? null;
    },

    async findByEntraObjectId(entraObjectId) {
      return brief(users.find((u) => u.entraObjectId === entraObjectId));
    },

    async findByEmail(email) {
      return brief(users.find((u) => u.email === email));
    },

    async linkEntraObjectId(id, entraObjectId) {
      const user = users.find((u) => u.id === id);
      if (user) user.entraObjectId = entraObjectId;
    },

    async listCompanies(ids) {
      return companies.filter((c) => c.isActive && (!ids || ids.includes(c.id)));
    },
  };
}
