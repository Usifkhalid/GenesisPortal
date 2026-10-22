/**
 * store-prisma.js — the rooms module's reads and writes over Prisma.
 *
 * The service holds the rules; the store holds the queries, so the same rules
 * run over this and over store-memory.js. Every method takes ids and company
 * lists the service has already scoped from req.user.
 *
 * Three columns are text in SQL Server and something richer here: a room's
 * equipment (comma-separated → array), a company's working days (the same),
 * and a booking's recurrence rule and attendee ids (JSON). The conversion
 * happens in this file and nowhere else.
 *
 * `transaction(fn)` hands fn a store bound to one Prisma transaction, which
 * also carries `auditLog` for lib/audit.js.
 */

import { getPrisma } from '@mg/shared/server/lib/prisma.js';

const PERSON = { id: true, email: true, displayNameEn: true, displayNameAr: true };

const ROOM_INCLUDE = { companies: { select: { companyId: true } } };

const BOOKING_INCLUDE = {
  room: { select: { id: true, nameEn: true, nameAr: true, floor: true, mailboxEmail: true } },
  organiser: { select: PERSON },
};

const list = (text) => (text ? text.split(',').filter(Boolean) : []);

function parse(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function roomView({ companies, equipment, ...row }) {
  return {
    ...row,
    equipment: list(equipment),
    companyIds: companies.map((c) => c.companyId),
  };
}

function bookingView(row) {
  return {
    ...row,
    recurrence: parse(row.recurrence, null),
    attendeeIds: parse(row.attendeeIds, []),
  };
}

/** A booking's columns as SQL Server holds them. */
function bookingColumns({ recurrence, attendeeIds, ...data }) {
  return {
    ...data,
    ...(recurrence === undefined
      ? {}
      : { recurrence: recurrence ? JSON.stringify(recurrence) : null }),
    ...(attendeeIds === undefined ? {} : { attendeeIds: JSON.stringify(attendeeIds) }),
  };
}

/** @param {import('@prisma/client').PrismaClient} db */
function operations(db) {
  const getRoom = async (id) => {
    const row = await db.room.findUnique({ where: { id }, include: ROOM_INCLUDE });
    return row ? roomView(row) : null;
  };

  return {
    /** What lib/audit.js writes to. */
    auditLog: db.auditLog,

    /* ---- companies and people */
    async getCompany(id) {
      const row = await db.company.findUnique({
        where: { id },
        select: {
          id: true,
          isActive: true,
          workdayStartMin: true,
          workdayEndMin: true,
          workingDays: true,
        },
      });
      return row ? { ...row, workingDays: list(row.workingDays).map(Number) } : null;
    },

    async existingCompanyIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db.company.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    async getUsers(ids) {
      if (ids.length === 0) return [];
      return db.userProfile.findMany({
        where: { id: { in: ids } },
        select: { ...PERSON, entraObjectId: true, companyId: true, isActive: true },
      });
    },

    /* ---- rooms */
    async listRooms({ includeInactive = false } = {}) {
      const rows = await db.room.findMany({
        where: includeInactive ? {} : { isActive: true },
        include: ROOM_INCLUDE,
        orderBy: { nameEn: 'asc' },
      });
      return rows.map(roomView);
    },

    getRoom,

    async findRoomByEmail(mailboxEmail) {
      const row = await db.room.findUnique({ where: { mailboxEmail }, include: ROOM_INCLUDE });
      return row ? roomView(row) : null;
    },

    async createRoom({ companyIds, equipment, ...data }) {
      const row = await db.room.create({
        data: {
          ...data,
          equipment: equipment.join(','),
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
        },
        include: ROOM_INCLUDE,
      });
      return roomView(row);
    },

    async updateRoom(id, { companyIds, equipment, ...patch }, expectedUpdatedAt) {
      const { count } = await db.room.updateMany({
        where: { id, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
        data: {
          ...patch,
          ...(equipment === undefined ? {} : { equipment: equipment.join(',') }),
          // Restrictions alone still move updatedAt, so a second editor is stale.
          updatedAt: new Date(),
        },
      });
      if (count === 0) return null;
      if (companyIds !== undefined) {
        await db.roomCompany.deleteMany({ where: { roomId: id } });
        if (companyIds.length > 0) {
          await db.roomCompany.createMany({
            data: companyIds.map((companyId) => ({ roomId: id, companyId })),
          });
        }
      }
      return getRoom(id);
    },

    /* ---- bookings */
    async createBookings(rows) {
      const made = [];
      for (const data of rows) {
        made.push(
          await db.booking.create({ data: bookingColumns(data), include: BOOKING_INCLUDE })
        );
      }
      return made.map(bookingView);
    },

    async getBooking(id) {
      const row = await db.booking.findUnique({ where: { id }, include: BOOKING_INCLUDE });
      return row ? bookingView(row) : null;
    },

    async listBookings(filter = {}) {
      const startAt = {
        ...(filter.overlapTo ? { lt: filter.overlapTo } : {}),
        ...(filter.startFrom ? { gte: filter.startFrom } : {}),
      };
      const endAt = {
        ...(filter.overlapFrom ? { gt: filter.overlapFrom } : {}),
        ...(filter.endAfter ? { gt: filter.endAfter } : {}),
      };
      // Both lower bounds on endAt: the later one is the one that binds.
      if (filter.overlapFrom && filter.endAfter) {
        endAt.gt = new Date(Math.max(filter.overlapFrom.getTime(), filter.endAfter.getTime()));
      }
      const where = {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.organiserId ? { organiserId: filter.organiserId } : {}),
        ...(filter.roomIds ? { roomId: { in: filter.roomIds } } : {}),
        ...(filter.companyIds ? { companyId: { in: filter.companyIds } } : {}),
        ...(filter.seriesMasterId ? { seriesMasterId: filter.seriesMasterId } : {}),
        ...(Object.keys(startAt).length ? { startAt } : {}),
        ...(Object.keys(endAt).length ? { endAt } : {}),
      };
      const [total, items] = await Promise.all([
        db.booking.count({ where }),
        db.booking.findMany({
          where,
          include: BOOKING_INCLUDE,
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
          skip: filter.skip ?? 0,
          ...(filter.take ? { take: filter.take } : {}),
        }),
      ]);
      return { total, items: items.map(bookingView) };
    },

    async updateBooking(id, patch) {
      const row = await db.booking.update({
        where: { id },
        data: bookingColumns(patch),
        include: BOOKING_INCLUDE,
      });
      return bookingView(row);
    },

    async cancelBookings(ids, { at, byId, reason = null }) {
      for (let i = 0; i < ids.length; i += 500) {
        await db.booking.updateMany({
          where: { id: { in: ids.slice(i, i + 500) }, status: { not: 'cancelled' } },
          data: {
            status: 'cancelled',
            cancelledAt: at,
            cancelledById: byId,
            cancelReason: reason,
          },
        });
      }
    },
  };
}

/** Prisma's code for a transaction that lost a deadlock or a write conflict. */
const WRITE_CONFLICT = 'P2034';
const ATTEMPTS = 4;

/** A deadlock's loser was rolled back whole; running it again is safe. */
async function withRetry(run) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      if (err?.code !== WRITE_CONFLICT || attempt >= ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

export function createPrismaRoomStore() {
  const names = Object.keys(operations(/** @type {any} */ ({}))).filter(
    (name) => name !== 'auditLog'
  );

  const methods = Object.fromEntries(
    names.map((name) => [name, async (...args) => operations(await getPrisma())[name](...args)])
  );

  return {
    ...methods,
    transaction: (fn) =>
      withRetry(async () => {
        const db = await getPrisma();
        return db.$transaction((tx) => fn(operations(tx)), { timeout: 30_000 });
      }),
  };
}
