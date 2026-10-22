/**
 * store-prisma.js — the helpdesk's companies and their mail domains in SQL
 * Server. `transaction(fn)` hands fn a store bound to one transaction, which
 * lib/audit.js writes the audit row through (`auditLog`).
 *
 * Company.domain is the main domain (the first in the list); CompanyDomain
 * holds every one, the main one included, and keeps each unique across
 * companies.
 */

import { getPrisma } from '@mg/shared/server/lib/prisma.js';
import { withWriteRetry } from '@mg/shared/server/lib/retry.js';

import { ensureDefaults } from './defaults.js';

const INCLUDE = {
  domains: { select: { domain: true, createdAt: true } },
  _count: { select: { users: { where: { isActive: true } } } },
};

/** The company as the API returns it: the main domain first. */
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
    isActive: row.isActive,
    userCount: row._count?.users ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function bind(db) {
  return {
    auditLog: db.auditLog,

    /** The IT helpdesk's reference data, when missing and not from the portal (defaults.js). */
    ensureHelpdeskDefaults: (req) => ensureDefaults(db, { req }),

    async listCompanies() {
      const rows = await db.company.findMany({ include: INCLUDE, orderBy: { code: 'asc' } });
      return rows.map(companyView);
    },

    async getCompany(id) {
      const row = await db.company.findUnique({ where: { id }, include: INCLUDE });
      return row ? companyView(row) : null;
    },

    async getCompanyByCode(code) {
      const row = await db.company.findUnique({ where: { code }, include: INCLUDE });
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
        include: INCLUDE,
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
  };
}

export function createPrismaCompanyStore() {
  const outside =
    (name) =>
    async (...args) => {
      const ops = bind(await getPrisma());
      return ops[name](...args);
    };
  return {
    listCompanies: outside('listCompanies'),
    getCompany: outside('getCompany'),
    transaction: (fn) =>
      withWriteRetry(async () => {
        const db = await getPrisma();
        return db.$transaction((tx) => fn(bind(tx)), { timeout: 15_000 });
      }),
  };
}
