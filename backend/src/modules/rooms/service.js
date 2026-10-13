/**
 * service.js — rooms and their bookings: the rules, apart from HTTP and from
 * storage.
 *
 * Exchange is the source of truth. A room is a resource mailbox and a booking
 * is an event in the organiser's calendar with the room as a resource
 * attendee; both are reached only through integrations/graph. The portal
 * keeps what Exchange does not (a room's bilingual name, floor, equipment and
 * photo) and one reference row per meeting (Booking), which is how it knows
 * whose a busy time is and who may read its subject. Whether a room is free
 * is always asked of Exchange (getSchedule), never worked out from Booking
 * rows, so a meeting made in Outlook blocks the room here too.
 *
 * Who sees what (docs/DECISIONS.md D86):
 *   - Rooms are shared reference data. Anyone signed in sees and books a room
 *     with no restriction list; a restricted room exists only for the people
 *     of the companies on its list (and a HoldingAdmin).
 *   - Busy times are shared too, with the organiser's name. The subject is
 *     for the organiser, the invited attendees and the administrators of the
 *     organiser's company; to everyone else it is simply busy.
 *   - A booking is a business record of the organiser's company: only the
 *     organiser, or an administrator of that company, may change or cancel
 *     it. An administrator doing so is audited.
 *
 * Errors a screen can act on carry a stable code (docs/API.md):
 *   room_conflict, booking_granularity, booking_too_short, booking_too_long,
 *   booking_in_past, booking_too_far, not_a_working_day, outside_working_hours,
 *   recurrence_too_long, recurrence_ends_before_start, recurrence_day_mismatch,
 *   over_capacity, unknown_attendee, booking_cancelled, booking_finished,
 *   booking_gone, not_recurring, calendar_unavailable, mailbox_taken,
 *   unknown_company, stale_record, unsupported_image, photo_too_large,
 *   empty_upload.
 */

import { randomUUID } from 'node:crypto';

import { GraphError } from '../../integrations/graph/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { detectImage } from '../../lib/image-type.js';
import { logger } from '../../lib/logger.js';
import { bothLanguages } from '../../lib/messages.js';
import { silentNotify } from '../../lib/notify.js';
import {
  adminCompanyIdsFor,
  assertCompanyAdmin,
  assertHoldingAdmin,
  canAdminCompany,
  isHoldingAdmin,
  requireUser,
} from '../../lib/scope.js';
import {
  addDaysYmd,
  cairoDayEnd,
  cairoDayStart,
  cairoWallOf,
  cairoWallToUtc,
  describeRange,
  weekdayOfYmd,
} from '../../lib/time.js';
import { HttpError } from '../../middleware/errors.js';
import {
  MAX_PHOTO_BYTES,
  checkSlot,
  expandRecurrence,
  hoursOf,
  overlaps,
  weekdaysOf,
} from './rules.js';

const notFound = () => new HttpError(404, 'not_found');
const stale = () =>
  new HttpError(409, 'stale_record', 'This record was changed by someone else. Reload it.');

/** How far ahead "my bookings" is checked against Exchange: past any series. */
const RECONCILE_DAYS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const personBrief = (p) =>
  p ? { id: p.id, displayNameEn: p.displayNameEn, displayNameAr: p.displayNameAr } : null;

/** A room as everyone sees it. */
const roomView = (room) => ({
  id: room.id,
  nameEn: room.nameEn,
  nameAr: room.nameAr,
  floor: room.floor,
  capacity: room.capacity,
  equipment: room.equipment,
  photoUrl: room.photoUrl,
  notes: room.notes,
  restricted: room.companyIds.length > 0,
});

/** A room as its administrators see it: the storage key stays inside. */
const adminRoomView = ({ photoKey: _photoKey, ...room }) => room;

const roomSnapshot = (room) => ({
  mailboxEmail: room.mailboxEmail,
  nameEn: room.nameEn,
  nameAr: room.nameAr,
  floor: room.floor,
  capacity: room.capacity,
  equipment: room.equipment,
  notes: room.notes,
  photoUrl: room.photoUrl,
  companyIds: room.companyIds,
  isActive: room.isActive,
});

const bookingSnapshot = (b) => ({
  roomId: b.roomId,
  organiserId: b.organiserId,
  companyId: b.companyId,
  subject: b.subject,
  startAt: b.startAt,
  endAt: b.endAt,
  status: b.status,
  recurring: Boolean(b.seriesMasterId),
});

/**
 * @param {object} deps
 * @param {object} deps.store  see store-prisma.js
 * @param {object} deps.storage  see lib/storage.js
 * @param {() => Promise<import('../../integrations/graph/index.js').GraphClient>} deps.getGraph
 * @param {() => Date} [deps.now]
 * @param {{ warn: Function }} [deps.log]
 * @param {(userIds: string[], key: string, data?: object) => Promise<object>} [deps.notify]
 *   see lib/notify.js
 */
export function createRoomService({
  store,
  storage,
  getGraph,
  now = () => new Date(),
  log = logger,
  notify = silentNotify,
}) {
  /**
   * Tells the organiser of a booking what happened to it. The booking has
   * already changed: a failure here is logged and never fails the request.
   * @param {object} first  the booking row (the first of a series)
   * @param {{ nameEn: string, nameAr: string } | null} room
   * @param {'booking.confirmed' | 'booking.cancelled' | 'booking.moved'} key
   * @param {number} count  how many occurrences the change covers
   * @param {object} [extra]
   */
  async function tellOrganiser(first, room, key, count, extra = {}) {
    try {
      await notify([first.organiserId], key, {
        link: '#rooms/mine',
        room: room ? { en: room.nameEn, ar: room.nameAr || room.nameEn } : '',
        when: describeRange(first.startAt, first.endAt),
        // " (and 3 more)" for a series, nothing for one meeting.
        more:
          count > 1
            ? {
                en: ` ${bothLanguages('notification.more', { count: count - 1 }).en}`,
                ar: ` ${bothLanguages('notification.more', { count: count - 1 }).ar}`,
              }
            : '',
        subject: first.subject,
        ...extra,
      });
    } catch (err) {
      log.warn({ err, bookingId: first.id, key }, 'booking notification failed');
    }
  }

  /* --------------------------------------------------------------- helpers */

  /** A restricted room exists only for its companies' own people. */
  function canUseRoom(req, room) {
    if (!room?.isActive) return false;
    if (room.companyIds.length === 0 || isHoldingAdmin(req)) return true;
    return room.companyIds.includes(requireUser(req).companyId);
  }

  const canSeeSubject = (req, b) => {
    const user = requireUser(req);
    return (
      b.organiserId === user.id ||
      b.attendeeIds.includes(user.id) ||
      canAdminCompany(req, b.companyId)
    );
  };

  const canManage = (req, b) =>
    b.organiserId === requireUser(req).id || canAdminCompany(req, b.companyId);

  const isOpen = (b) => b.status === 'confirmed' && b.endAt.getTime() > now().getTime();

  function bookingView(req, b) {
    const full = canSeeSubject(req, b);
    return {
      id: b.id,
      room: {
        id: b.room.id,
        nameEn: b.room.nameEn,
        nameAr: b.room.nameAr,
        floor: b.room.floor,
      },
      organiser: personBrief(b.organiser),
      start: b.startAt,
      end: b.endAt,
      status: b.status,
      cancelledAt: b.cancelledAt,
      cancelReason: full ? (b.cancelReason ?? null) : null,
      recurring: Boolean(b.seriesMasterId),
      // Only the series' own people may tell which meetings belong together.
      seriesId: full ? (b.seriesMasterId ?? null) : null,
      // Everything below belongs to the meeting, not to the room's timetable.
      subject: full ? b.subject : null,
      recurrence: full ? b.recurrence : null,
      attendeeCount: full ? b.attendeeCount : null,
      attendeeIds: full ? b.attendeeIds : [],
      companyId: full ? b.companyId : null,
      mine: b.organiserId === requireUser(req).id,
      canManage: canManage(req, b) && isOpen(b),
    };
  }

  /** Graph's refusals in the portal's terms; anything else is a fault. */
  function fromGraph(err) {
    if (!(err instanceof GraphError)) return err;
    if (err.code === 'room_conflict') return conflictError(err.details?.conflicts ?? []);
    if (err.code === 'event_not_found') {
      return new HttpError(409, 'booking_gone', 'This meeting is no longer in the calendar.');
    }
    return new HttpError(
      503,
      'calendar_unavailable',
      'The calendar could not be reached. Try again shortly.'
    );
  }

  function conflictError(conflicts) {
    return new HttpError(
      409,
      'room_conflict',
      conflicts.length > 1
        ? `The room is already booked at ${conflicts.length} of those times. Nothing was booked.`
        : 'The room is already booked at that time.',
      {
        conflicts: conflicts.map((c) => ({
          date: cairoWallOf(c.start).ymd,
          start: c.start,
          end: c.end,
        })),
      }
    );
  }

  /**
   * The person a Graph calendar call acts as. Their own token is offered only
   * when they are the one making the request (session 19 puts
   * `req.getGraphToken` there); an administrator acting on someone else's
   * meeting goes without, and the real client uses the application permission.
   */
  async function organiserFor(req, userId) {
    const [person] = await store.getUsers([userId]);
    if (!person) throw notFound();
    const self = req?.user?.id === userId;
    return {
      email: person.email,
      entraObjectId: person.entraObjectId,
      getAccessToken: self ? (req.getGraphToken ?? null) : null,
    };
  }

  async function hoursFor(companyId) {
    return hoursOf(await store.getCompany(companyId));
  }

  /** The wanted times that meet something already in the room's calendar. */
  async function findConflicts(graph, room, wanted, ignore = null) {
    const first = wanted[0].start;
    const last = wanted[wanted.length - 1].end;
    const [schedule] = await graph.getSchedule([room.mailboxEmail], first, last);
    const taken = (schedule?.items ?? []).filter((item) => {
      if (!ignore) return true;
      // The meeting being moved is not in its own way. Exchange's free/busy
      // has no event ids, so the fallback is its current time.
      if (item.eventId) return item.eventId !== ignore.graphEventId;
      return !(
        item.start.getTime() === ignore.startAt.getTime() &&
        item.end.getTime() === ignore.endAt.getTime()
      );
    });
    return wanted.filter((w) => taken.some((item) => overlaps(w, item)));
  }

  function matchFilters(room, { capacity, equipment, floor }) {
    return (
      (!capacity || room.capacity >= capacity) &&
      (!floor || room.floor === floor) &&
      (equipment ?? []).every((item) => room.equipment.includes(item))
    );
  }

  async function usableRooms(req, filters = {}) {
    const rooms = await store.listRooms();
    return rooms.filter((room) => canUseRoom(req, room) && matchFilters(room, filters));
  }

  async function usableRoom(req, id) {
    const room = await store.getRoom(id);
    if (!canUseRoom(req, room)) throw notFound();
    return room;
  }

  /* ----------------------------------------------------------------- rooms */

  async function listRooms(req, filters) {
    const user = requireUser(req);
    const [rooms, hours] = await Promise.all([
      usableRooms(req, filters),
      hoursFor(user.companyId),
    ]);
    return { items: rooms.map(roomView), hours };
  }

  async function getRoom(req, id) {
    requireUser(req);
    return roomView(await usableRoom(req, id));
  }

  /** When the rooms are busy, for one Cairo day or its Sunday-to-Saturday week. */
  async function availability(req, { date, view, roomId, ...filters }) {
    const user = requireUser(req);
    const first = view === 'week' ? addDaysYmd(date, -weekdayOfYmd(date)) : date;
    const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) =>
      addDaysYmd(first, i)
    );
    const from = cairoDayStart(first);
    const to = cairoDayEnd(days[days.length - 1]);

    const rooms = roomId ? [await usableRoom(req, roomId)] : await usableRooms(req, filters);
    const hours = await hoursFor(user.companyId);
    if (rooms.length === 0) return { from, to, days, hours, rooms: [] };

    const graph = await getGraph();
    const [schedules, known] = await Promise.all([
      graph.getSchedule(
        rooms.map((r) => r.mailboxEmail),
        from,
        to
      ),
      store.listBookings({
        roomIds: rooms.map((r) => r.id),
        status: 'confirmed',
        overlapFrom: from,
        overlapTo: to,
      }),
    ]);
    const byEvent = new Map(known.items.map((b) => [b.graphEventId, b]));
    const byTime = new Map(
      known.items.map((b) => [`${b.roomId}/${b.startAt.getTime()}/${b.endAt.getTime()}`, b])
    );
    const busyOf = new Map(schedules.map((s) => [s.roomEmail, s.items]));

    return {
      from,
      to,
      days,
      hours,
      rooms: rooms.map((room) => ({
        room: roomView(room),
        busy: (busyOf.get(room.mailboxEmail) ?? []).map((item) => {
          // A busy time the portal has no row for was booked in Outlook: it
          // blocks the room all the same, and the portal knows nothing more.
          const booking =
            (item.eventId && byEvent.get(item.eventId)) ||
            byTime.get(`${room.id}/${item.start.getTime()}/${item.end.getTime()}`) ||
            null;
          const full = booking ? canSeeSubject(req, booking) : false;
          return {
            start: item.start,
            end: item.end,
            organiser: personBrief(booking?.organiser),
            subject: full ? booking.subject : null,
            bookingId: full ? booking.id : null,
            mine: booking?.organiserId === user.id,
          };
        }),
      })),
    };
  }

  /** The rooms free for a slot, smallest that fits first. */
  async function findFree(req, { date, start: startMin, duration, people, equipment }) {
    const user = requireUser(req);
    const start = cairoWallToUtc(date, startMin);
    const slot = { start, end: new Date(start.getTime() + duration * 60_000) };
    checkSlot(slot, await hoursFor(user.companyId), now());

    const rooms = await usableRooms(req, { capacity: people, equipment });
    if (rooms.length === 0) return { ...slot, rooms: [] };

    const graph = await getGraph();
    const schedules = await graph.getSchedule(
      rooms.map((r) => r.mailboxEmail),
      slot.start,
      slot.end
    );
    const busy = new Set(
      schedules
        .filter((s) => s.items.some((item) => overlaps(slot, item)))
        .map((s) => s.roomEmail)
    );
    return {
      ...slot,
      rooms: rooms
        .filter((room) => !busy.has(room.mailboxEmail))
        .sort((a, b) => a.capacity - b.capacity || a.nameEn.localeCompare(b.nameEn))
        .map(roomView),
    };
  }

  /* -------------------------------------------------------------- bookings */

  async function book(req, body) {
    const user = requireUser(req);
    const room = await usableRoom(req, body.roomId);
    const hours = await hoursFor(user.companyId);
    const at = now();

    const attendeeIds = [...new Set(body.attendeeIds)].filter((id) => id !== user.id);
    const attendees = await store.getUsers(attendeeIds);
    if (attendees.length !== attendeeIds.length || attendees.some((a) => !a.isActive)) {
      throw new HttpError(400, 'unknown_attendee', 'One of the people invited was not found.');
    }
    const attendeeCount = body.attendeeCount ?? attendeeIds.length + 1;
    if (attendeeCount > room.capacity) {
      throw new HttpError(
        400,
        'over_capacity',
        `This room seats ${room.capacity}. Choose a larger room.`,
        { capacity: room.capacity }
      );
    }

    const first = { start: body.start, end: body.end };
    checkSlot(first, hours, at);
    const rule = body.recurrence ?? null;
    const occurrences = expandRecurrence(first, rule, hours);
    for (const occurrence of occurrences.slice(1))
      checkSlot(occurrence, hours, at, { horizon: false });

    // Every occurrence is checked before anything is created: a series is
    // booked whole or not at all.
    const graph = await getGraph();
    const conflicts = await findConflicts(graph, room, occurrences);
    if (conflicts.length > 0) throw conflictError(conflicts);

    let created;
    try {
      created = await graph.createEvent({
        organiser: await organiserFor(req, user.id),
        room: { email: room.mailboxEmail, name: room.nameEn },
        subject: body.subject,
        start: first.start,
        end: first.end,
        recurrence: rule
          ? {
              daysOfWeek: weekdaysOf(rule, hours),
              startDate: occurrences[0].ymd,
              endDate: rule.until,
            }
          : null,
        attendees: attendees.map((a) => a.email),
        occurrences: occurrences.map(({ start, end }) => ({ start, end })),
      });
    } catch (err) {
      // Someone took the room between the check and the booking.
      throw fromGraph(err);
    }

    const rows = created.events.map((event) => ({
      graphEventId: event.id,
      seriesMasterId: created.seriesMasterId,
      roomId: room.id,
      organiserId: user.id,
      companyId: user.companyId,
      subject: body.subject,
      startAt: event.start,
      endAt: event.end,
      recurrence: rule,
      attendeeCount,
      attendeeIds,
    }));

    let saved;
    try {
      saved = await store.transaction((tx) => tx.createBookings(rows));
    } catch (err) {
      // The calendar has the meeting and the portal does not: take it back out.
      await graph
        .cancelEvent({
          organiser: await organiserFor(req, user.id),
          eventId: created.events[0].id,
          scope: created.seriesMasterId ? 'series' : 'one',
        })
        .catch((undo) => log.warn({ err: undo }, 'could not undo a calendar event'));
      throw err;
    }
    await tellOrganiser(saved[0], room, 'booking.confirmed', saved.length);
    return { items: saved.map((b) => bookingView(req, b)) };
  }

  /**
   * Brings the organiser's rows in line with Exchange: a meeting deleted or
   * moved in Outlook is cancelled or moved here. Exchange not answering (or,
   * until session 19, having no token to ask with) leaves the rows as they are.
   */
  async function reconcile(req, rows) {
    const user = requireUser(req);
    const at = now();
    let events;
    try {
      const graph = await getGraph();
      events = await graph.listMyEvents({
        organiser: await organiserFor(req, user.id),
        start: at,
        end: new Date(at.getTime() + RECONCILE_DAYS * DAY_MS),
      });
    } catch (err) {
      log.warn({ err }, 'bookings not checked against the calendar');
      return rows;
    }

    const live = new Map(events.map((e) => [e.id, e]));
    const gone = [];
    const out = [];
    for (const row of rows) {
      const event = live.get(row.graphEventId);
      // A meeting already under way is outside the window asked for: leave it.
      if (!event) {
        if (row.startAt.getTime() >= at.getTime()) gone.push(row.id);
        else out.push(row);
      } else if (
        event.start.getTime() !== row.startAt.getTime() ||
        event.end.getTime() !== row.endAt.getTime()
      ) {
        out.push(await store.updateBooking(row.id, { startAt: event.start, endAt: event.end }));
      } else out.push(row);
    }
    if (gone.length > 0) await store.cancelBookings(gone, { at, byId: null });
    return out.sort((a, b) => a.startAt - b.startAt);
  }

  async function myBookings(req) {
    const user = requireUser(req);
    const { items } = await store.listBookings({
      organiserId: user.id,
      status: 'confirmed',
      endAfter: now(),
    });
    return { items: (await reconcile(req, items)).map((b) => bookingView(req, b)) };
  }

  /** The row, for someone allowed to know the meeting: otherwise 404. */
  async function knownBooking(req, id) {
    requireUser(req);
    const row = await store.getBooking(id);
    if (!row || !canSeeSubject(req, row)) throw notFound();
    return row;
  }

  async function getBooking(req, id) {
    return bookingView(req, await knownBooking(req, id));
  }

  /** The row, for someone allowed to change it. An invited attendee is 403. */
  async function managedBooking(req, id) {
    const row = await knownBooking(req, id);
    if (!canManage(req, row)) throw new HttpError(403, 'forbidden');
    if (row.status !== 'confirmed') {
      throw new HttpError(409, 'booking_cancelled', 'This booking was cancelled.');
    }
    if (row.endAt.getTime() <= now().getTime()) {
      throw new HttpError(409, 'booking_finished', 'This meeting is already over.');
    }
    return row;
  }

  /** Marks rows cancelled because Exchange no longer has their event. */
  const dropGone = (row) => store.cancelBookings([row.id], { at: now(), byId: null });

  /**
   * One occurrence's subject, time or room. An administrator moving someone
   * else's meeting says why; the organiser is told what changed and why.
   */
  async function updateBooking(req, id, body) {
    const user = requireUser(req);
    const row = await managedBooking(req, id);
    const at = now();
    const byAdmin = row.organiserId !== user.id;

    const rescheduled =
      body.start !== undefined &&
      (body.start.getTime() !== row.startAt.getTime() ||
        body.end.getTime() !== row.endAt.getTime());
    const roomChanged = body.roomId !== undefined && body.roomId !== row.roomId;
    const renamed = body.subject !== undefined && body.subject !== row.subject;
    if (!rescheduled && !roomChanged && !renamed) return bookingView(req, row);

    const moved = rescheduled || roomChanged;
    if (moved && byAdmin && !body.reason) {
      throw new HttpError(400, 'reason_required', 'Say why this booking is being moved.');
    }

    const graph = await getGraph();
    const oldRoom = await store.getRoom(row.roomId);
    let room = oldRoom;
    if (roomChanged) {
      room = await usableRoom(req, body.roomId);
      // The room must be one the booking's own company may use.
      if (room.companyIds.length > 0 && !room.companyIds.includes(row.companyId)) {
        throw notFound();
      }
    }
    if (moved) {
      const slot = rescheduled
        ? { start: body.start, end: body.end }
        : { start: row.startAt, end: row.endAt };
      checkSlot(slot, await hoursFor(row.companyId), at);
      const conflicts = await findConflicts(graph, room, [slot], roomChanged ? null : row);
      if (conflicts.length > 0) throw conflictError(conflicts);
    }

    try {
      await graph.updateEvent({
        organiser: await organiserFor(req, row.organiserId),
        eventId: row.graphEventId,
        ...(renamed ? { subject: body.subject } : {}),
        ...(rescheduled ? { start: body.start, end: body.end } : {}),
        ...(roomChanged ? { room: { email: room.mailboxEmail, name: room.nameEn } } : {}),
      });
    } catch (err) {
      if (err instanceof GraphError && err.code === 'event_not_found') await dropGone(row);
      throw fromGraph(err);
    }

    const patch = {
      ...(renamed ? { subject: body.subject } : {}),
      ...(rescheduled ? { startAt: body.start, endAt: body.end } : {}),
      ...(roomChanged ? { roomId: room.id } : {}),
    };
    const after = await store.transaction(async (tx) => {
      const updated = await tx.updateBooking(row.id, patch);
      if (byAdmin) {
        await writeAudit(
          req,
          'booking.admin.update',
          'Booking',
          bookingSnapshot(row),
          { ...bookingSnapshot(updated), ...(body.reason ? { reason: body.reason } : {}) },
          { tx, entityId: row.id, companyId: row.companyId }
        );
      }
      return updated;
    });

    if (byAdmin && moved) {
      const [person] = await store.getUsers([user.id]).catch(() => []);
      const was = describeRange(row.startAt, row.endAt);
      const wasEn = oldRoom?.nameEn ?? '';
      const wasAr = oldRoom?.nameAr || wasEn;
      await tellOrganiser(after, room, 'booking.moved', 1, {
        actor: person
          ? { en: person.displayNameEn, ar: person.displayNameAr || person.displayNameEn }
          : '',
        reason: body.reason,
        was: { en: `${wasEn}, ${was.en}`, ar: `${wasAr}، ${was.ar}` },
      });
    }
    return bookingView(req, after);
  }

  /** One occurrence, or it and every later one of its series. */
  async function cancelBooking(req, id, { scope, reason }) {
    const user = requireUser(req);
    const row = await managedBooking(req, id);
    const at = now();
    // Someone else's meeting is not taken away without a word: the reason is
    // kept on the booking and in the audit log, for the organiser to be told.
    const byAdmin = row.organiserId !== user.id;
    if (byAdmin && !reason) {
      throw new HttpError(400, 'reason_required', 'Say why this booking is being cancelled.');
    }
    if (scope === 'series' && !row.seriesMasterId) {
      throw new HttpError(400, 'not_recurring', 'This booking is not part of a series.');
    }

    let targets = [row];
    if (scope === 'series') {
      const { items } = await store.listBookings({
        seriesMasterId: row.seriesMasterId,
        status: 'confirmed',
        startFrom: row.startAt,
      });
      targets = items;
    }

    try {
      const graph = await getGraph();
      await graph.cancelEvent({
        organiser: await organiserFor(req, row.organiserId),
        eventId: row.graphEventId,
        scope,
        from: row.startAt,
      });
    } catch (err) {
      // Already gone from the calendar is what was asked for.
      if (!(err instanceof GraphError && err.code === 'event_not_found')) throw fromGraph(err);
    }

    await store.transaction(async (tx) => {
      await tx.cancelBookings(
        targets.map((t) => t.id),
        { at, byId: user.id, reason: reason ?? null }
      );
      // The organiser is told once this is saved (tellOrganiser, below).
      if (byAdmin) {
        await writeAudit(
          req,
          'booking.admin.cancel',
          'Booking',
          bookingSnapshot(row),
          {
            ...bookingSnapshot(row),
            status: 'cancelled',
            scope,
            cancelled: targets.length,
            reason,
          },
          { tx, entityId: row.id, companyId: row.companyId }
        );
      }
    });
    // The organiser is always told: a receipt for their own, the reason for
    // an administrator's.
    const room = await store.getRoom(row.roomId).catch(() => null);
    let actor = '';
    if (byAdmin) {
      const [person] = await store.getUsers([user.id]).catch(() => []);
      actor = person
        ? { en: person.displayNameEn, ar: person.displayNameAr || person.displayNameEn }
        : '';
    }
    await tellOrganiser(row, room, 'booking.cancelled', targets.length, {
      ...(byAdmin ? { actor, reason: reason ?? '' } : {}),
    });
    return { cancelled: targets.map((t) => t.id) };
  }

  /* ----------------------------------------------------------------- admin */

  /** Every booking of the administrator's companies, subjects included. */
  async function listBookingsAdmin(
    req,
    { roomId, companyId, from, to, status, page, pageSize }
  ) {
    const adminIds = adminCompanyIdsFor(req);
    if (companyId) assertCompanyAdmin(req, companyId);
    else if (adminIds !== null && adminIds.length === 0) throw new HttpError(403, 'forbidden');

    const { items, total } = await store.listBookings({
      ...(companyId ? { companyIds: [companyId] } : adminIds ? { companyIds: adminIds } : {}),
      ...(roomId ? { roomIds: [roomId] } : {}),
      ...(status === 'all' ? {} : { status }),
      ...(from ? { overlapFrom: cairoDayStart(from) } : {}),
      ...(to ? { overlapTo: cairoDayEnd(to) } : {}),
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: items.map((b) => bookingView(req, b)), total, page, pageSize };
  }

  async function listRoomsAdmin(req) {
    assertHoldingAdmin(req);
    const rooms = await store.listRooms({ includeInactive: true });
    return { items: rooms.map(adminRoomView) };
  }

  /** Exchange's room mailboxes, and which of them the portal already has. */
  async function listMailboxes(req) {
    assertHoldingAdmin(req);
    const graph = await getGraph();
    const [mailboxes, rooms] = await Promise.all([
      graph.listRooms(),
      store.listRooms({ includeInactive: true }),
    ]);
    const known = new Map(rooms.map((r) => [r.mailboxEmail, r.id]));
    return {
      items: mailboxes.map((m) => ({ ...m, roomId: known.get(m.emailAddress) ?? null })),
    };
  }

  async function assertCompaniesExist(tx, companyIds) {
    const found = await tx.existingCompanyIds(companyIds);
    if (found.length !== companyIds.length) {
      throw new HttpError(400, 'unknown_company', 'One of those companies does not exist.');
    }
  }

  async function createRoom(req, body) {
    assertHoldingAdmin(req);
    return store.transaction(async (tx) => {
      if (await tx.findRoomByEmail(body.mailboxEmail)) {
        throw new HttpError(409, 'mailbox_taken', 'A room already uses that mailbox.');
      }
      await assertCompaniesExist(tx, body.companyIds);
      const room = await tx.createRoom({ ...body, isActive: true });
      await writeAudit(req, 'room.create', 'Room', null, roomSnapshot(room), {
        tx,
        entityId: room.id,
        companyId: null,
      });
      return adminRoomView(room);
    });
  }

  async function updateRoom(req, id, { updatedAt, ...changes }) {
    assertHoldingAdmin(req);
    if (Object.keys(changes).length === 0) {
      throw new HttpError(400, 'nothing_to_change', 'Nothing to change.');
    }
    return store.transaction(async (tx) => {
      const before = await tx.getRoom(id);
      if (!before) throw notFound();
      if (changes.companyIds) await assertCompaniesExist(tx, changes.companyIds);

      const after = await tx.updateRoom(id, changes, new Date(updatedAt));
      if (!after) throw stale();
      await writeAudit(req, 'room.update', 'Room', roomSnapshot(before), roomSnapshot(after), {
        tx,
        entityId: id,
        companyId: null,
      });
      return adminRoomView(after);
    });
  }

  /** The same checks as an announcement's cover: size, then the file's own signature. */
  async function setPhoto(req, id, buffer, updatedAt) {
    assertHoldingAdmin(req);
    const existing = await store.getRoom(id);
    if (!existing) throw notFound();

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new HttpError(400, 'empty_upload', 'No file was sent.');
    }
    if (buffer.length > MAX_PHOTO_BYTES) {
      throw new HttpError(413, 'photo_too_large', 'The photo is larger than 2 MB.');
    }
    const kind = detectImage(buffer);
    if (!kind) {
      throw new HttpError(
        415,
        'unsupported_image',
        'The photo must be a PNG, JPEG or WebP image.'
      );
    }

    const token = randomUUID();
    const photoKey = `room-${id}-${token}.${kind.ext}`;
    const photoUrl = `/api/rooms/${id}/photo?v=${token}`;
    await storage.put(photoKey, buffer);
    let after;
    try {
      after = await store.transaction(async (tx) => {
        const updated = await tx.updateRoom(id, { photoKey, photoUrl }, new Date(updatedAt));
        if (!updated) throw stale();
        await writeAudit(
          req,
          'room.photo.update',
          'Room',
          roomSnapshot(existing),
          roomSnapshot(updated),
          { tx, entityId: id, companyId: null }
        );
        return updated;
      });
    } catch (err) {
      await storage.remove(photoKey);
      throw err;
    }
    if (existing.photoKey) await storage.remove(existing.photoKey);
    return adminRoomView(after);
  }

  async function removePhoto(req, id, updatedAt) {
    assertHoldingAdmin(req);
    const existing = await store.getRoom(id);
    if (!existing) throw notFound();
    if (!existing.photoKey) return adminRoomView(existing);

    const after = await store.transaction(async (tx) => {
      const updated = await tx.updateRoom(
        id,
        { photoKey: null, photoUrl: null },
        new Date(updatedAt)
      );
      if (!updated) throw stale();
      await writeAudit(
        req,
        'room.photo.remove',
        'Room',
        roomSnapshot(existing),
        roomSnapshot(updated),
        { tx, entityId: id, companyId: null }
      );
      return updated;
    });
    await storage.remove(existing.photoKey);
    return adminRoomView(after);
  }

  /** The photo's bytes, for anyone who may use the room, or its administrator. */
  async function readPhoto(req, id) {
    requireUser(req);
    const room = await store.getRoom(id);
    if (!room?.photoKey || !(canUseRoom(req, room) || isHoldingAdmin(req))) throw notFound();
    const buffer = await storage.get(room.photoKey);
    const kind = buffer && detectImage(buffer);
    if (!kind) throw notFound();
    return { type: kind.type, buffer };
  }

  return {
    listRooms,
    getRoom,
    availability,
    findFree,
    book,
    myBookings,
    getBooking,
    updateBooking,
    cancelBooking,
    listBookingsAdmin,
    listRoomsAdmin,
    listMailboxes,
    createRoom,
    updateRoom,
    setPhoto,
    removePhoto,
    readPhoto,
  };
}
