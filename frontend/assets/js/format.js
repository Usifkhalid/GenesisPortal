/**
 * format.js — dates as people read them. Everything is stored in UTC and
 * shown in Africa/Cairo (CLAUDE.md rule 8), whatever zone the device is in.
 * Digits stay Latin in Arabic too, so they are set by the same face and line
 * up in a column.
 */

import { getLocale } from './i18n.js';

const CAIRO = 'Africa/Cairo';

const locale = () => (getLocale() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

/** "11 Oct 2026, 14:05" */
export function formatDateTime(value) {
  return new Intl.DateTimeFormat(locale(), {
    timeZone: CAIRO,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

/** "11 Oct 2026, 14:05:09": the audit drawer's exact moment. */
export function formatDateTimeSeconds(value) {
  return new Intl.DateTimeFormat(locale(), {
    timeZone: CAIRO,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

/** Today's date in Cairo as "YYYY-MM-DD", for a date input's value. */
export function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO }).format(new Date());
}

/** A whole number in the page's digits. */
export function formatNumber(value) {
  return new Intl.NumberFormat(locale()).format(value);
}

/** "11 Oct 2026" */
export function formatDate(value) {
  return new Intl.DateTimeFormat(locale(), {
    timeZone: CAIRO,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

const cairoParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAIRO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function cairoFields(instantMs) {
  return Object.fromEntries(
    cairoParts
      .formatToParts(new Date(instantMs))
      .map(({ type, value }) => [type, Number(value)])
  );
}

/** Cairo's offset from UTC at an instant, in ms (Cairo observes DST). */
function cairoOffsetMs(instantMs) {
  const p = cairoFields(instantMs);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/**
 * An instant as the value of a datetime-local input, in Cairo time: the
 * input's own zone would be the device's, which on a phone may be anything.
 * @param {string | Date | null | undefined} value
 */
export function toCairoInput(value) {
  if (!value) return '';
  const p = cairoFields(new Date(value).getTime());
  const two = (n) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/**
 * A datetime-local value read as Cairo time, as an ISO instant.
 * @param {string} local  "2026-10-12T14:30"
 * @returns {string | null}
 */
export function fromCairoInput(local) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local ?? '');
  if (!match) return null;
  const [y, mo, d, h, mi] = match.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the nights on which the offset itself changes.
  let guess = wall - cairoOffsetMs(wall);
  guess = wall - cairoOffsetMs(guess);
  return new Date(guess).toISOString();
}

/* ------------------------------------------------------- Cairo calendar days */

const two = (n) => String(n).padStart(2, '0');

/** An instant's calendar day in Cairo, "2026-10-25". */
export function cairoYmd(value) {
  const p = cairoFields(new Date(value).getTime());
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** Minutes after midnight on Cairo's clock. */
export function cairoMinutes(value) {
  const p = cairoFields(new Date(value).getTime());
  return p.hour * 60 + p.minute;
}

/** 615 → "10:15". Latin digits in both languages. */
export const clockOf = (minutes) => `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;

/** An instant as "14:30" on Cairo's clock. */
export const formatTime = (value) => clockOf(cairoMinutes(value));

/**
 * "10:30–10:45" from two clock minutes, as plain text. A range of times reads
 * left to right in Arabic as it does in English, start on the left: the two
 * isolate marks around it keep the surrounding right-to-left text from
 * swapping the times. For text content, attributes and accessible names;
 * markup uses `rangeHtml`.
 */
export const rangeOf = (from, to) => `⁦${clockOf(from)}–${clockOf(to)}⁩`;

/** The same range as markup: `<bdi dir="ltr">10:30–10:45</bdi>`. */
export const rangeHtml = (from, to) => `<bdi dir="ltr">${clockOf(from)}–${clockOf(to)}</bdi>`;

/** The range between two instants on Cairo's clock, as plain text. */
export const formatTimeRange = (start, end) => rangeOf(cairoMinutes(start), cairoMinutes(end));

/** "2026-10-25" moved by whole days. */
export function addDays(ymd, days) {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 0 is Sunday, as in the booking API. */
export const weekdayOf = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/** "Sunday, 25 Oct" for a calendar day (no zone maths: it is only a date). */
export function formatDay(ymd, { weekday = 'long', year = false } = {}) {
  return new Intl.DateTimeFormat(locale(), {
    timeZone: 'UTC',
    weekday,
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
  }).format(new Date(`${ymd}T12:00:00Z`));
}
