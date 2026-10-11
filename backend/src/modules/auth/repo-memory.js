/**
 * repo-memory.js — repo.js's interface over prisma/seed-data.js, held in
 * memory. Used by the tests, and by `npm run dev` while no SQL Server is
 * configured, so sign-in can be seen working before the database exists.
 * Never used in production: config/env.js refuses to boot there without
 * DATABASE_URL.
 */

import {
  COMPANIES,
  DEPARTMENTS,
  ROOMS,
  USERS,
  fakeEntraObjectId,
} from '../../../prisma/seed-data.js';
import { ROLES } from '../../lib/roles.js';
import { searchKeyOf } from '../../lib/text-search.js';

/** A stable id for the nth row of a table, shaped like the UUIDs Prisma makes. */
const fakeId = (table, index) =>
  `${table}0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

export function createMemoryUserRepo() {
  const now = new Date();
  const companies = COMPANIES.map((company, i) => ({
    id: fakeId(1, i),
    ...company,
    domains: [company.domain],
    logoKey: null,
    showMobileInDirectory: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  const companyByCode = new Map(companies.map((c) => [c.code, c]));

  const departments = DEPARTMENTS.map((d, i) => ({
    id: fakeId(4, i),
    key: d.key,
    companyId: companyByCode.get(d.company).id,
    nameEn: d.nameEn,
    nameAr: d.nameAr,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));

  const users = USERS.map((user, i) => {
    const company = companyByCode.get(user.company);
    const department = departments.find(
      (d) => d.companyId === company.id && d.key === user.department
    );
    return {
      id: fakeId(2, i),
      entraObjectId: fakeEntraObjectId(i),
      email: user.email,
      companyId: company.id,
      displayNameEn: user.displayNameEn,
      displayNameAr: user.displayNameAr,
      jobTitle: user.jobTitle,
      officeLocation: user.officeLocation ?? null,
      phone: user.phone ?? null,
      mobilePhone: null,
      managerId: null,
      graphDepartment: null,
      graphCompanyName: null,
      searchKey: searchKeyOf(user),
      language: user.language,
      isActive: true,
      company,
      departmentId: department?.id ?? null,
      department: department ? { nameEn: department.nameEn, nameAr: department.nameAr } : null,
      // The same rule as seed.js: only a HoldingAdmin is holding-wide.
      roles: [
        {
          id: fakeId(3, i),
          role: user.role,
          scopeCompanyId: user.role === ROLES.HOLDING_ADMIN ? null : company.id,
        },
      ],
    };
  });

  // Managers are another seeded user's email in seed-data.js.
  const byEmail = new Map(users.map((u) => [u.email, u]));
  USERS.forEach((seed, i) => {
    users[i].managerId = seed.manager ? byEmail.get(seed.manager).id : null;
  });

  const brief = (user) => (user ? { id: user.id, isActive: user.isActive } : null);

  const rooms = ROOMS.map((room, i) => ({
    id: fakeId(5, i),
    ...room,
    equipment: [...room.equipment],
    photoKey: null,
    photoUrl: null,
    notes: '',
    isActive: true,
    companyIds: [],
    createdAt: now,
    updatedAt: now,
  }));

  return {
    /** The rows themselves, so a test can deactivate someone or change a role. */
    companies,
    users,
    departments,
    /** Rows written by the admin module, for tests and development. */
    auditLogs: [],
    /** Directory sync runs (modules/directory/store-memory.js). */
    syncRuns: [],
    /** Rooms and bookings (modules/rooms/store-memory.js). */
    rooms,
    bookings: [],
    /** The mocked Graph's calendar (integrations/graph/mock-calendar.js). */
    mockCalendarEvents: [],

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
