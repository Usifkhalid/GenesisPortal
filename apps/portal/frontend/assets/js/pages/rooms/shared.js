/**
 * pages/rooms/shared.js — what the room views have in common: the rooms and
 * the company's working hours (fetched once, kept for a few minutes), how a
 * room and a time are written, the booking calls, and what each refusal says.
 *
 * Times are Cairo's. A calendar day is "2026-10-25" and a clock time is minutes
 * after midnight, so nothing here depends on the device's own zone.
 */

import { ApiError, api, errorKey } from '../../api.js';
import {
  addDays,
  cairoMinutes,
  cairoYmd,
  clockOf,
  formatDay,
  formatTimeRange,
  weekdayOf,
} from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';

/** Every kind of equipment a room can list, in the order it is shown. */
export const EQUIPMENT = ['screen', 'videoConference', 'whiteboard', 'phone', 'other'];

/** The ones worth filtering by: "other" names nothing a person can ask for. */
export const FILTER_EQUIPMENT = EQUIPMENT.filter((key) => key !== 'other');

/** Minutes. A booking is 15 minutes to 8 hours, on the quarter hour. */
export const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 480];

export const SLOT = 15;

/** What a company has until it says otherwise (docs/API.md). */
const DEFAULT_HOURS = {
  workdayStartMin: 480,
  workdayEndMin: 1080,
  workingDays: [0, 1, 2, 3, 4],
};

/* ------------------------------------------------------------------ writing */

export const roomName = (room) => localized(room);

export const equipmentLabel = (key) => t(`rooms.equipment.${key}`);

export function durationLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return t('rooms.time.minutes', { count: rest });
  if (!rest) return t('rooms.time.hours', { count: hours });
  return t('rooms.time.hoursMinutes', { hours, minutes: rest });
}

export const seatsLabel = (room) => t('room.capacityValue', { count: room.capacity });

export const floorLabel = (room) =>
  room.floor ? t('rooms.floorValue', { floor: room.floor }) : t('rooms.floorNone');

/** "8 seats · Floor 1" */
export const roomLine = (room) => `${seatsLabel(room)} · ${floorLabel(room)}`;

/** "Sun, 25 Oct" for a calendar day. */
export const dayLabel = (ymd, weekday = 'short') => formatDay(ymd, { weekday });

/** "10:00–11:30" for two instants, left to right in Arabic too. */
export const spanLabel = (start, end) => formatTimeRange(start, end);

/** "Sun, 25 Oct, 10:00–11:30" for a booking or a free slot. */
export const whenLabel = (start, end) =>
  `${dayLabel(cairoYmd(start))}, ${spanLabel(start, end)}`;

/** "Sunday, Monday" from [0, 1]. */
export const weekdayList = (days) =>
  days.map((day) => t(`rooms.weekday.${day}`)).join(t('rooms.listJoin'));

/** One key/value pair of a label strip. */
export function pair(key, value) {
  return `<div class="labelstrip__pair">
    <dt class="labelstrip__key">${esc(key)}</dt>
    <dd class="labelstrip__value">${value}</dd>
  </div>`;
}

/* -------------------------------------------------------------------- data */

const MEMORY_MS = 5 * 60_000;
const memory = new Map();

/**
 * The rooms this person may use and their company's working hours. The two
 * change rarely, and on weak signal a page should not ask again for each tab.
 *
 * @param {{ company?: { id?: string } }} ctx
 * @returns {Promise<{ rooms: object[], hours: typeof DEFAULT_HOURS }>}
 */
export async function loadEnvironment(ctx) {
  const key = ctx.company?.id ?? '';
  const kept = memory.get(key);
  if (kept && Date.now() - kept.at < MEMORY_MS) return kept.value;

  const { items: rooms, hours } = await api('/api/rooms', { quiet: true });
  const value = { rooms, hours: hours ?? DEFAULT_HOURS };
  memory.set(key, { at: Date.now(), value });
  return value;
}

/** The first bookable moment from now: the next quarter hour inside working hours. */
export function nextSlot(hours, now = new Date()) {
  let date = cairoYmd(now);
  let from = Math.ceil((cairoMinutes(now) + 1) / SLOT) * SLOT;
  for (let i = 0; i < 15; i += 1) {
    if (hours.workingDays.includes(weekdayOf(date))) {
      const start = Math.max(from, hours.workdayStartMin);
      if (start + SLOT <= hours.workdayEndMin) return { date, start };
    }
    date = addDays(date, 1);
    from = 0;
  }
  return { date: cairoYmd(now), start: hours.workdayStartMin };
}

/** The longest duration on offer that still ends inside the working day. */
export function fitDuration(wanted, start, hours) {
  const room = hours.workdayEndMin - start;
  const fits = DURATIONS.filter((d) => d <= room);
  if (fits.length === 0) return SLOT;
  return fits.includes(wanted) ? wanted : (fits.filter((d) => d <= wanted).pop() ?? fits[0]);
}

export const isWorkingDay = (hours, ymd) => hours.workingDays.includes(weekdayOf(ymd));

/** The next calendar day that is a working day, after `ymd`. */
export function nextWorkingDay(hours, ymd) {
  let date = ymd;
  for (let i = 0; i < 8; i += 1) {
    date = addDays(date, 1);
    if (isWorkingDay(hours, date)) return date;
  }
  return date;
}

export function findFree({ date, start, duration, people, equipment }) {
  const params = new URLSearchParams({
    date,
    start: clockOf(start),
    duration: String(duration),
    people: String(people),
  });
  if (equipment.length > 0) params.set('equipment', equipment.join(','));
  return api(`/api/rooms/find?${params}`, { quiet: true });
}

export const myBookings = () => api('/api/bookings/mine', { quiet: true });

export const bookRoom = (body) => api('/api/bookings', { method: 'POST', body, quiet: true });

export const cancelBooking = (id, scope = 'one') =>
  api(`/api/bookings/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { scope },
    quiet: true,
  });

/* ------------------------------------------------------------------ errors */

/**
 * What a refused request says, in the language in use and in terms a person
 * can act on. The server's codes are stable (docs/API.md); a code with no
 * sentence of its own falls back to the portal's general one for its status.
 *
 * @param {unknown} err
 */
export function errorText(err) {
  if (!(err instanceof ApiError)) return t('error.unknown.text');
  const d = err.details ?? {};
  const key = `rooms.error.${err.code}`;
  if (t(key) === key) return t(`${errorKey(err)}.text`);

  return t(key, {
    start: clockOf(d.workdayStartMin ?? DEFAULT_HOURS.workdayStartMin),
    end: clockOf(d.workdayEndMin ?? DEFAULT_HOURS.workdayEndMin),
    days: weekdayList(d.workingDays ?? DEFAULT_HOURS.workingDays),
    capacity: d.capacity ?? '',
    maxDays: d.maxDays ?? 90,
    maxMonths: d.maxMonths ?? 6,
  });
}

/** The times a refused series met something on: "Sun, 25 Oct, 10:00–11:00". */
export function conflictLines(err) {
  const list = err instanceof ApiError ? err.details?.conflicts : null;
  if (!Array.isArray(list)) return [];
  return list.map((c) => whenLabel(c.start, c.end));
}
