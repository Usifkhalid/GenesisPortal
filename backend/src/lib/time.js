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
