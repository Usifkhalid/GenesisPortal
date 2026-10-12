/**
 * Graph, mocked. Canned data lives in backend/mock/graph-users.json so that
 * every feature can be built and tested with no tenant: about forty people
 * across GEN, MSR and HLD, the twelve seeded users among them with the same ids
 * and emails, plus deliberate gaps for the data-quality report to find.
 *
 * `{ users, managers }`: managers maps a user id to their manager's id.
 *
 * The calendar half stands in for Exchange: room mailboxes are the seeded
 * rooms, and events are rows in MockCalendarEvent (or an array, in memory),
 * one per occurrence. Like Exchange it refuses a room that is already busy,
 * so the portal's own conflict check is never the only one.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { ROOMS } from '../../../prisma/seed-data.js';
import { GraphError } from './errors.js';
import { createPrismaCalendar } from './mock-calendar.js';
import { createFileOutbox } from './mock-mail.js';

const FILE = new URL('../../../mock/graph-users.json', import.meta.url);

const overlap = (a, b) => a.startAt < b.endAt && b.startAt < a.endAt;
const eventView = (row) => ({
  id: row.id,
  seriesMasterId: row.seriesMasterId ?? null,
  subject: row.subject,
  start: row.startAt,
  end: row.endAt,
  roomEmail: row.roomEmail,
});

/**
 * @param {{ users?: object[], managers?: Record<string, string> }} [data]  a
 *   replacement data set, for tests
 * @param {object} [options]
 * @param {ReturnType<import('./mock-calendar.js').createMemoryCalendar>} [options.calendar]
 *   where events are kept; the MockCalendarEvent table when omitted
 * @param {ReturnType<import('./mock-mail.js').createMemoryOutbox>} [options.outbox]
 *   where "sent" mail goes; backend/mock/outbox/ when omitted
 * @returns {import('./index.js').GraphClient}
 */
/**
 * Room mailboxes Exchange has and the portal does not use yet: what an
 * administrator adds a room from (Company admin, Rooms). Placeholders, like
 * the seeded six.
 */
const SPARE_ROOMS = ['A', 'B', 'C', 'D'].map((letter, i) => ({
  mailboxEmail: `room-site-${letter.toLowerCase()}@mgholding.example`,
  nameEn: `Site Meeting Room ${letter}`,
  floor: 'G',
  capacity: 30 + i * 2,
}));

export function createClient(
  data,
  { calendar = createPrismaCalendar(), outbox = createFileOutbox() } = {}
) {
  const { users, managers } = data ?? JSON.parse(readFileSync(FILE, 'utf8'));
  const byId = new Map(users.map((u) => [u.id, u]));

  /** Throws room_conflict when any wanted time meets an event in that room. */
  async function assertFree(roomEmail, wanted, ignoreId = null) {
    const start = new Date(Math.min(...wanted.map((w) => w.startAt.getTime())));
    const end = new Date(Math.max(...wanted.map((w) => w.endAt.getTime())));
    const taken = (await calendar.find({ roomEmails: [roomEmail], start, end })).filter(
      (row) => row.id !== ignoreId
    );
    const conflicts = wanted.filter((w) => taken.some((row) => overlap(w, row)));
    if (conflicts.length > 0) {
      throw new GraphError('room_conflict', 'The room is already booked.', {
        conflicts: conflicts.map((c) => ({ start: c.startAt, end: c.endAt })),
      });
    }
  }

  async function existing(eventId) {
    const row = await calendar.get(eventId);
    if (!row || row.isCancelled) throw new GraphError('event_not_found');
    return row;
  }

  return {
    mode: 'mock',

    async listUsers() {
      return users.map((u) => structuredClone(u));
    },

    async getManager(userId) {
      const manager = byId.get(managers[userId]);
      return manager
        ? { id: manager.id, displayName: manager.displayName, mail: manager.mail }
        : null;
    },

    async listRooms() {
      return [...ROOMS, ...SPARE_ROOMS].map((room) => ({
        id: `mock-room-${room.mailboxEmail}`,
        displayName: room.nameEn,
        emailAddress: room.mailboxEmail,
        capacity: room.capacity,
        floorLabel: room.floor ?? null,
        building: 'Cairo HQ',
      }));
    },

    async getSchedule(roomEmails, start, end) {
      const rows = await calendar.find({ roomEmails, start, end });
      return roomEmails.map((roomEmail) => ({
        roomEmail,
        items: rows
          .filter((row) => row.roomEmail === roomEmail)
          .map((row) => ({
            start: row.startAt,
            end: row.endAt,
            status: 'busy',
            eventId: row.id,
          })),
      }));
    },

    async createEvent({
      organiser,
      room,
      subject,
      start,
      end,
      recurrence,
      attendees,
      occurrences,
    }) {
      const times = (occurrences ?? [{ start, end }]).map((o) => ({
        startAt: o.start,
        endAt: o.end,
      }));
      await assertFree(room.email, times);

      const seriesMasterId = recurrence ? `mock-series-${randomUUID()}` : null;
      const rows = times.map((time) => ({
        id: `mock-event-${randomUUID()}`,
        seriesMasterId,
        organiserEmail: organiser.email,
        roomEmail: room.email,
        subject,
        ...time,
        recurrence: recurrence ? JSON.stringify(recurrence) : null,
        attendees: JSON.stringify(attendees ?? []),
        isCancelled: false,
      }));
      await calendar.insert(rows);
      return { id: seriesMasterId ?? rows[0].id, seriesMasterId, events: rows.map(eventView) };
    },

    async updateEvent({ eventId, subject, start, end }) {
      const row = await existing(eventId);
      const next = {
        subject: subject ?? row.subject,
        startAt: start ?? row.startAt,
        endAt: end ?? row.endAt,
      };
      await assertFree(row.roomEmail, [next], row.id);
      await calendar.patch([row.id], next);
      return eventView({ ...row, ...next });
    },

    async cancelEvent({ eventId, scope = 'one', from }) {
      const row = await existing(eventId);
      const rows =
        scope === 'series' && row.seriesMasterId
          ? await calendar.find({ seriesMasterId: row.seriesMasterId, from })
          : [row];
      await calendar.patch(
        rows.map((r) => r.id),
        { isCancelled: true }
      );
      return { cancelled: rows.map((r) => r.id) };
    },

    async listMyEvents({ organiser, start, end }) {
      const rows = await calendar.find({ organiserEmail: organiser.email, start, end });
      return rows.map(eventView);
    },

    async sendMail({ from, to, subject, html, text }) {
      if (!to?.length) throw new GraphError('no_recipient', 'A message needs a recipient.');
      const stored = await outbox.add({ from, to, subject, html, text });
      return { id: stored.id };
    },

    /** Teams activity feed: not wired yet (the real tenant is not reachable). */
    async sendActivityNotification() {
      return { delivered: false };
    },

    /** Mock only: what has been "sent", newest first, for the dev outbox page. */
    async listOutbox() {
      return outbox.list();
    },
    async clearOutbox() {
      return outbox.clear();
    },
  };
}
