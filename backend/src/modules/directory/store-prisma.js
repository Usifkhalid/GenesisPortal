/**
 * store-prisma.js — the directory module's reads and writes over Prisma.
 *
 * The service holds the rules; the store holds the queries, so the same rules
 * run over this and over store-memory.js. Every method takes ids and company
 * lists the service has already scoped from req.user.
 *
 * `transaction(fn)` hands fn a store bound to one Prisma transaction, which
 * also carries `auditLog` for lib/audit.js. Sync's bulk writes are not one
 * transaction (a run touches thousands of rows and is idempotent); they go in
 * batches, and the run's result and audit row are the one that is.
 */

import { getPrisma } from '../../lib/prisma.js';
import { ROLES } from '../../lib/roles.js';

const BATCH = 50;

const USER_SELECT = {
  id: true,
  email: true,
  displayNameEn: true,
  displayNameAr: true,
  jobTitle: true,
  officeLocation: true,
  phone: true,
  mobilePhone: true,
  companyId: true,
  departmentId: true,
  managerId: true,
  isActive: true,
  graphDepartment: true,
  graphCompanyName: true,
  company: {
    select: { id: true, code: true, nameEn: true, nameAr: true, showMobileInDirectory: true },
  },
  department: { select: { id: true, nameEn: true, nameAr: true } },
};

function parseWarnings(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function runView(row) {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    created: row.created,
    updated: row.updated,
    deactivated: row.deactivated,
    warnings: parseWarnings(row.warnings),
    requestedBy: row.requestedBy
      ? {
          id: row.requestedBy.id,
          displayNameEn: row.requestedBy.displayNameEn,
          displayNameAr: row.requestedBy.displayNameAr,
        }
      : null,
  };
}

const RUN_INCLUDE = {
  requestedBy: { select: { id: true, displayNameEn: true, displayNameAr: true } },
};

/** @param {import('@prisma/client').PrismaClient} db */
function operations(db) {
  const inScope = (companyIds) => (companyIds ? [{ companyId: { in: companyIds } }] : []);

  return {
    /** What lib/audit.js writes to. */
    auditLog: db.auditLog,

    /* ---- reading */
    async searchCandidates({ companyIds, companyId, departmentId, tokens }) {
      return db.userProfile.findMany({
        where: {
          AND: [
            { isActive: true },
            ...inScope(companyIds),
            ...(companyId ? [{ companyId }] : []),
            ...(departmentId ? [{ departmentId }] : []),
            ...tokens.map((token) => ({ searchKey: { contains: token } })),
          ],
        },
        select: { id: true, displayNameEn: true, displayNameAr: true },
      });
    },

    async getUsers(ids) {
      if (ids.length === 0) return [];
      return db.userProfile.findMany({ where: { id: { in: ids } }, select: USER_SELECT });
    },

    async getUser(id) {
      return db.userProfile.findUnique({ where: { id }, select: USER_SELECT });
    },

    async listReports(managerId) {
      return db.userProfile.findMany({
        where: { managerId, isActive: true },
        select: USER_SELECT,
      });
    },

    async listCompanies(ids) {
      return db.company.findMany({
        where: { isActive: true, ...(ids ? { id: { in: ids } } : {}) },
        select: { id: true, code: true, nameEn: true, nameAr: true },
        orderBy: { code: 'asc' },
      });
    },

    async listDepartments(companyIds) {
      if (companyIds.length === 0) return [];
      return db.department.findMany({
        where: { isActive: true, companyId: { in: companyIds } },
        select: { id: true, companyId: true, nameEn: true, nameAr: true },
        orderBy: { nameEn: 'asc' },
      });
    },

    async listActiveUsers(companyIds) {
      if (companyIds.length === 0) return [];
      return db.userProfile.findMany({
        where: { isActive: true, companyId: { in: companyIds } },
        select: USER_SELECT,
        orderBy: { displayNameEn: 'asc' },
      });
    },

    /* ---- sync runs */
    async findRunningRun(since) {
      return db.syncRun.findFirst({
        where: { status: 'running', startedAt: { gte: since } },
        select: { id: true },
      });
    },

    async createRun({ source, requestedById, startedAt }) {
      const row = await db.syncRun.create({
        data: { status: 'running', source, requestedById, startedAt },
        include: RUN_INCLUDE,
      });
      return runView(row);
    },

    async finishRun(id, result) {
      const row = await db.syncRun.update({
        where: { id },
        data: {
          status: result.status,
          finishedAt: result.finishedAt,
          created: result.created,
          updated: result.updated,
          deactivated: result.deactivated,
          warnings: JSON.stringify(result.warnings),
        },
        include: RUN_INCLUDE,
      });
      return runView(row);
    },

    async listRuns(limit) {
      const rows = await db.syncRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: limit,
        include: RUN_INCLUDE,
      });
      return rows.map(runView);
    },

    /* ---- sync */
    async loadSyncState() {
      const [companies, departments, users] = await Promise.all([
        db.company.findMany({
          select: { id: true, code: true, nameEn: true, nameAr: true, domains: true },
        }),
        db.department.findMany({
          select: { id: true, companyId: true, nameEn: true, nameAr: true },
        }),
        db.userProfile.findMany({
          select: {
            id: true,
            entraObjectId: true,
            email: true,
            companyId: true,
            departmentId: true,
            managerId: true,
            displayNameEn: true,
            displayNameAr: true,
            jobTitle: true,
            officeLocation: true,
            phone: true,
            mobilePhone: true,
            graphDepartment: true,
            graphCompanyName: true,
            isActive: true,
          },
        }),
      ]);
      return {
        companies: companies.map(({ domains, ...c }) => ({
          ...c,
          domains: domains.map((d) => d.domain),
        })),
        departments,
        users,
      };
    },

    async applySyncChanges(plan) {
      const run = async (statements) => {
        for (let i = 0; i < statements.length; i += BATCH) {
          await db.$transaction(statements.slice(i, i + BATCH));
        }
      };

      await run(
        plan.creates.map(({ data }) =>
          db.userProfile.create({
            data: {
              ...data,
              displayNameAr: '',
              roleAssignments: {
                create: { role: ROLES.USER, scopeCompanyId: data.companyId },
              },
            },
          })
        )
      );

      await run(
        plan.updates.map(({ id, data }) => db.userProfile.update({ where: { id }, data }))
      );

      if (plan.managerLinks.length > 0) {
        const rows = await db.userProfile.findMany({
          select: { id: true, entraObjectId: true },
        });
        const idOf = new Map(rows.map((r) => [r.entraObjectId, r.id]));
        await run(
          plan.managerLinks
            .filter((l) => idOf.has(l.entraObjectId))
            .map((l) =>
              db.userProfile.update({
                where: { id: idOf.get(l.entraObjectId) },
                data: {
                  managerId: l.managerEntraObjectId
                    ? (idOf.get(l.managerEntraObjectId) ?? null)
                    : null,
                },
              })
            )
        );
      }
    },
  };
}

export function createPrismaDirectoryStore() {
  const names = Object.keys(operations(/** @type {any} */ ({}))).filter(
    (name) => name !== 'auditLog'
  );

  const reads = Object.fromEntries(
    names.map((name) => [name, async (...args) => operations(await getPrisma())[name](...args)])
  );

  return {
    ...reads,
    transaction: async (fn) => {
      const db = await getPrisma();
      return db.$transaction((tx) => fn(operations(tx)), { timeout: 15_000 });
    },
  };
}
