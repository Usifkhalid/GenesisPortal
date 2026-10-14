/**
 * store-memory.js — store-prisma.js's interface over the in-memory repo
 * (modules/auth/repo-memory.js): the same people and companies sign-in reads,
 * plus `repo.helpdesk`, which holds one array per helpdesk table. Used by the
 * tests and by `npm run dev` while no SQL Server is configured. Never used in
 * production.
 */

import { randomUUID } from 'node:crypto';

import { TABLES } from './store-prisma.js';

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, value]) =>
    Array.isArray(value) ? value.includes(row[key]) : (row[key] ?? null) === (value ?? null)
  );

const compare = (a, b) => {
  if (a === b) return 0;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'boolean') return Number(a) - Number(b);
  return a < b ? -1 : 1;
};

/** Sorts like Prisma's orderBy: [{ field: 'asc' | 'desc' }, …]. */
function sortBy(rows, orderBy) {
  const order = [orderBy ?? []].flat();
  return [...rows].sort((a, b) => {
    for (const spec of order) {
      const [[field, direction]] = Object.entries(spec);
      const diff = compare(a[field], b[field]);
      if (diff !== 0) return direction === 'desc' ? -diff : diff;
    }
    return 0;
  });
}

const ORDER = {
  due: [{ slaActive: 'desc' }, { nextDueAt: 'asc' }, { number: 'asc' }],
  recent: [{ createdAt: 'desc' }, { number: 'desc' }],
};

/** The ticket filter of store-prisma.js's `ticketWhere`, as a predicate. */
function ticketMatches(t, f) {
  const q = f.q?.toLowerCase();
  const at = (date) => date.getTime();
  return (
    (!f.requesterId || t.requesterId === f.requesterId) &&
    (!f.scopes ||
      f.scopes.some(
        (s) => s.teamId === t.teamId && (!s.companyIds || s.companyIds.includes(t.companyId))
      )) &&
    (!f.statuses || f.statuses.includes(t.status)) &&
    (!f.priority || t.priority === f.priority) &&
    (!f.teamId || t.teamId === f.teamId) &&
    (!f.companyId || t.companyId === f.companyId) &&
    (!f.locationId || t.locationId === f.locationId) &&
    (!f.categoryId || t.categoryId === f.categoryId) &&
    (f.assigneeId === undefined || (t.assigneeId ?? null) === f.assigneeId) &&
    (!q || t.number.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q)) &&
    (f.sla !== 'on_track' || (t.slaActive && at(t.nextRiskAt) > at(f.now))) &&
    (f.sla !== 'at_risk' ||
      (t.slaActive && at(t.nextRiskAt) <= at(f.now) && at(t.nextDueAt) > at(f.now))) &&
    (f.sla !== 'breached' || (t.slaActive && at(t.nextDueAt) <= at(f.now))) &&
    (!f.riskBy || (t.slaActive && at(t.nextRiskAt) <= at(f.riskBy))) &&
    (!f.autoCloseBy || (t.autoCloseAt != null && at(t.autoCloseAt) <= at(f.autoCloseBy))) &&
    (!f.createdFrom || at(t.createdAt) >= at(f.createdFrom)) &&
    (!f.createdBefore || at(t.createdAt) < at(f.createdBefore))
  );
}

/** @param {ReturnType<import('../auth/repo-memory.js').createMemoryUserRepo>} repo */
export function createMemoryTicketStore(repo) {
  const { companies, users, auditLogs, helpdesk } = repo;

  const rowsOf = (table) => {
    if (!TABLES[table]) throw new Error(`Unknown helpdesk table: ${table}`);
    return helpdesk[table];
  };
  const copy = (row) => (row ? { ...row } : null);

  const store = {
    /** What lib/audit.js writes to. */
    auditLog: {
      async create({ data }) {
        const row = { id: randomUUID(), at: new Date(), createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      },
    },

    /* ---- the small tables */
    async find(table, where = {}, { orderBy } = {}) {
      return sortBy(
        rowsOf(table).filter((row) => matches(row, where)),
        orderBy
      ).map(copy);
    },

    async get(table, id) {
      return copy(rowsOf(table).find((row) => row.id === id));
    },

    async insert(table, data) {
      const now = new Date();
      const row = { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
      rowsOf(table).push(row);
      return copy(row);
    },

    async update(table, id, patch) {
      const row = rowsOf(table).find((r) => r.id === id);
      if (!row) throw Object.assign(new Error('Record not found.'), { code: 'P2025' });
      Object.assign(row, patch, { updatedAt: new Date() });
      return copy(row);
    },

    async remove(table, where) {
      const rows = rowsOf(table);
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i], where)) {
          rows.splice(i, 1);
          count += 1;
        }
      }
      return count;
    },

    /* ---- people and companies */
    async getUsers(ids) {
      return users
        .filter((u) => ids.includes(u.id))
        .map((u) => ({
          id: u.id,
          email: u.email,
          displayNameEn: u.displayNameEn,
          displayNameAr: u.displayNameAr,
          companyId: u.companyId,
          officeLocation: u.officeLocation ?? null,
          language: u.language ?? 'en',
          isActive: u.isActive,
        }));
    },

    async listCompanies() {
      return companies
        .map((c) => ({
          id: c.id,
          code: c.code,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          isActive: c.isActive,
        }))
        .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
    },

    /* ---- tickets */
    async ensureSequence(prefix, year) {
      const key = `${prefix}/${year}`;
      if (!helpdesk.sequences.has(key)) helpdesk.sequences.set(key, 0);
    },

    /** Read and written in one step, with no await in between. */
    async nextTicketNumber(prefix, year) {
      const key = `${prefix}/${year}`;
      const next = (helpdesk.sequences.get(key) ?? 0) + 1;
      helpdesk.sequences.set(key, next);
      return next;
    },

    async listTickets(filter = {}) {
      const matching = sortBy(
        helpdesk.ticket.filter((t) => ticketMatches(t, filter)),
        ORDER[filter.order ?? 'recent']
      );
      const skip = filter.skip ?? 0;
      const items = matching.slice(skip, filter.take ? skip + filter.take : undefined);
      return { total: matching.length, items: items.map(copy) };
    },

    async countTickets(filter = {}) {
      return helpdesk.ticket.filter((t) => ticketMatches(t, filter)).length;
    },
  };

  /** Nothing to roll back here: the writes are the last thing a service does. */
  return { ...store, transaction: (fn) => fn(store) };
}
