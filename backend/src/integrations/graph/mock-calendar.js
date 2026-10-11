/**
 * mock-calendar.js — where the mocked Graph keeps its calendar events: the
 * MockCalendarEvent table, or an array when the portal runs in memory (tests,
 * and `npm run dev` with no database). Two versions of one small interface, so
 * mock.js holds the calendar's behaviour once.
 *
 *   find(filter)       events, soonest first; cancelled ones only when asked
 *   get(id)            one event, or null
 *   insert(rows)       adds events
 *   patch(ids, data)   changes events
 *
 * A row: { id, seriesMasterId, organiserEmail, roomEmail, subject, startAt,
 * endAt, recurrence, attendees (JSON text), isCancelled }.
 */

import { getPrisma } from '../../lib/prisma.js';

/**
 * @typedef {object} EventFilter
 * @property {string[]} [roomEmails]
 * @property {string} [organiserEmail]
 * @property {string} [seriesMasterId]
 * @property {Date} [start]  with `end`: events that overlap [start, end)
 * @property {Date} [end]
 * @property {Date} [from]  events that start at or after this
 * @property {boolean} [includeCancelled]
 */

/** @param {object[]} [rows]  the array to keep events in */
export function createMemoryCalendar(rows = []) {
  return {
    rows,

    /** @param {EventFilter} filter */
    async find(filter = {}) {
      return rows
        .filter(
          (r) =>
            (filter.includeCancelled || !r.isCancelled) &&
            (!filter.roomEmails || filter.roomEmails.includes(r.roomEmail)) &&
            (!filter.organiserEmail || r.organiserEmail === filter.organiserEmail) &&
            (!filter.seriesMasterId || r.seriesMasterId === filter.seriesMasterId) &&
            (!filter.end || r.startAt < filter.end) &&
            (!filter.start || r.endAt > filter.start) &&
            (!filter.from || r.startAt >= filter.from)
        )
        .sort((a, b) => a.startAt - b.startAt)
        .map((r) => ({ ...r }));
    },

    async get(id) {
      const row = rows.find((r) => r.id === id);
      return row ? { ...row } : null;
    },

    async insert(list) {
      const now = new Date();
      for (const row of list) rows.push({ createdAt: now, updatedAt: now, ...row });
    },

    async patch(ids, data) {
      for (const row of rows) {
        if (ids.includes(row.id)) Object.assign(row, data, { updatedAt: new Date() });
      }
    },
  };
}

/** @param {() => Promise<import('@prisma/client').PrismaClient>} [getDb] */
export function createPrismaCalendar(getDb = getPrisma) {
  return {
    /** @param {EventFilter} filter */
    async find(filter = {}) {
      const db = await getDb();
      return db.mockCalendarEvent.findMany({
        where: {
          ...(filter.includeCancelled ? {} : { isCancelled: false }),
          ...(filter.roomEmails ? { roomEmail: { in: filter.roomEmails } } : {}),
          ...(filter.organiserEmail ? { organiserEmail: filter.organiserEmail } : {}),
          ...(filter.seriesMasterId ? { seriesMasterId: filter.seriesMasterId } : {}),
          ...(filter.start ? { endAt: { gt: filter.start } } : {}),
          ...(filter.end || filter.from
            ? {
                startAt: {
                  ...(filter.end ? { lt: filter.end } : {}),
                  ...(filter.from ? { gte: filter.from } : {}),
                },
              }
            : {}),
        },
        orderBy: { startAt: 'asc' },
      });
    },

    async get(id) {
      const db = await getDb();
      return db.mockCalendarEvent.findUnique({ where: { id } });
    },

    async insert(list) {
      const db = await getDb();
      await db.mockCalendarEvent.createMany({ data: list });
    },

    async patch(ids, data) {
      const db = await getDb();
      for (let i = 0; i < ids.length; i += 500) {
        await db.mockCalendarEvent.updateMany({
          where: { id: { in: ids.slice(i, i + 500) } },
          data,
        });
      }
    },
  };
}
