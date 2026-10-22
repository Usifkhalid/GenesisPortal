/**
 * store-memory.js — store-prisma.js's interface over the in-memory user repo
 * (modules/auth/repo-memory.js), so a company or domain changed here is the
 * one the next sign-in reads. Used by the tests and by `npm run dev` while no
 * SQL Server is configured; never in production. It mirrors what the
 * database enforces: a unique company code and a unique domain.
 */

import { randomUUID } from 'node:crypto';

class UniqueViolation extends Error {
  constructor(what) {
    super(`Unique constraint failed: ${what}`);
    this.name = 'PrismaClientKnownRequestError';
    this.code = 'P2002';
  }
}

/** @param {ReturnType<import('@mg/shared/server/modules/auth/repo-memory.js').createMemoryUserRepo>} repo */
export function createMemoryCompanyStore(repo) {
  const { companies, users, auditLogs } = repo;
  const same = (a, b) => new Date(a).getTime() === new Date(b).getTime();
  /** A strictly later timestamp, so two edits in one millisecond still differ. */
  const touch = (row) => {
    row.updatedAt = new Date(Math.max(Date.now(), new Date(row.updatedAt).getTime() + 1));
  };

  const companyView = (row) => ({
    id: row.id,
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    domains: [...row.domains],
    accentColor: row.accentColor,
    isActive: row.isActive,
    userCount: users.filter((u) => u.companyId === row.id && u.isActive).length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const store = {
    auditLog: {
      async create({ data }) {
        const row = { id: randomUUID(), at: new Date(), createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      },
    },

    /** The memory repo already holds the seeded IT team (seed-data.js). */
    async ensureHelpdeskDefaults() {},

    async listCompanies() {
      return [...companies].sort((a, b) => a.code.localeCompare(b.code)).map(companyView);
    },

    async getCompany(id) {
      const row = companies.find((c) => c.id === id);
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
      if (companies.some((c) => c.domains.some((d) => domains.includes(d)))) {
        throw new UniqueViolation('domain');
      }
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
        showMobileInDirectory: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      companies.push(row);
      return companyView(row);
    },

    async updateCompany(id, patch, expectedUpdatedAt) {
      const row = companies.find((c) => c.id === id);
      if (!row || !same(row.updatedAt, expectedUpdatedAt)) return null;
      const { domains, ...columns } = patch;
      if (domains) {
        const clash = companies.some(
          (c) => c.id !== id && c.domains.some((d) => domains.includes(d))
        );
        if (clash) throw new UniqueViolation('domain');
        row.domain = domains[0];
        row.domains = [...domains];
      }
      Object.assign(row, columns);
      touch(row);
      return companyView(row);
    },
  };

  /** Nothing to roll back here: the writes are the last thing a service does. */
  return { ...store, transaction: (fn) => fn(store) };
}
