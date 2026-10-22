/**
 * store-memory.js — store-prisma.js's interface over the in-memory repo
 * (modules/auth/repo-memory.js): the same companies and people sign-in reads,
 * plus its rooms and bookings. Used by the tests and by `npm run dev` while no
 * SQL Server is configured. Never used in production.
 */

import { randomUUID } from 'node:crypto';

/** @param {ReturnType<import('@mg/shared/server/modules/auth/repo-memory.js').createMemoryUserRepo>} repo */
export function createMemoryRoomStore(repo) {
  const { companies, users, rooms, bookings, auditLogs } = repo;
  const byId = (list, id) => list.find((row) => row.id === id) ?? null;

  const roomView = (row) => ({
    id: row.id,
    mailboxEmail: row.mailboxEmail,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    floor: row.floor ?? null,
    capacity: row.capacity,
    equipment: [...row.equipment],
    photoKey: row.photoKey ?? null,
    photoUrl: row.photoUrl ?? null,
    notes: row.notes ?? '',
    isActive: row.isActive,
    companyIds: [...row.companyIds],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const person = (id) => {
    const u = byId(users, id);
    return u
      ? {
          id: u.id,
          email: u.email,
          displayNameEn: u.displayNameEn,
          displayNameAr: u.displayNameAr,
        }
      : null;
  };

  const bookingView = (row) => {
    const room = byId(rooms, row.roomId);
    return {
      ...row,
      recurrence: row.recurrence ? structuredClone(row.recurrence) : null,
      attendeeIds: [...row.attendeeIds],
      room: {
        id: room.id,
        nameEn: room.nameEn,
        nameAr: room.nameAr,
        floor: room.floor ?? null,
        mailboxEmail: room.mailboxEmail,
      },
      organiser: person(row.organiserId),
    };
  };

  const store = {
    /** What lib/audit.js writes to. */
    auditLog: {
      async create({ data }) {
        const row = { id: randomUUID(), at: new Date(), createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      },
    },

    /* ---- companies and people */
    async getCompany(id) {
      const c = byId(companies, id);
      return c
        ? {
            id: c.id,
            isActive: c.isActive,
            workdayStartMin: c.workdayStartMin,
            workdayEndMin: c.workdayEndMin,
            workingDays: c.workingDays,
          }
        : null;
    },

    async existingCompanyIds(ids) {
      return ids.filter((id) => byId(companies, id));
    },

    async getUsers(ids) {
      return ids
        .map((id) => byId(users, id))
        .filter(Boolean)
        .map((u) => ({
          ...person(u.id),
          entraObjectId: u.entraObjectId,
          companyId: u.companyId,
          isActive: u.isActive,
        }));
    },

    /* ---- rooms */
    async listRooms({ includeInactive = false } = {}) {
      return rooms
        .filter((r) => includeInactive || r.isActive)
        .sort((a, b) => a.nameEn.localeCompare(b.nameEn))
        .map(roomView);
    },

    async getRoom(id) {
      const row = byId(rooms, id);
      return row ? roomView(row) : null;
    },

    async findRoomByEmail(mailboxEmail) {
      const row = rooms.find((r) => r.mailboxEmail === mailboxEmail);
      return row ? roomView(row) : null;
    },

    async createRoom(data) {
      const now = new Date();
      const row = {
        id: randomUUID(),
        photoKey: null,
        photoUrl: null,
        ...data,
        equipment: [...data.equipment],
        companyIds: [...data.companyIds],
        createdAt: now,
        updatedAt: now,
      };
      rooms.push(row);
      return roomView(row);
    },

    async updateRoom(id, patch, expectedUpdatedAt) {
      const row = byId(rooms, id);
      if (!row) return null;
      if (expectedUpdatedAt && row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        return null;
      }
      Object.assign(row, structuredClone(patch));
      // Strictly later than before, so a second edit with the old value is stale.
      row.updatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
      return roomView(row);
    },

    /* ---- bookings */
    async createBookings(list) {
      const now = new Date();
      const made = list.map((data) => ({
        id: randomUUID(),
        status: 'confirmed',
        cancelledAt: null,
        cancelledById: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      }));
      bookings.push(...made);
      return made.map(bookingView);
    },

    async getBooking(id) {
      const row = byId(bookings, id);
      return row ? bookingView(row) : null;
    },

    async listBookings(filter = {}) {
      const matching = bookings
        .filter(
          (b) =>
            (!filter.status || b.status === filter.status) &&
            (!filter.organiserId || b.organiserId === filter.organiserId) &&
            (!filter.roomIds || filter.roomIds.includes(b.roomId)) &&
            (!filter.companyIds || filter.companyIds.includes(b.companyId)) &&
            (!filter.seriesMasterId || b.seriesMasterId === filter.seriesMasterId) &&
            (!filter.overlapTo || b.startAt < filter.overlapTo) &&
            (!filter.overlapFrom || b.endAt > filter.overlapFrom) &&
            (!filter.startFrom || b.startAt >= filter.startFrom) &&
            (!filter.endAfter || b.endAt > filter.endAfter)
        )
        .sort((a, b) => a.startAt - b.startAt || (a.id < b.id ? -1 : 1));
      const skip = filter.skip ?? 0;
      const items = matching.slice(skip, filter.take ? skip + filter.take : undefined);
      return { total: matching.length, items: items.map(bookingView) };
    },

    async updateBooking(id, patch) {
      const row = byId(bookings, id);
      Object.assign(row, patch, { updatedAt: new Date() });
      return bookingView(row);
    },

    async cancelBookings(ids, { at, byId: cancelledById, reason = null }) {
      for (const row of bookings) {
        if (!ids.includes(row.id) || row.status === 'cancelled') continue;
        Object.assign(row, {
          status: 'cancelled',
          cancelledAt: at,
          cancelledById,
          cancelReason: reason,
          updatedAt: at,
        });
      }
    },
  };

  /** Nothing to roll back here: the writes are the last thing a service does. */
  return { ...store, transaction: (fn) => fn(store) };
}
