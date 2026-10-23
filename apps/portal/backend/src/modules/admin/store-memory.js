/**
 * store-memory.js — store-prisma.js's interface over the in-memory user repo
 * (modules/auth/repo-memory.js): the same companies, departments, users and
 * roles that sign-in reads, so a change made through the admin module is seen
 * by the next request. Used by the tests and by `npm run dev` while no SQL
 * Server is configured. Never used in production.
 *
 * It mirrors what the database enforces, because the rules under test depend
 * on it: unique company code and domain, unique department names per company.
 */

import { randomUUID } from 'node:crypto';

import { ROLES } from '@mg/shared/server/lib/roles.js';

const ADMIN_ROLES = new Set([ROLES.HOLDING_ADMIN, ROLES.COMPANY_ADMIN]);

class UniqueViolation extends Error {
  constructor(what) {
    super(`Unique constraint failed: ${what}`);
    this.name = 'PrismaClientKnownRequestError';
    this.code = 'P2002';
  }
}

/**
 * @param {ReturnType<import('@mg/shared/server/modules/auth/repo-memory.js').createMemoryUserRepo>} repo
 */
export function createMemoryAdminStore(repo) {
  const { companies, users, departments, auditLogs } = repo;
  const byId = (list, id) => list.find((row) => row.id === id) ?? null;
  const same = (a, b) => new Date(a).getTime() === new Date(b).getTime();
  /** A strictly later timestamp, so two edits in one millisecond still differ. */
  const touch = (row) => {
    const next = Math.max(Date.now(), new Date(row.updatedAt).getTime() + 1);
    row.updatedAt = new Date(next);
  };

  const companyView = (row) => ({
    id: row.id,
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    domains: [...row.domains],
    accentColor: row.accentColor,
    logoUrl: row.logoUrl ?? null,
    logoKey: row.logoKey ?? null,
    showMobileInDirectory: row.showMobileInDirectory === true,
    workdayStartMin: row.workdayStartMin ?? 480,
    workdayEndMin: row.workdayEndMin ?? 1080,
    workingDays: [...(row.workingDays ?? [0, 1, 2, 3, 4])],
    isActive: row.isActive,
    userCount: users.filter((u) => u.companyId === row.id && u.isActive).length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const departmentView = (row) => ({
    id: row.id,
    companyId: row.companyId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    isActive: row.isActive,
    userCount: users.filter((u) => u.departmentId === row.id && u.isActive).length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const personView = (u) => ({
    id: u.id,
    email: u.email,
    displayNameEn: u.displayNameEn,
    displayNameAr: u.displayNameAr,
    jobTitle: u.jobTitle ?? null,
    isActive: u.isActive,
    companyId: u.companyId,
    companyCode: byId(companies, u.companyId).code,
  });

  const allAssignments = () =>
    users.flatMap((user) => user.roles.map((role) => ({ user, ...role })));

  const assignmentView = ({ user, id, role, scopeCompanyId, createdAt }) => ({
    id,
    role,
    scopeCompanyId,
    createdAt: createdAt ?? new Date(0),
    user: personView(user),
  });

  const actorOf = (id) => {
    const u = byId(users, id);
    return u
      ? {
          id: u.id,
          displayNameEn: u.displayNameEn,
          displayNameAr: u.displayNameAr,
          email: u.email,
        }
      : null;
  };

  const auditView = (row, detail = false) => {
    const view = {
      id: row.id,
      at: row.at,
      actor: actorOf(row.actorId),
      companyId: row.companyId,
      companyCode: row.companyId ? (byId(companies, row.companyId)?.code ?? null) : null,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      ip: row.ip,
    };
    if (detail) {
      view.before = row.before ? JSON.parse(row.before) : null;
      view.after = row.after ? JSON.parse(row.after) : null;
    }
    return view;
  };

  const auditMatches = (row, f) => {
    if (f.companyIds) {
      const inCompany = row.companyId && f.companyIds.includes(row.companyId);
      const inHolding = f.includeHolding && row.companyId == null;
      if (!inCompany && !inHolding) return false;
    } else if (f.includeHolding && row.companyId != null) {
      return false;
    }
    if (f.from && row.at < f.from) return false;
    if (f.to && row.at >= f.to) return false;
    if (f.actorId && row.actorId !== f.actorId) return false;
    if (f.action && row.action !== f.action) return false;
    if (f.entity && row.entity !== f.entity) return false;
    return true;
  };

  const newest = (a, b) => b.at - a.at || (a.id < b.id ? 1 : -1);

  const store = {
    /** What lib/audit.js writes to. */
    auditLog: {
      async create({ data }) {
        const row = { id: randomUUID(), at: new Date(), createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      },
    },

    /* ---- companies */
    async listCompanies({ active } = {}) {
      return companies
        .filter((c) => active === undefined || c.isActive === active)
        .sort((a, b) => a.code.localeCompare(b.code))
        .map(companyView);
    },

    async getCompany(id) {
      const row = byId(companies, id);
      return row ? companyView(row) : null;
    },

    async getCompanyByCode(code) {
      const row = companies.find((c) => c.code === code);
      return row ? companyView(row) : null;
    },

    async domainOwners(domains) {
      return companies.flatMap((c) =>
        c.domains
          .filter((d) => domains.includes(d))
          .map((domain) => ({ domain, companyId: c.id }))
      );
    },

    async createCompany({ code, nameEn, nameAr, accentColor, domains }) {
      if (companies.some((c) => c.code === code)) throw new UniqueViolation('code');
      const taken = companies.some((c) => c.domains.some((d) => domains.includes(d)));
      if (taken) throw new UniqueViolation('domain');

      const now = new Date();
      const row = {
        id: randomUUID(),
        code,
        nameEn,
        nameAr,
        accentColor,
        domain: domains[0],
        domains: [...domains],
        logoUrl: null,
        logoKey: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      companies.push(row);
      return companyView(row);
    },

    async updateCompany(id, patch, expectedUpdatedAt) {
      const row = byId(companies, id);
      if (!row || !same(row.updatedAt, expectedUpdatedAt)) return null;

      const { domains, ...columns } = patch;
      if (domains) {
        const clash = companies.some(
          (c) => c.id !== id && c.domains.some((d) => domains.includes(d))
        );
        if (clash) throw new UniqueViolation('domain');
        row.domains = [...domains];
        row.domain = domains[0];
      }
      Object.assign(row, columns);
      touch(row);
      return companyView(row);
    },

    /* ---- departments */
    async listDepartments(companyId, { active } = {}) {
      return departments
        .filter(
          (d) => d.companyId === companyId && (active === undefined || d.isActive === active)
        )
        .sort((a, b) => a.nameEn.localeCompare(b.nameEn))
        .map(departmentView);
    },

    async getDepartment(id) {
      const row = byId(departments, id);
      return row ? departmentView(row) : null;
    },

    async departmentNameTaken(companyId, { nameEn, nameAr }, exceptId = null) {
      for (const d of departments) {
        if (d.companyId !== companyId || d.id === exceptId) continue;
        if (nameEn && d.nameEn === nameEn) return 'nameEn';
        if (nameAr && d.nameAr === nameAr) return 'nameAr';
      }
      return null;
    },

    async createDepartment({ companyId, nameEn, nameAr }) {
      const now = new Date();
      const row = {
        id: randomUUID(),
        companyId,
        nameEn,
        nameAr,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      departments.push(row);
      return departmentView(row);
    },

    async updateDepartment(id, patch, expectedUpdatedAt) {
      const row = byId(departments, id);
      if (!row || !same(row.updatedAt, expectedUpdatedAt)) return null;
      Object.assign(row, patch);
      touch(row);
      return departmentView(row);
    },

    /* ---- role assignments */
    async listAssignments() {
      return allAssignments()
        .filter((a) => ADMIN_ROLES.has(a.role))
        .map(assignmentView);
    },

    async getAssignment(id) {
      const found = allAssignments().find((a) => a.id === id && ADMIN_ROLES.has(a.role));
      return found ? assignmentView(found) : null;
    },

    async findAssignment(userId, role, scopeCompanyId) {
      const user = byId(users, userId);
      const found = user?.roles.find(
        (r) => r.role === role && (r.scopeCompanyId ?? null) === (scopeCompanyId ?? null)
      );
      return found ? { id: found.id } : null;
    },

    async createAssignment({ userId, role, scopeCompanyId }) {
      const user = byId(users, userId);
      const row = { id: randomUUID(), role, scopeCompanyId, createdAt: new Date() };
      user.roles.push(row);
      return assignmentView({ user, ...row });
    },

    async deleteAssignment(id) {
      for (const user of users) {
        const index = user.roles.findIndex((r) => r.id === id);
        if (index !== -1) user.roles.splice(index, 1);
      }
    },

    async countOtherActiveHoldingAdmins(exceptId) {
      return allAssignments().filter(
        (a) =>
          a.id !== exceptId &&
          a.role === ROLES.HOLDING_ADMIN &&
          a.scopeCompanyId == null &&
          a.user.isActive &&
          byId(companies, a.user.companyId)?.isActive
      ).length;
    },

    /* ---- people */
    async getUser(id) {
      const user = byId(users, id);
      return user ? personView(user) : null;
    },

    async searchUsers(q, limit = 15) {
      const needle = q.toLowerCase();
      return users
        .filter(
          (u) =>
            u.isActive &&
            [u.displayNameEn.toLowerCase(), u.displayNameAr, u.email.toLowerCase()].some((v) =>
              v.includes(needle)
            )
        )
        .sort((a, b) => a.displayNameEn.localeCompare(b.displayNameEn))
        .slice(0, limit)
        .map(personView);
    },

    /* ---- audit log */
    async queryAudit(filter, { skip, take }) {
      const matching = auditLogs.filter((r) => auditMatches(r, filter)).sort(newest);
      return {
        total: matching.length,
        items: matching.slice(skip, skip + take).map((r) => auditView(r)),
      };
    },

    async exportAudit(filter, { take }) {
      return auditLogs
        .filter((r) => auditMatches(r, filter))
        .sort(newest)
        .slice(0, take)
        .map((r) => ({ ...auditView(r), before: r.before ?? null, after: r.after ?? null }));
    },

    async getAudit(id) {
      const row = byId(auditLogs, id);
      return row ? auditView(row, true) : null;
    },

    async auditFacets(scope) {
      const rows = auditLogs.filter((r) => auditMatches(r, scope));
      const unique = (values) => [...new Set(values)].sort();
      const actorIds = unique(rows.map((r) => r.actorId).filter(Boolean));
      return {
        actions: unique(rows.map((r) => r.action)),
        entities: unique(rows.map((r) => r.entity)),
        actors: actorIds
          .map(actorOf)
          .filter(Boolean)
          .sort((a, b) => a.displayNameEn.localeCompare(b.displayNameEn)),
      };
    },
  };

  /** Nothing to roll back here: the writes are the last thing a service does. */
  return { ...store, transaction: (fn) => fn(store) };
}
