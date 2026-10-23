/**
 * store-memory.js — store-prisma.js's interface over the in-memory repo, for
 * the tests and for `npm run dev` without SQL Server. Rows live on the repo
 * (`repo.notifications`, `repo.notificationPrefs`) so a test can read them.
 */

import { randomUUID } from 'node:crypto';

const copy = (row) => (row ? { ...row } : null);

/** @param {ReturnType<import('../auth/repo-memory.js').createMemoryUserRepo>} repo */
export function createMemoryNotificationStore(repo) {
  const rows = (repo.notifications ??= []);
  const prefs = (repo.notificationPrefs ??= []);
  const { users, companies } = repo;

  return {
    async getRecipients(ids) {
      return users
        .filter((u) => ids.includes(u.id))
        .map((u) => ({
          id: u.id,
          email: u.email,
          companyId: u.companyId,
          language: u.language ?? 'en',
          isActive: u.isActive,
        }));
    },

    async getCompanies(ids) {
      return companies
        .filter((c) => ids.includes(c.id))
        .map((c) => ({
          id: c.id,
          code: c.code,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          accentColor: c.accentColor,
        }));
    },

    async getPreferences(userIds) {
      return prefs.filter((p) => userIds.includes(p.userId)).map(copy);
    },

    async channelsDone(userId, dedupeKey) {
      return rows
        .filter((r) => r.userId === userId && r.dedupeKey === dedupeKey)
        .map((r) => r.channel);
    },

    async insertNotification(data) {
      const now = new Date();
      const row = {
        id: randomUUID(),
        readAt: null,
        sentAt: null,
        dedupeKey: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      rows.push(row);
      return copy(row);
    },

    async list({ userId, unread, skip, take, hide = null }) {
      const mine = rows
        .filter(
          (r) =>
            r.userId === userId &&
            r.channel === 'inApp' &&
            (!unread || !r.readAt) &&
            !(hide && r.templateKey.startsWith(hide))
        )
        .sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1)
        );
      return { total: mine.length, items: mine.slice(skip, skip + take).map(copy) };
    },

    async countUnread(userId, hide = null) {
      return rows.filter(
        (r) =>
          r.userId === userId &&
          r.channel === 'inApp' &&
          !r.readAt &&
          !(hide && r.templateKey.startsWith(hide))
      ).length;
    },

    async markRead(userId, ids, at) {
      let count = 0;
      for (const row of rows) {
        if (
          row.userId === userId &&
          row.channel === 'inApp' &&
          !row.readAt &&
          ids.includes(row.id)
        ) {
          row.readAt = at;
          count += 1;
        }
      }
      return count;
    },

    async markAllRead(userId, at, hide = null) {
      let count = 0;
      for (const row of rows) {
        if (
          row.userId === userId &&
          row.channel === 'inApp' &&
          !row.readAt &&
          !(hide && row.templateKey.startsWith(hide))
        ) {
          row.readAt = at;
          count += 1;
        }
      }
      return count;
    },

    async listPreferences(userId) {
      return prefs.filter((p) => p.userId === userId).map(copy);
    },

    async setPreferences(userId, companyId, items) {
      for (const { category, channel, enabled } of items) {
        const found = prefs.find(
          (p) => p.userId === userId && p.category === category && p.channel === channel
        );
        if (found) found.enabled = enabled;
        else prefs.push({ id: randomUUID(), userId, companyId, category, channel, enabled });
      }
    },
  };
}
