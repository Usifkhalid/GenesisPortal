/**
 * store-prisma.js — the announcements module's queries over Prisma. The
 * service holds the rules; this holds the queries, so the same rules run over
 * this and over store-memory.js. `transaction(fn)` hands fn a store bound to
 * one transaction, so a change and its audit row commit together.
 */

import { getPrisma } from '../../lib/prisma.js';

const INCLUDE = {
  company: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  author: { select: { id: true, displayNameEn: true, displayNameAr: true } },
};

const notExpired = (now) => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

/** The conditions under which a post is on the board for readers. */
const liveWhere = (now) => [{ publishAt: { not: null, lte: now } }, notExpired(now)];

function statusWhere(status, now) {
  switch (status) {
    case 'Draft':
      return [{ publishAt: null }];
    case 'Scheduled':
      return [{ publishAt: { gt: now } }, notExpired(now)];
    case 'Published':
      return liveWhere(now);
    case 'Expired':
      return [{ publishAt: { not: null } }, { expiresAt: { not: null, lte: now } }];
    default:
      return [];
  }
}

const ORDER = [{ isPinned: 'desc' }, { publishAt: 'desc' }, { id: 'asc' }];

/** @param {import('@prisma/client').PrismaClient} db */
function bind(db) {
  return {
    auditLog: db.auditLog,

    async listVisible({ companyId, userId, category, unread, now, skip, take }) {
      const where = {
        AND: [
          ...liveWhere(now),
          { OR: [{ companyId: null }, { companyId }] },
          ...(category ? [{ category }] : []),
          ...(unread ? [{ reads: { none: { userId } } }] : []),
        ],
      };
      const [total, items] = await Promise.all([
        db.announcement.count({ where }),
        db.announcement.findMany({ where, include: INCLUDE, orderBy: ORDER, skip, take }),
      ]);
      const read = items.length
        ? await db.announcementRead.findMany({
            where: { userId, announcementId: { in: items.map((i) => i.id) } },
            select: { announcementId: true },
          })
        : [];
      const readIds = new Set(read.map((r) => r.announcementId));
      return { total, items: items.map((i) => ({ ...i, isRead: readIds.has(i.id) })) };
    },

    async countUnread({ companyId, userId, now }) {
      return db.announcement.count({
        where: {
          AND: [
            ...liveWhere(now),
            { OR: [{ companyId: null }, { companyId }] },
            { reads: { none: { userId } } },
          ],
        },
      });
    },

    async getCompany(id) {
      return db.company.findUnique({ where: { id }, select: { id: true, isActive: true } });
    },

    async getRow(id) {
      return db.announcement.findUnique({ where: { id }, include: INCLUDE });
    },

    async isRead(userId, announcementId) {
      const row = await db.announcementRead.findUnique({
        where: { userId_announcementId: { userId, announcementId } },
        select: { id: true },
      });
      return Boolean(row);
    },

    async markRead({ userId, companyId, announcementId }) {
      try {
        await db.announcementRead.create({ data: { userId, companyId, announcementId } });
      } catch (err) {
        // Two tabs at once: the unique key already holds the first one.
        if (err?.code !== 'P2002') throw err;
      }
    },

    async listAdmin({ audience, status, category, now, skip, take }) {
      const scope = audience.all
        ? []
        : [
            {
              OR: [
                { companyId: { in: audience.companyIds } },
                ...(audience.holdingWide ? [{ companyId: null }] : []),
              ],
            },
          ];
      const where = {
        AND: [...scope, ...statusWhere(status, now), ...(category ? [{ category }] : [])],
      };
      const [total, items] = await Promise.all([
        db.announcement.count({ where }),
        db.announcement.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      ]);
      return { total, items };
    },

    async audienceCounts(list) {
      const out = new Map();
      if (list.length === 0) return out;

      const [byCompany, reads] = await Promise.all([
        db.userProfile.groupBy({
          by: ['companyId'],
          where: { isActive: true, company: { isActive: true } },
          _count: { _all: true },
        }),
        db.announcementRead.groupBy({
          by: ['announcementId'],
          where: { announcementId: { in: list.map((r) => r.id) }, user: { isActive: true } },
          _count: { _all: true },
        }),
      ]);
      const perCompany = new Map(byCompany.map((g) => [g.companyId, g._count._all]));
      const everyone = [...perCompany.values()].reduce((a, b) => a + b, 0);
      const readCount = new Map(reads.map((g) => [g.announcementId, g._count._all]));

      for (const row of list) {
        out.set(row.id, {
          read: readCount.get(row.id) ?? 0,
          audience: row.companyId === null ? everyone : (perCompany.get(row.companyId) ?? 0),
        });
      }
      return out;
    },

    async create(data) {
      return db.announcement.create({ data, include: INCLUDE });
    },

    async update(id, patch, expectedUpdatedAt) {
      const { count } = await db.announcement.updateMany({
        where: { id, updatedAt: expectedUpdatedAt },
        data: patch,
      });
      if (count === 0) return null;
      return db.announcement.findUnique({ where: { id }, include: INCLUDE });
    },

    async remove(id) {
      await db.announcementRead.deleteMany({ where: { announcementId: id } });
      await db.announcement.delete({ where: { id } });
    },
  };
}

const METHODS = Object.keys(bind({ auditLog: null })).filter((name) => name !== 'auditLog');
const RETRIES = 6;

/** A deadlock victim (P2034) was rolled back whole; running it again is safe. */
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

export function createPrismaAnnouncementStore() {
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
