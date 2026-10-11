import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import { env } from '../src/config/env.js';
import { createClient as createMockGraph } from '../src/integrations/graph/mock.js';
import { disconnectPrisma, getPrisma } from '../src/lib/prisma.js';
import { createMemoryStorage } from '../src/lib/storage.js';
import { cairoWallToUtc } from '../src/lib/time.js';
import { createRoomService } from '../src/modules/rooms/service.js';
import { createPrismaRoomStore } from '../src/modules/rooms/store-prisma.js';

/**
 * The rooms module over real tables: the Prisma store and the mocked Graph's
 * MockCalendarEvent calendar, which rooms.test.js (in memory) cannot show. It
 * makes a company, a person and a room of its own and removes what it can;
 * the test database is emptied before every run anyway.
 */

const NOW = new Date('2026-10-11T08:00:00Z');
const at = (ymd, minutes) => cairoWallToUtc(ymd, minutes);

async function findDatabase() {
  if (!env.hasDatabase) return { reason: 'DATABASE_URL is not configured' };
  try {
    const prisma = await getPrisma();
    await prisma.room.count();
    await prisma.mockCalendarEvent.count();
    return { prisma };
  } catch {
    await disconnectPrisma();
    return { reason: 'the database is unreachable or not migrated' };
  }
}

describe('rooms against SQL Server', async () => {
  const { prisma, reason } = await findDatabase();
  const tag = randomUUID().slice(0, 8);
  const mailbox = `room-${tag}@rooms-test.example`;
  const made = { companyId: null, userId: null, roomId: null };

  after(async () => {
    if (prisma) {
      await prisma.mockCalendarEvent.deleteMany({ where: { roomEmail: mailbox } });
      if (made.roomId) {
        await prisma.booking.deleteMany({ where: { roomId: made.roomId } });
        await prisma.roomCompany.deleteMany({ where: { roomId: made.roomId } });
        // The room, person and company stay: their audit rows refer to them.
      }
    }
    await disconnectPrisma();
  });

  test(
    'a room, a recurring booking and its calendar events round-trip',
    { skip: reason },
    async () => {
      const company = await prisma.company.create({
        data: {
          code: `R${tag.slice(0, 6)}`.toUpperCase(),
          nameEn: `Rooms test ${tag}`,
          nameAr: `اختبار ${tag}`,
          domain: `${tag}.rooms-test.example`,
          accentColor: '#336699',
        },
      });
      const user = await prisma.userProfile.create({
        data: {
          entraObjectId: randomUUID(),
          email: `organiser-${tag}@rooms-test.example`,
          companyId: company.id,
          displayNameEn: 'Room Tester',
          displayNameAr: 'مختبر القاعات',
        },
      });
      Object.assign(made, { companyId: company.id, userId: user.id });

      const service = createRoomService({
        store: createPrismaRoomStore(),
        storage: createMemoryStorage(),
        // The default calendar: the MockCalendarEvent table.
        getGraph: async () => createMockGraph(),
        now: () => NOW,
      });
      const req = {
        user: {
          id: user.id,
          companyId: company.id,
          roles: [{ role: 'HoldingAdmin', scopeCompanyId: null }],
        },
      };

      /* ---- the room: equipment and restrictions survive the text columns */
      const room = await service.createRoom(req, {
        mailboxEmail: mailbox,
        nameEn: `Test room ${tag}`,
        nameAr: `قاعة ${tag}`,
        floor: '2',
        capacity: 6,
        equipment: ['screen', 'videoConference'],
        notes: '',
        companyIds: [company.id],
      });
      made.roomId = room.id;
      assert.deepEqual(room.equipment, ['screen', 'videoConference']);
      assert.deepEqual(room.companyIds, [company.id]);
      await assert.rejects(
        service.createRoom(req, { ...room, mailboxEmail: mailbox, companyIds: [] }),
        (err) => err.code === 'mailbox_taken'
      );

      const opened = await service.updateRoom(req, room.id, {
        updatedAt: room.updatedAt.toISOString(),
        capacity: 8,
        equipment: ['whiteboard'],
        companyIds: [],
      });
      assert.deepEqual(
        [opened.capacity, opened.equipment, opened.companyIds],
        [8, ['whiteboard'], []]
      );
      await assert.rejects(
        service.updateRoom(req, room.id, {
          updatedAt: room.updatedAt.toISOString(),
          capacity: 9,
        }),
        (err) => err.code === 'stale_record'
      );
      const listed = (await service.listRooms(req, { equipment: ['whiteboard'], capacity: 8 }))
        .items;
      assert.ok(listed.some((r) => r.id === room.id));

      /* ---- a series: three Mondays, one row and one calendar event each */
      const { items } = await service.book(req, {
        roomId: room.id,
        subject: 'Weekly sync',
        start: at('2026-10-26', 600),
        end: at('2026-10-26', 660),
        attendeeIds: [],
        recurrence: { type: 'weekly', weekdays: [1], until: '2026-11-09' },
      });
      assert.deepEqual(
        items.map((b) => b.start.toISOString()),
        // Summer time ends on 29 October: 10:00 in Cairo moves from 07:00 to 08:00 UTC.
        ['2026-10-26T07:00:00.000Z', '2026-11-02T08:00:00.000Z', '2026-11-09T08:00:00.000Z']
      );
      assert.deepEqual(items[0].recurrence, {
        type: 'weekly',
        weekdays: [1],
        until: '2026-11-09',
      });
      assert.equal(await prisma.mockCalendarEvent.count({ where: { roomEmail: mailbox } }), 3);

      const day = await service.availability(req, {
        date: '2026-11-02',
        view: 'day',
        roomId: room.id,
      });
      assert.deepEqual(day.hours.workingDays, [0, 1, 2, 3, 4]);
      assert.deepEqual(
        day.rooms[0].busy.map((b) => [b.start.toISOString(), b.subject, b.mine]),
        [['2026-11-02T08:00:00.000Z', 'Weekly sync', true]]
      );
      await assert.rejects(
        service.book(req, {
          roomId: room.id,
          subject: 'Clash',
          start: at('2026-11-02', 630),
          end: at('2026-11-02', 690),
          attendeeIds: [],
        }),
        (err) => err.code === 'room_conflict' && err.details.conflicts[0].date === '2026-11-02'
      );

      /* ---- move one, cancel from the second on */
      const moved = await service.updateBooking(req, items[0].id, {
        start: at('2026-10-26', 780),
        end: at('2026-10-26', 840),
      });
      assert.equal(moved.start.toISOString(), '2026-10-26T10:00:00.000Z');

      const cancelled = await service.cancelBooking(req, items[1].id, { scope: 'series' });
      assert.deepEqual(cancelled.cancelled, [items[1].id, items[2].id]);
      const mine = (await service.myBookings(req)).items;
      assert.deepEqual(
        mine.map((b) => b.id),
        [items[0].id]
      );

      // Both sides agree, row by row.
      const rows = await prisma.booking.findMany({ where: { roomId: room.id } });
      const events = await prisma.mockCalendarEvent.findMany({ where: { roomEmail: mailbox } });
      assert.equal(rows.length, 3);
      for (const row of rows) {
        const event = events.find((e) => e.id === row.graphEventId);
        assert.equal(event.isCancelled, row.status === 'cancelled');
        assert.equal(event.startAt.getTime(), row.startAt.getTime());
        assert.equal(event.seriesMasterId, row.seriesMasterId);
      }
      assert.equal(rows.filter((r) => r.status === 'cancelled').length, 2);
      assert.ok(rows.every((r) => r.companyId === company.id && r.organiserId === user.id));

      const admin = await service.listBookingsAdmin(req, {
        companyId: company.id,
        status: 'all',
        page: 1,
        pageSize: 50,
      });
      assert.equal(admin.total, 3);
    }
  );
});
