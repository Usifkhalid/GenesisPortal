/**
 * store-memory.js — store-prisma.js's interface over the in-memory user repo
 * (modules/auth/repo-memory.js): the same companies, departments and users
 * that sign-in reads, so a sync run is seen by the next request. Used by the
 * tests and by `npm run dev` while no SQL Server is configured. Never used in
 * production.
 */

import { randomUUID } from 'node:crypto';

import { ROLES } from '../../lib/roles.js';

/** @param {ReturnType<import('../auth/repo-memory.js').createMemoryUserRepo>} repo */
export function createMemoryDirectoryStore(repo) {
  const { companies, users, departments, auditLogs, syncRuns } = repo;
  const byId = (list, id) => list.find((row) => row.id === id) ?? null;

  const view = (u) => {
    const company = byId(companies, u.companyId);
    const department = u.departmentId ? byId(departments, u.departmentId) : null;
    return {
      id: u.id,
      email: u.email,
      displayNameEn: u.displayNameEn,
      displayNameAr: u.displayNameAr,
      jobTitle: u.jobTitle ?? null,
      officeLocation: u.officeLocation ?? null,
      phone: u.phone ?? null,
      mobilePhone: u.mobilePhone ?? null,
      companyId: u.companyId,
      departmentId: u.departmentId ?? null,
      managerId: u.managerId ?? null,
      isActive: u.isActive,
      graphDepartment: u.graphDepartment ?? null,
      graphCompanyName: u.graphCompanyName ?? null,
      company: {
        id: company.id,
        code: company.code,
        nameEn: company.nameEn,
        nameAr: company.nameAr,
        showMobileInDirectory: company.showMobileInDirectory === true,
      },
      department: department
        ? { id: department.id, nameEn: department.nameEn, nameAr: department.nameAr }
        : null,
    };
  };

  const hrPerson = (u) => ({
    id: u.id,
    email: u.email,
    displayNameEn: u.displayNameEn,
    displayNameAr: u.displayNameAr ?? '',
    companyId: u.companyId,
    departmentId: u.departmentId ?? null,
    jobTitle: u.jobTitle ?? null,
    officeLocation: u.officeLocation ?? null,
    staffId: u.staffId ?? null,
    employmentCategory: u.employmentCategory ?? null,
    hireDate: u.hireDate ?? null,
    hrFields: u.hrFields ?? null,
    isActive: u.isActive,
  });

  const requesterOf = (id) => {
    const u = id ? byId(users, id) : null;
    return u
      ? { id: u.id, displayNameEn: u.displayNameEn, displayNameAr: u.displayNameAr }
      : null;
  };

  const runView = (row) => ({
    id: row.id,
    status: row.status,
    source: row.source,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    created: row.created,
    updated: row.updated,
    deactivated: row.deactivated,
    warnings: structuredClone(row.warnings),
    requestedBy: requesterOf(row.requestedById),
  });

  const store = {
    /** What lib/audit.js writes to. */
    auditLog: {
      async create({ data }) {
        const row = { id: randomUUID(), at: new Date(), createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      },
    },

    /* ---- reading */
    async searchCandidates({ companyIds, companyId, departmentId, tokens }) {
      return users
        .filter(
          (u) =>
            u.isActive &&
            (!companyIds || companyIds.includes(u.companyId)) &&
            (!companyId || u.companyId === companyId) &&
            (!departmentId || u.departmentId === departmentId) &&
            tokens.every((token) => (u.searchKey ?? '').includes(token))
        )
        .map((u) => ({
          id: u.id,
          displayNameEn: u.displayNameEn,
          displayNameAr: u.displayNameAr,
        }));
    },

    async getUsers(ids) {
      return ids
        .map((id) => byId(users, id))
        .filter(Boolean)
        .map(view);
    },

    async getUser(id) {
      const u = byId(users, id);
      return u ? view(u) : null;
    },

    async listReports(managerId) {
      return users.filter((u) => u.managerId === managerId && u.isActive).map(view);
    },

    async listCompanies(ids) {
      return companies
        .filter((c) => c.isActive && (!ids || ids.includes(c.id)))
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((c) => ({ id: c.id, code: c.code, nameEn: c.nameEn, nameAr: c.nameAr }));
    },

    async listDepartments(companyIds) {
      return departments
        .filter((d) => d.isActive && companyIds.includes(d.companyId))
        .sort((a, b) => a.nameEn.localeCompare(b.nameEn))
        .map((d) => ({
          id: d.id,
          companyId: d.companyId,
          nameEn: d.nameEn,
          nameAr: d.nameAr,
        }));
    },

    async listActiveUsers(companyIds) {
      return users
        .filter((u) => u.isActive && companyIds.includes(u.companyId))
        .sort((a, b) => a.displayNameEn.localeCompare(b.displayNameEn))
        .map(view);
    },

    /* ---- Arabic names */
    async findUsersByEmails(emails) {
      const wanted = new Set(emails);
      return users.filter((u) => wanted.has(u.email.toLowerCase())).map(view);
    },

    async setArabicName(id, displayNameAr, searchKey) {
      Object.assign(byId(users, id), { displayNameAr, searchKey });
    },

    /* ---- HR import (hr-import.js) */
    async loadHrImportState() {
      return {
        companies: companies.map((c) => ({ id: c.id, code: c.code })),
        departments: departments.map((d) => ({
          id: d.id,
          companyId: d.companyId,
          nameEn: d.nameEn,
          nameAr: d.nameAr,
        })),
        users: users.map((u) => hrPerson(u)),
      };
    },

    async findHoldingAdminByEmail(email) {
      const u = users.find(
        (x) =>
          x.isActive &&
          x.email.toLowerCase() === String(email ?? '').toLowerCase() &&
          x.roles.some((r) => r.role === ROLES.HOLDING_ADMIN && r.scopeCompanyId == null)
      );
      return u ? { id: u.id, email: u.email } : null;
    },

    async createDepartment({ companyId, nameEn, nameAr }) {
      const row = { id: randomUUID(), companyId, nameEn, nameAr, isActive: true };
      departments.push(row);
      return row;
    },

    async updateHrProfile(id, data, { fromCompanyId, toCompanyId } = {}) {
      const u = byId(users, id);
      if (toCompanyId && toCompanyId !== fromCompanyId) {
        const there = u.roles.some(
          (r) => r.role === ROLES.USER && r.scopeCompanyId === toCompanyId
        );
        u.roles = u.roles
          .filter(
            (r) => !(there && r.role === ROLES.USER && r.scopeCompanyId === fromCompanyId)
          )
          .map((r) =>
            r.role === ROLES.USER && r.scopeCompanyId === fromCompanyId
              ? { ...r, scopeCompanyId: toCompanyId }
              : r
          );
      }
      Object.assign(u, data);
      if ('companyId' in data) u.company = byId(companies, data.companyId);
      if ('departmentId' in data) {
        const dept = data.departmentId ? byId(departments, data.departmentId) : null;
        u.department = dept ? { nameEn: dept.nameEn, nameAr: dept.nameAr } : null;
      }
      return hrPerson(u);
    },

    /* ---- sync runs */
    async findRunningRun(since) {
      const found = syncRuns.find((r) => r.status === 'running' && r.startedAt >= since);
      return found ? { id: found.id } : null;
    },

    async createRun({ source, requestedById, startedAt }) {
      const row = {
        id: randomUUID(),
        status: 'running',
        source,
        requestedById,
        startedAt,
        finishedAt: null,
        created: 0,
        updated: 0,
        deactivated: 0,
        warnings: [],
      };
      syncRuns.push(row);
      return runView(row);
    },

    async finishRun(id, result) {
      const row = byId(syncRuns, id);
      Object.assign(row, {
        status: result.status,
        finishedAt: result.finishedAt,
        created: result.created,
        updated: result.updated,
        deactivated: result.deactivated,
        warnings: structuredClone(result.warnings),
      });
      return runView(row);
    },

    async listRuns(limit) {
      return [...syncRuns]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, limit)
        .map(runView);
    },

    /* ---- sync */
    async loadSyncState() {
      return {
        companies: companies.map((c) => ({
          id: c.id,
          code: c.code,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          domains: [...c.domains],
        })),
        departments: departments.map((d) => ({
          id: d.id,
          companyId: d.companyId,
          nameEn: d.nameEn,
          nameAr: d.nameAr,
        })),
        users: users.map((u) => ({
          ...view(u),
          entraObjectId: u.entraObjectId,
          hrFields: u.hrFields ?? null,
        })),
      };
    },

    async applySyncChanges(plan) {
      const attach = (u, data) => {
        const { departmentId } = data;
        Object.assign(u, data);
        if ('departmentId' in data) {
          const dept = departmentId ? byId(departments, departmentId) : null;
          u.department = dept ? { nameEn: dept.nameEn, nameAr: dept.nameAr } : null;
        }
        if ('companyId' in data) u.company = byId(companies, data.companyId);
      };

      for (const { data } of plan.creates) {
        const row = {
          id: randomUUID(),
          language: 'en',
          displayNameAr: '',
          managerId: null,
          roles: [
            {
              id: randomUUID(),
              role: ROLES.USER,
              scopeCompanyId: data.companyId,
              createdAt: new Date(),
            },
          ],
        };
        attach(row, data);
        users.push(row);
      }
      for (const { id, data } of plan.updates) attach(byId(users, id), data);

      const idOf = new Map(users.map((u) => [u.entraObjectId, u.id]));
      for (const link of plan.managerLinks) {
        const u = byId(users, idOf.get(link.entraObjectId));
        if (u)
          u.managerId = link.managerEntraObjectId
            ? (idOf.get(link.managerEntraObjectId) ?? null)
            : null;
      }
    },
  };

  /** Nothing to roll back here: the writes are the last thing a service does. */
  return { ...store, transaction: (fn) => fn(store) };
}
