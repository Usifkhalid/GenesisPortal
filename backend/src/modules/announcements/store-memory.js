/**
 * store-memory.js — store-prisma.js's interface over the in-memory user repo,
 * for the tests and for development without SQL Server. It mirrors what the
 * database enforces where the rules under test depend on it: one read row per
 * user and announcement, and an `updatedAt` that must match to write.
 */

import { randomUUID } from 'node:crypto';

import { statusOf } from './rules.js';

/**
 * @param {ReturnType<import('../auth/repo-memory.js').createMemoryUserRepo>} repo
 */
export function createMemoryAnnouncementStore(repo) {
  const { companies, users, auditLogs } = repo;
  const rows = (repo.announcements ??= []);
  const reads = (repo.announcementReads ??= []);

  const byId = (list, id) => list.find((r) => r.id === id) ?? null;
  const same = (a, b) => new Date(a).getTime() === new Date(b).getTime();

  const view = (row) => {
    const company = row.companyId ? byId(companies, row.companyId) : null;
    const author = byId(users, row.authorId);
    return {
      ...row,
      company: company
        ? { id: company.id, code: company.code, nameEn: company.nameEn, nameAr: company.nameAr }
        : null,
      author: author
        ? {
            id: author.id,
            displayNameEn: author.displayNameEn,
            displayNameAr: author.displayNameAr,
          }
        : null,
    };
  };

  const order = (a, b) =>
    Number(b.isPinned) - Number(a.isPinned) ||
    b.publishAt - a.publishAt ||
    (a.id < b.id ? -1 : 1);

  const visibleTo = (row, companyId, now) =>
    statusOf(row, now) === 'Published' &&
    (row.companyId === null || row.companyId === companyId);
  const hasRead = (userId, announcementId) =>
    reads.some((r) => r.userId === userId && r.announcementId === announcementId);

  const store = {
    /** What lib/audit.js writes to. */
    auditLog: {
      async create({ data }) {
        const row = { id: randomUUID(), at: new Date(), createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      },
    },

    async listVisible({ companyId, userId, category, unread, now, skip, take }) {
      const matching = rows
        .filter((r) => visibleTo(r, companyId, now))
        .filter((r) => !category || r.category === category)
        .filter((r) => !unread || !hasRead(userId, r.id))
        .sort(order);
      return {
        total: matching.length,
        items: matching.slice(skip, skip + take).map((r) => ({
          ...view(r),
          isRead: hasRead(userId, r.id),
        })),
      };
    },

    async countUnread({ companyId, userId, now }) {
      return rows.filter((r) => visibleTo(r, companyId, now) && !hasRead(userId, r.id)).length;
    },

    async getCompany(id) {
      const company = byId(companies, id);
      return company ? { id: company.id, isActive: company.isActive } : null;
    },

    async getRow(id) {
      const row = byId(rows, id);
      return row ? view(row) : null;
    },

    async isRead(userId, announcementId) {
      return hasRead(userId, announcementId);
    },

    /** Idempotent: a second call changes nothing. */
    async markRead({ userId, companyId, announcementId }) {
      if (hasRead(userId, announcementId)) return;
      const now = new Date();
      reads.push({
        id: randomUUID(),
        userId,
        companyId,
        announcementId,
        readAt: now,
        createdAt: now,
        updatedAt: now,
      });
    },

    /** @param {{ all: true } | { companyIds: string[], holdingWide: boolean }} audience */
    async listAdmin({ audience, status, category, now, skip, take }) {
      const inScope = (r) =>
        audience.all ||
        (r.companyId === null
          ? audience.holdingWide
          : audience.companyIds.includes(r.companyId));
      const matching = rows
        .filter(inScope)
        .filter((r) => !status || statusOf(r, now) === status)
        .filter((r) => !category || r.category === category)
        .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
      return { total: matching.length, items: matching.slice(skip, skip + take).map(view) };
    },

    /** @returns {Promise<Map<string, { read: number, audience: number }>>} */
    async audienceCounts(list) {
      const active = users.filter((u) => u.isActive && u.company?.isActive !== false);
      const out = new Map();
      for (const row of list) {
        const audience = active.filter(
          (u) => row.companyId === null || u.companyId === row.companyId
        );
        const ids = new Set(audience.map((u) => u.id));
        const read = reads.filter((r) => r.announcementId === row.id && ids.has(r.userId));
        out.set(row.id, { read: read.length, audience: audience.length });
      }
      return out;
    },

    async audienceUserIds(companyId) {
      return users
        .filter(
          (u) =>
            u.isActive &&
            u.company?.isActive !== false &&
            (!companyId || u.companyId === companyId)
        )
        .map((u) => u.id);
    },

    async listPinnedLiveSince({ since, now }) {
      return rows
        .filter(
          (r) =>
            r.isPinned &&
            r.publishAt &&
            r.publishAt >= since &&
            r.publishAt <= now &&
            statusOf(r, now) === 'Published'
        )
        .map(view);
    },

    async create(data) {
      const now = new Date();
      const row = {
        id: randomUUID(),
        coverKey: null,
        coverUrl: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      rows.push(row);
      return view(row);
    },

    /** Applies `patch` only when the row is still at `expectedUpdatedAt`; null otherwise. */
    async update(id, patch, expectedUpdatedAt) {
      const row = byId(rows, id);
      if (!row || !same(row.updatedAt, expectedUpdatedAt)) return null;
      Object.assign(row, patch);
      row.updatedAt = new Date(Math.max(Date.now(), new Date(row.updatedAt).getTime() + 1));
      return view(row);
    },

    async remove(id) {
      const at = rows.findIndex((r) => r.id === id);
      if (at >= 0) rows.splice(at, 1);
      for (let i = reads.length - 1; i >= 0; i -= 1) {
        if (reads[i].announcementId === id) reads.splice(i, 1);
      }
    },
  };

  return { ...store, transaction: (fn) => fn(store) };
}
