/**
 * rules.js — when a room may be booked. Pure: no storage, no HTTP, no Graph.
 *
 * Times are stored in UTC and reasoned about on Cairo's clock, through the
 * IANA zone in lib/time.js. Egypt observes daylight saving time, so "10:00
 * every Sunday" is 07:00 UTC in summer and 08:00 UTC in winter: a recurring
 * booking is expanded day by day on the Cairo calendar and each occurrence is
 * converted on its own. Nothing here knows a UTC offset.
 *
 * Errors carry a stable code (docs/API.md) and a sentence a person can act on.
 */

import {
  addDaysYmd,
  cairoWallOf,
  cairoWallToUtc,
  weekdayOfYmd,
} from '@mg/shared/server/lib/time.js';
import { HttpError } from '@mg/shared/server/middleware/errors.js';

export const EQUIPMENT = ['screen', 'videoConference', 'whiteboard', 'phone', 'other'];

/** Bookings start and end on a quarter hour. */
export const SLOT_MINUTES = 15;
export const MIN_MINUTES = 15;
export const MAX_MINUTES = 8 * 60;
export const MAX_DAYS_AHEAD = 90;
export const MAX_RECURRENCE_MONTHS = 6;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** 08:00 to 18:00, Sunday to Thursday: what a company has until it says otherwise. */
export const DEFAULT_HOURS = Object.freeze({
  workdayStartMin: 8 * 60,
  workdayEndMin: 18 * 60,
  workingDays: Object.freeze([0, 1, 2, 3, 4]),
});

const MINUTE = 60_000;
const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** 615 → "10:15". */
export const clock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A company's working hours, with the defaults for anything it has not set. */
export function hoursOf(company) {
  const days = company?.workingDays;
  return {
    workdayStartMin: company?.workdayStartMin ?? DEFAULT_HOURS.workdayStartMin,
    workdayEndMin: company?.workdayEndMin ?? DEFAULT_HOURS.workdayEndMin,
    workingDays: Array.isArray(days) && days.length > 0 ? days : [...DEFAULT_HOURS.workingDays],
  };
}

const describeHours = (hours) =>
  `${clock(hours.workdayStartMin)} to ${clock(hours.workdayEndMin)} Cairo time, ${hours.workingDays
    .map((d) => DAY_NAMES[d])
    .join(', ')}`;

const refuse = (code, message, details) => new HttpError(400, code, message, details);

/**
 * Throws unless [start, end) is a slot this company may book.
 *
 * @param {{ start: Date, end: Date }} slot
 * @param {ReturnType<typeof hoursOf>} hours
 * @param {Date} now
 * @param {{ horizon?: boolean }} [options]  horizon false skips "90 days ahead"
 *   (the later occurrences of a series, which has its own six-month limit)
 */
export function checkSlot({ start, end }, hours, now, { horizon = true } = {}) {
  const step = SLOT_MINUTES * MINUTE;
  if (start.getTime() % step !== 0 || end.getTime() % step !== 0) {
    throw refuse(
      'booking_granularity',
      `Bookings start and end on a quarter hour (:00, :15, :30 or :45).`,
      { minutes: SLOT_MINUTES }
    );
  }

  const minutes = (end.getTime() - start.getTime()) / MINUTE;
  if (minutes < MIN_MINUTES) {
    throw refuse('booking_too_short', `A booking is at least ${MIN_MINUTES} minutes long.`, {
      min: MIN_MINUTES,
    });
  }
  if (minutes > MAX_MINUTES) {
    throw refuse('booking_too_long', `A booking is at most ${MAX_MINUTES / 60} hours long.`, {
      max: MAX_MINUTES,
    });
  }
  if (start.getTime() < now.getTime()) {
    throw refuse('booking_in_past', 'A booking cannot start in the past.');
  }

  const from = cairoWallOf(start);
  const to = cairoWallOf(end);
  if (horizon && from.ymd > addDaysYmd(cairoWallOf(now).ymd, MAX_DAYS_AHEAD)) {
    throw refuse('booking_too_far', `Rooms can be booked up to ${MAX_DAYS_AHEAD} days ahead.`, {
      maxDays: MAX_DAYS_AHEAD,
    });
  }

  const details = { ...hours, timeZone: 'Africa/Cairo' };
  if (!hours.workingDays.includes(from.weekday)) {
    throw refuse(
      'not_a_working_day',
      `${DAY_NAMES[from.weekday]} is not a working day. Rooms can be booked ${describeHours(hours)}.`,
      details
    );
  }
  // An end at midnight belongs to the next calendar day; no working day reaches it.
  const endMin = to.ymd === from.ymd ? to.minutes : 24 * 60;
  if (from.minutes < hours.workdayStartMin || endMin > hours.workdayEndMin) {
    throw refuse(
      'outside_working_hours',
      `That is outside working hours. Rooms can be booked ${describeHours(hours)}.`,
      details
    );
  }
}

/** "2026-10-25" plus six months, clamped by the calendar. */
function addMonthsYmd(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * The occurrences of a booking: the first one, then every later day the rule
 * names, each at the same time on Cairo's clock.
 *
 * daily  = every working day; weekly = the chosen weekdays (0 is Sunday).
 *
 * @param {{ start: Date, end: Date }} first
 * @param {{ type: 'daily' | 'weekly', weekdays?: number[], until: string } | null} rule
 * @param {ReturnType<typeof hoursOf>} hours
 * @returns {{ ymd: string, start: Date, end: Date }[]}
 */
export function expandRecurrence(first, rule, hours) {
  const from = cairoWallOf(first.start);
  const length = first.end.getTime() - first.start.getTime();
  const single = [{ ymd: from.ymd, start: first.start, end: first.end }];
  if (!rule) return single;

  if (rule.until < from.ymd) {
    throw refuse('recurrence_ends_before_start', 'The series ends before it starts.');
  }
  const latest = addMonthsYmd(from.ymd, MAX_RECURRENCE_MONTHS);
  if (rule.until > latest) {
    throw refuse(
      'recurrence_too_long',
      `A recurring booking can run for at most ${MAX_RECURRENCE_MONTHS} months.`,
      { maxMonths: MAX_RECURRENCE_MONTHS, latest }
    );
  }

  let days;
  if (rule.type === 'daily') {
    days = hours.workingDays;
  } else {
    days = [...new Set(rule.weekdays ?? [])].sort();
    const off = days.filter((d) => !hours.workingDays.includes(d));
    if (off.length > 0) {
      throw refuse(
        'not_a_working_day',
        `${off.map((d) => DAY_NAMES[d]).join(', ')} is not a working day.`,
        { ...hours, weekdays: off }
      );
    }
    if (!days.includes(from.weekday)) {
      throw refuse(
        'recurrence_day_mismatch',
        `The first meeting is on a ${DAY_NAMES[from.weekday]}, which the series does not include.`,
        { weekday: from.weekday }
      );
    }
  }

  const out = [];
  for (let ymd = from.ymd; ymd <= rule.until; ymd = addDaysYmd(ymd, 1)) {
    if (!days.includes(weekdayOfYmd(ymd))) continue;
    // Each day is converted on its own: this is what keeps 10:00 at 10:00
    // across the daylight-saving change.
    const start = cairoWallToUtc(ymd, from.minutes);
    out.push({ ymd, start, end: new Date(start.getTime() + length) });
  }
  return out;
}

/** The weekdays a rule falls on, as Exchange wants them for its own series. */
export function weekdaysOf(rule, hours) {
  return rule.type === 'daily' ? [...hours.workingDays] : [...new Set(rule.weekdays)].sort();
}

/** Do two half-open intervals share any time? */
export const overlaps = (a, b) =>
  a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
