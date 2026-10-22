/**
 * store-prisma.js — notifications and preferences over Prisma. The same
 * interface as store-memory.js, so the service and lib/notify.js run over
 * either.
 *
 * Every read of a person's notifications carries their own `userId`: there is
 * no query here that returns another person's row.
 */

import { getPrisma } from '../../lib/prisma.js';

const RECIPIENT = { id: true, email: true, companyId: true, language: true, isActive: true };
const COMPANY = { id: true, code: true, nameEn: true, nameAr: true, accentColor: true };

/** @param {import('@prisma/client').PrismaClient} db */
function operations(db) {
  return {
    async getRecipients(ids) {
      if (ids.length === 0) return [];
      return db.userProfile.findMany({ where: { id: { in: ids } }, select: RECIPIENT });
    },

    async getCompanies(ids) {
      if (ids.length === 0) return [];
      return db.company.findMany({ where: { id: { in: ids } }, select: COMPANY });
    },

    async getPreferences(userIds) {
      if (userIds.length === 0) return [];
      return db.notificationPreference.findMany({ where: { userId: { in: userIds } } });
    },

    /** The channels on which this person already has this keyed notification. */
    async channelsDone(userId, dedupeKey) {
      const rows = await db.notification.findMany({
        where: { userId, dedupeKey },
        select: { channel: true },
      });
      return rows.map((r) => r.channel);
    },

    async insertNotification(data) {
      return db.notification.create({ data });
    },

    async list({ userId, unread, skip, take }) {
      const where = { userId, channel: 'inApp', ...(unread ? { readAt: null } : {}) };
      const [total, items] = await Promise.all([
        db.notification.count({ where }),
        db.notification.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take,
        }),
      ]);
      return { total, items };
    },

    async countUnread(userId) {
      return db.notification.count({ where: { userId, channel: 'inApp', readAt: null } });
    },

    async markRead(userId, ids, at) {
      const { count } = await db.notification.updateMany({
        where: { userId, channel: 'inApp', readAt: null, id: { in: ids } },
        data: { readAt: at },
      });
      return count;
    },

    async markAllRead(userId, at) {
      const { count } = await db.notification.updateMany({
        where: { userId, channel: 'inApp', readAt: null },
        data: { readAt: at },
      });
      return count;
    },

    async listPreferences(userId) {
      return db.notificationPreference.findMany({ where: { userId } });
    },

    async setPreferences(userId, companyId, items) {
      for (const { category, channel, enabled } of items) {
        await db.notificationPreference.upsert({
          where: { userId_category_channel: { userId, category, channel } },
          create: { userId, companyId, category, channel, enabled },
          update: { enabled },
        });
      }
    },
  };
}

export function createPrismaNotificationStore() {
  const names = Object.keys(operations(/** @type {any} */ ({})));
  return Object.fromEntries(
    names.map((name) => [name, async (...args) => operations(await getPrisma())[name](...args)])
  );
}
