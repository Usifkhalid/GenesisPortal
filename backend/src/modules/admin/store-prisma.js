/**
 * store-prisma.js — the admin module's reads and writes over Prisma.
 *
 * The service holds the rules; the store holds the queries, so the same rules
 * run over this and over store-memory.js (tests, and development without SQL
 * Server). Every method here takes ids the service has already scoped.
 *
 * `transaction(fn)` hands fn a store bound to one Prisma transaction. The
 * service writes the change and its audit row through it, so they commit or
 * roll back together. `auditLog` on the store is what lib/audit.js writes to.
 */

import { getPrisma } from '../../lib/prisma.js';
import { ROLES } from '../../lib/roles.js';

const ADMIN_ROLES = [ROLES.HOLDING_ADMIN, ROLES.COMPANY_ADMIN];

const ACTIVE_USERS = { where: { isActive: true } };

function companyView(row) {
  const rest = row.domains
    .filter((d) => d.domain !== row.domain)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((d) => d.domain);
  return {
    id: row.id,
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    domains: [row.domain, ...rest],
    accentColor: row.accentColor,
    logoUrl: row.logoUrl,
    logoKey: row.logoKey,
    showMobileInDirectory: row.showMobileInDirectory,
    isActive: row.isActive,
    userCount: row._count?.users ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const COMPANY_INCLUDE = {
  domains: { select: { domain: true, createdAt: true } },
  _count: { select: { users: ACTIVE_USERS } },
};

function departmentView(row) {
  return {
    id: row.id,
    companyId: row.companyId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    isActive: row.isActive,
    userCount: row._count?.users ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const DEPARTMENT_INCLUDE = { _count: { select: { users: ACTIVE_USERS } } };

const PERSON = {
  id: true,
  email: true,
  displayNameEn: true,
  displayNameAr: true,
  jobTitle: true,
  isActive: true,
  companyId: true,
  company: { select: { code: true } },
};

function personView(row) {
  return {
    id: row.id,
    email: row.email,
    displayNameEn: row.displayNameEn,
    displayNameAr: row.displayNameAr,
    jobTitle: row.jobTitle ?? null,
    isActive: row.isActive,
    companyId: row.companyId,
    companyCode: row.company.code,
  };
}

function assignmentView(row) {
  return {
    id: row.id,
    role: row.role,
    scopeCompanyId: row.scopeCompanyId,
    createdAt: row.createdAt,
    user: personView(row.user),
  };
}

const ASSIGNMENT_INCLUDE = { user: { select: PERSON } };

function auditView(row, { detail = false } = {}) {
  const view = {
    id: row.id,
    at: row.at,
    actor: row.actor
      ? {
          id: row.actor.id,
          displayNameEn: row.actor.displayNameEn,
          displayNameAr: row.actor.displayNameAr,
          email: row.actor.email,
        }
      : null,
    companyId: row.companyId,
    companyCode: row.company?.code ?? null,
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
}

const AUDIT_INCLUDE = {
  actor: { select: { id: true, displayNameEn: true, displayNameAr: true, email: true } },
  company: { select: { code: true } },
};

/** The Prisma `where` for an audit filter the service has already scoped. */
function auditWhere(filter) {
  const and = [];
  if (filter.companyIds) {
    const clauses = [{ companyId: { in: filter.companyIds } }];
    if (filter.includeHolding) clauses.push({ companyId: null });
    and.push({ OR: clauses });
  } else if (filter.includeHolding) {
    and.push({ companyId: null });
  }
  if (filter.from || filter.to) {
    and.push({
      at: {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lt: filter.to } : {}),
      },
    });
  }
  if (filter.actorId) and.push({ actorId: filter.actorId });
  if (filter.action) and.push({ action: filter.action });
  if (filter.entity) and.push({ entity: filter.entity });
  return and.length ? { AND: and } : {};
}

/** @param {import('@prisma/client').PrismaClient} db */
function bind(db) {
  return {
    auditLog: db.auditLog,

    /* ---- companies */
    async listCompanies({ active } = {}) {
      const rows = await db.company.findMany({
        where: active === undefined ? {} : { isActive: active },
        include: COMPANY_INCLUDE,
        orderBy: { code: 'asc' },
      });
      return rows.map(companyView);
    },

    async getCompany(id) {
      const row = await db.company.findUnique({ where: { id }, include: COMPANY_INCLUDE });
      return row ? companyView(row) : null;
    },

    async getCompanyByCode(code) {
      const row = await db.company.findUnique({ where: { code }, include: COMPANY_INCLUDE });
      return row ? companyView(row) : null;
    },

    async domainOwners(domains) {
      return db.companyDomain.findMany({
        where: { domain: { in: domains } },
        select: { domain: true, companyId: true },
      });
    },

    async createCompany({ code, nameEn, nameAr, accentColor, domains }) {
      const row = await db.company.create({
        data: {
          code,
          nameEn,
          nameAr,
          accentColor,
          domain: domains[0],
          domains: { create: domains.map((domain) => ({ domain })) },
        },
        include: COMPANY_INCLUDE,
      });
      return companyView(row);
    },

    /**
     * Applies `patch`, but only if the row is still at `expectedUpdatedAt`.
     * @returns {Promise<object | null>} the new view, or null when it changed
     */
    async updateCompany(id, patch, expectedUpdatedAt) {
      const { domains, ...columns } = patch;
      const data = { ...columns };
      if (domains) data.domain = domains[0];

      const { count } = await db.company.updateMany({
        where: { id, updatedAt: expectedUpdatedAt },
        data,
      });
      if (count === 0) return null;

      if (domains) {
        await db.companyDomain.deleteMany({
          where: { companyId: id, domain: { notIn: domains } },
        });
        const have = await db.companyDomain.findMany({
          where: { companyId: id },
          select: { domain: true },
        });
        const present = new Set(have.map((d) => d.domain));
        const missing = domains.filter((d) => !present.has(d));
        if (missing.length) {
          await db.companyDomain.createMany({
            data: missing.map((domain) => ({ companyId: id, domain })),
          });
        }
      }
      return this.getCompany(id);
    },

    /* ---- departments */
    async listDepartments(companyId, { active } = {}) {
      const rows = await db.department.findMany({
        where: { companyId, ...(active === undefined ? {} : { isActive: active }) },
        include: DEPARTMENT_INCLUDE,
        orderBy: { nameEn: 'asc' },
      });
      return rows.map(departmentView);
    },

    async getDepartment(id) {
      const row = await db.department.findUnique({
        where: { id },
        include: DEPARTMENT_INCLUDE,
      });
      return row ? departmentView(row) : null;
    },

    /** Which of the two names another department of the company already has. */
    async departmentNameTaken(companyId, { nameEn, nameAr }, exceptId = null) {
      const names = [...(nameEn ? [{ nameEn }] : []), ...(nameAr ? [{ nameAr }] : [])];
      if (names.length === 0) return null;

      const clash = await db.department.findFirst({
        where: { companyId, ...(exceptId ? { id: { not: exceptId } } : {}), OR: names },
        select: { nameEn: true, nameAr: true },
      });
      if (!clash) return null;
      return nameEn && clash.nameEn === nameEn ? 'nameEn' : 'nameAr';
    },

    async createDepartment(data) {
      const row = await db.department.create({ data, include: DEPARTMENT_INCLUDE });
      return departmentView(row);
    },

    async updateDepartment(id, patch, expectedUpdatedAt) {
      const { count } = await db.department.updateMany({
        where: { id, updatedAt: expectedUpdatedAt },
        data: patch,
      });
      return count === 0 ? null : this.getDepartment(id);
    },

    /* ---- role assignments */
    async listAssignments() {
      const rows = await db.roleAssignment.findMany({
        where: { role: { in: ADMIN_ROLES } },
        include: ASSIGNMENT_INCLUDE,
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(assignmentView);
    },

    async getAssignment(id) {
      const row = await db.roleAssignment.findUnique({
        where: { id },
        include: ASSIGNMENT_INCLUDE,
      });
      return row && ADMIN_ROLES.includes(row.role) ? assignmentView(row) : null;
    },

    async findAssignment(userId, role, scopeCompanyId) {
      return db.roleAssignment.findFirst({
        where: { userId, role, scopeCompanyId },
        select: { id: true },
      });
    },

    async createAssignment({ userId, role, scopeCompanyId }) {
      const row = await db.roleAssignment.create({
        data: { userId, role, scopeCompanyId },
        include: ASSIGNMENT_INCLUDE,
      });
      return assignmentView(row);
    },

    async deleteAssignment(id) {
      await db.roleAssignment.delete({ where: { id } });
    },

    /** Active holding admins through an assignment other than `exceptId`. */
    async countOtherActiveHoldingAdmins(exceptId) {
      return db.roleAssignment.count({
        where: {
          id: { not: exceptId },
          role: ROLES.HOLDING_ADMIN,
          scopeCompanyId: null,
          user: { isActive: true, company: { isActive: true } },
        },
      });
    },

    /* ---- people */
    async getUser(id) {
      const row = await db.userProfile.findUnique({ where: { id }, select: PERSON });
      return row ? personView(row) : null;
    },

    async searchUsers(q, limit = 15) {
      const rows = await db.userProfile.findMany({
        where: {
          isActive: true,
          OR: [
            { displayNameEn: { contains: q } },
            { displayNameAr: { contains: q } },
            { email: { contains: q } },
          ],
        },
        select: PERSON,
        orderBy: { displayNameEn: 'asc' },
        take: limit,
      });
      return rows.map(personView);
    },

    /* ---- audit log (reads only: writes go through lib/audit.js) */
    async queryAudit(filter, { skip, take }) {
      const where = auditWhere(filter);
      const [total, rows] = await Promise.all([
        db.auditLog.count({ where }),
        db.auditLog.findMany({
          where,
          include: AUDIT_INCLUDE,
          orderBy: [{ at: 'desc' }, { id: 'desc' }],
          skip,
          take,
        }),
      ]);
      return { total, items: rows.map((r) => auditView(r)) };
    },

    /** Matching rows with before and after as stored, for the CSV. */
    async exportAudit(filter, { take }) {
      const rows = await db.auditLog.findMany({
        where: auditWhere(filter),
        include: AUDIT_INCLUDE,
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take,
      });
      return rows.map((r) => ({ ...auditView(r), before: r.before, after: r.after }));
    },

    async getAudit(id) {
      const row = await db.auditLog.findUnique({ where: { id }, include: AUDIT_INCLUDE });
      return row ? auditView(row, { detail: true }) : null;
    },

    async auditFacets(scope) {
      const where = auditWhere(scope);
      const [actions, entities, actorIds] = await Promise.all([
        db.auditLog.groupBy({ by: ['action'], where, orderBy: { action: 'asc' } }),
        db.auditLog.groupBy({ by: ['entity'], where, orderBy: { entity: 'asc' } }),
        db.auditLog.groupBy({ by: ['actorId'], where, orderBy: { actorId: 'asc' } }),
      ]);
      const ids = actorIds.map((a) => a.actorId).filter(Boolean);
      const actors = ids.length
        ? await db.userProfile.findMany({
            where: { id: { in: ids } },
            select: { id: true, displayNameEn: true, displayNameAr: true, email: true },
            orderBy: { displayNameEn: 'asc' },
          })
        : [];
      return {
        actions: actions.map((a) => a.action),
        entities: entities.map((e) => e.entity),
        actors,
      };
    },
  };
}

/** The method names, for building the unbound (outside a transaction) store. */
const METHODS = Object.keys(bind({ auditLog: null })).filter((name) => name !== 'auditLog');

const RETRIES = 6;

/**
 * SQL Server picks a victim when two sessions deadlock, and Prisma reports it
 * as P2034. The victim's work was rolled back whole, so running it again is
 * safe; a few short, jittered tries absorb two admins saving at once.
 */
async function withRetry(run) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      if (err?.code !== 'P2034' || attempt >= RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.random() * 120));
    }
  }
}

export function createPrismaAdminStore() {
  const reads = Object.fromEntries(
    METHODS.map((name) => [
      name,
      (...args) =>
        withRetry(async () => {
          const ops = bind(await getPrisma());
          return ops[name](...args);
        }),
    ])
  );

  return {
    ...reads,
    transaction: (fn) =>
      withRetry(async () => {
        const db = await getPrisma();
        return db.$transaction((tx) => fn(bind(tx)), { timeout: 15_000 });
      }),
  };
}
