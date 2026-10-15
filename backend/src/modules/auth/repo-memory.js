/**
 * repo-memory.js — repo.js's interface over prisma/seed-data.js, held in
 * memory. Used by the tests, and by `npm run dev` while no SQL Server is
 * configured, so sign-in can be seen working before the database exists.
 * Never used in production: config/env.js refuses to boot there without
 * DATABASE_URL.
 */

import { randomUUID } from 'node:crypto';

import {
  COMPANIES,
  DEPARTMENTS,
  HOLIDAYS,
  ROOMS,
  SUPPORT_TEAMS,
  TICKET_LOCATIONS,
  USERS,
  fakeEntraObjectId,
} from '../../../prisma/seed-data.js';
import { ROLES, itRoleOf } from '../../lib/roles.js';
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
      entraObjectId: user.entraObjectId ?? fakeEntraObjectId(i),
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

  /** What lib/audit.js writes to, in place of a Prisma transaction. */
  const auditLogs = [];
  const auditTx = {
    auditLog: {
      async create({ data }) {
        const row = { id: randomUUID(), at: new Date(), createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      },
    },
  };

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

  // The helpdesk as seed.js would load it (modules/tickets/store-memory.js).
  const stamp = { createdAt: now, updatedAt: now };
  const helpdesk = {
    team: [],
    teamCompany: [],
    member: [],
    category: [],
    location: TICKET_LOCATIONS.map((location, i) => ({
      id: fakeId(7, i),
      ...location,
      sortOrder: i,
      isActive: true,
      ...stamp,
    })),
    sla: [],
    calendar: [],
    holiday: HOLIDAYS.map((holiday, i) => ({ id: fakeId(8, i), ...holiday, ...stamp })),
    canned: [],
    ticket: [],
    comment: [],
    attachment: [],
    event: [],
    /** "IT/2026" → the last number given out. */
    sequences: new Map(),
  };
  SUPPORT_TEAMS.forEach((seed, t) => {
    const { members, calendar, sla, categories, cannedReplies, ...team } = seed;
    const teamId = fakeId(6, t);
    const nth = (n) => t * 100 + n;
    helpdesk.team.push({ id: teamId, ...team, isActive: true, ...stamp });
    members.forEach((m, i) =>
      helpdesk.member.push({
        id: fakeId(9, nth(i)),
        teamId,
        userId: byEmail.get(m.email).id,
        role: m.role,
        ...stamp,
      })
    );
    helpdesk.calendar.push({ id: fakeId('a', t), teamId, ...calendar, ...stamp });
    sla.forEach((policy, i) =>
      helpdesk.sla.push({ id: fakeId('b', nth(i)), teamId, ...policy, ...stamp })
    );
    categories.forEach((category, i) =>
      helpdesk.category.push({
        id: fakeId('c', nth(i)),
        teamId,
        ...category,
        sortOrder: i,
        isActive: true,
        ...stamp,
      })
    );
    cannedReplies.forEach((reply, i) =>
      helpdesk.canned.push({
        id: fakeId('d', nth(i)),
        teamId,
        ...reply,
        sortOrder: i,
        isActive: true,
        ...stamp,
      })
    );
  });

  return {
    /** The rows themselves, so a test can deactivate someone or change a role. */
    companies,
    users,
    departments,
    /** Rows written by the admin module, for tests and development. */
    auditLogs,
    /** Directory sync runs (modules/directory/store-memory.js). */
    syncRuns: [],
    /** Rooms and bookings (modules/rooms/store-memory.js). */
    rooms,
    bookings: [],
    /** The mocked Graph's calendar (integrations/graph/mock-calendar.js). */
    mockCalendarEvents: [],
    /** Teams, their settings and tickets (modules/tickets/store-memory.js). */
    helpdesk,

    async listCompaniesWithUsers() {
      return companies
        .filter((c) => c.isActive)
        .map((company) => ({
          ...company,
          users: users.filter((u) => u.companyId === company.id && u.isActive),
        }));
    },

    async getSessionUser(id) {
      const user = users.find((u) => u.id === id);
      if (!user) return null;
      const activeTeams = new Set(helpdesk.team.filter((t) => t.isActive).map((t) => t.id));
      const memberships = helpdesk.member.filter(
        (m) => m.userId === id && activeTeams.has(m.teamId)
      );
      return { ...user, itRole: itRoleOf(memberships) };
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

    async findCompanyByDomain(domain) {
      const company = companies.find((c) => c.domain === domain || c.domains.includes(domain));
      return company ? { id: company.id, isActive: company.isActive } : null;
    },

    async createEntraProfile(profile, audit) {
      const company = companies.find((c) => c.id === profile.companyId);
      const user = {
        id: randomUUID(),
        ...profile,
        jobTitle: null,
        officeLocation: null,
        phone: null,
        mobilePhone: null,
        managerId: null,
        graphDepartment: null,
        graphCompanyName: null,
        searchKey: searchKeyOf(profile),
        language: 'en',
        isActive: true,
        company,
        departmentId: null,
        department: null,
        roles: [{ id: randomUUID(), role: ROLES.USER, scopeCompanyId: profile.companyId }],
      };
      users.push(user);
      const created = {
        id: user.id,
        isActive: true,
        entraObjectId: user.entraObjectId,
        email: user.email,
        companyId: user.companyId,
        displayNameEn: user.displayNameEn,
      };
      await audit(auditTx, created);
      return created;
    },

    async loadProfileRefresh(id) {
      const person = users.find((u) => u.id === id) ?? null;
      return {
        person: person && { ...person },
        companies: companies.map((c) => ({
          ...c,
          domains: [c.domain, ...c.domains].map((d) => d.toLowerCase()),
        })),
        departments,
      };
    },

    async updateProfileFromGraph(id, data, audit) {
      const user = users.find((u) => u.id === id);
      Object.assign(user, data);
      if ('companyId' in data) user.company = companies.find((c) => c.id === data.companyId);
      if ('departmentId' in data) {
        const d = departments.find((x) => x.id === data.departmentId);
        user.department = d ? { nameEn: d.nameEn, nameAr: d.nameAr } : null;
      }
      await audit(auditTx);
    },

    async hasRealHoldingAdmin(standInPrefix) {
      return users.some(
        (u) =>
          u.isActive &&
          !u.entraObjectId.startsWith(standInPrefix) &&
          u.roles.some((r) => r.role === ROLES.HOLDING_ADMIN && r.scopeCompanyId === null)
      );
    },

    async grantHoldingAdmin(userId, audit) {
      const user = users.find((u) => u.id === userId);
      if (user.roles.some((r) => r.role === ROLES.HOLDING_ADMIN && r.scopeCompanyId === null)) {
        return false;
      }
      const assignment = {
        id: randomUUID(),
        userId,
        role: ROLES.HOLDING_ADMIN,
        scopeCompanyId: null,
      };
      user.roles.push({ id: assignment.id, role: assignment.role, scopeCompanyId: null });
      await audit(auditTx, assignment);
      return true;
    },
  };
}
