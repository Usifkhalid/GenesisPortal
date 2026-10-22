/**
 * time.js — Cairo calendar days as UTC instants. Dates are stored in UTC and
 * shown in Africa/Cairo (CLAUDE.md rule 8); a filter that says "3 March" means
 * Cairo's 3 March, whatever the server's own zone is.
 */

const CAIRO = 'Africa/Cairo';

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAIRO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Cairo's offset from UTC at an instant, in ms. Africa/Cairo observes DST. */
function cairoOffsetMs(instantMs) {
  const p = Object.fromEntries(
    parts.formatToParts(new Date(instantMs)).map(({ type, value }) => [type, Number(value)])
  );
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The UTC instant at which Cairo's calendar day `ymd` ("2026-10-11") begins.
 * @param {string} ymd
 * @returns {Date}
 */
export function cairoDayStart(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d);
  // Two passes settle the days on which the offset itself changes.
  let guess = wallAsUtc - cairoOffsetMs(wallAsUtc);
  guess = wallAsUtc - cairoOffsetMs(guess);
  return new Date(guess);
}

/** The first instant after Cairo's day `ymd`. */
export function cairoDayEnd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return cairoDayStart(next);
}

/** "2026-10-11 14:05:09" in Cairo time, for exports. */
export function formatCairo(date) {
  const p = Object.fromEntries(
    parts.formatToParts(date).map(({ type, value }) => [type, value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * The UTC instant of a time on Cairo's clock: `minutes` after midnight on the
 * calendar day `ymd`. The offset is looked up for that day, so the same wall
 * time lands on a different UTC hour either side of a daylight-saving change.
 * @param {string} ymd  "2026-10-25"
 * @param {number} minutes  600 for 10:00
 * @returns {Date}
 */
export function cairoWallToUtc(ymd, minutes) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = wallAsUtc - cairoOffsetMs(wallAsUtc);
  guess = wallAsUtc - cairoOffsetMs(guess);
  return new Date(guess);
}

/** 0 for Sunday … 6 for Saturday, for a calendar day. */
export function weekdayOfYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The calendar day `days` after `ymd` (before, when negative). */
export function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * An instant as Cairo's clock shows it.
 * @param {Date} date
 * @returns {{ ymd: string, minutes: number, weekday: number }}
 */
export function cairoWallOf(date) {
  const p = Object.fromEntries(
    parts.formatToParts(date).map(({ type, value }) => [type, value])
  );
  const ymd = `${p.year}-${p.month}-${p.day}`;
  return { ymd, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: weekdayOfYmd(ymd) };
}

const DAY_FORMAT = {
  en: new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }),
  ar: new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    timeZone: CAIRO,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }),
};
const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAIRO,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * "Sun, 11 Oct, 10:30–11:00" in Cairo time, once per language, for a
 * notification's text. The range is isolated so it reads left to right inside
 * Arabic, like the pages' time ranges.
 * @param {Date} start
 * @param {Date} end
 * @returns {{ en: string, ar: string }}
 */
export function describeRange(start, end) {
  const range = `${CLOCK_FORMAT.format(start)}–${CLOCK_FORMAT.format(end)}`;
  return {
    en: `${DAY_FORMAT.en.format(start)}, ${range}`,
    ar: `${DAY_FORMAT.ar.format(start)}، \u2066${range}\u2069`,
  };
}
