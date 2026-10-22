/**
 * sla.js — due dates in business hours.
 *
 * A team's calendar says when its clock runs: the working weekdays and the
 * opening hours on the clock of an IANA time zone, less the public holidays.
 * A target of "8 hours" is 480 minutes of that clock, so a ticket raised on
 * Thursday afternoon is due on Sunday, not on Friday.
 *
 * Nothing here knows an offset. Every opening and closing time is asked of
 * the zone for that calendar day, so a target that spans a daylight-saving
 * change still lands on the right wall-clock time (Egypt changes twice a
 * year).
 *
 *   const schedule = createSchedule(calendar, holidays);
 *   schedule.add(createdAt, 240)        → the instant 240 business minutes on
 *   schedule.between(pausedAt, now)     → business minutes in between
 *   slaDates({ createdAt, policy, pausedMinutes }, schedule)
 *   slaState(ticket, now)               → on_track | at_risk | breached | …
 *
 * Pausing: time a ticket spends Pending (waiting on its requester) does not count. The
 * service adds those business minutes to the ticket's `slaPausedMinutes`, and
 * a due date is always "the target plus the paused minutes, from creation",
 * which is the same instant as stopping the clock and starting it again.
 */

const MINUTE = 60_000;

/** The share of a target after which a ticket is "at risk". */
export const RISK_SHARE = 0.75;

const formatters = new Map();

function formatterFor(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Is this a zone the runtime knows? For validating a calendar. */
export function isTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function fieldsOf(instantMs, timeZone) {
  return Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(instantMs))
      .map(({ type, value }) => [type, Number(value)])
  );
}

const two = (n) => String(n).padStart(2, '0');

/** The calendar day an instant falls on in a zone, "2026-10-25". */
export function zoneDay(date, timeZone) {
  const p = fieldsOf(date.getTime(), timeZone);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** The zone's offset from UTC at an instant, in ms: looked up, never assumed. */
function offsetMs(instantMs, timeZone) {
  const p = fieldsOf(instantMs, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/** The instant of `minutes` after midnight on calendar day `ymd` in a zone. */
export function zoneWallToUtc(ymd, minutes, timeZone) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, minutes);
  // Two passes settle the days on which the offset itself changes.
  let guess = wallAsUtc - offsetMs(wallAsUtc, timeZone);
  guess = wallAsUtc - offsetMs(guess, timeZone);
  return guess;
}

const nextDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

const weekdayOf = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** "0,1,2,3,4" or [0, 1, 2, 3, 4] → [0, 1, 2, 3, 4]. */
export function weekdays(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [
    ...new Set(
      list
        .filter((item) => String(item).trim() !== '')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    ),
  ];
}

/** A team with no calendar row yet works these hours. */
export const DEFAULT_CALENDAR = Object.freeze({
  timeZone: 'Africa/Cairo',
  workingDays: '0,1,2,3,4',
  startMin: 480,
  endMin: 1020,
});

/** How far ahead a due date is looked for before giving up: ten years. */
const MAX_DAYS = 3660;

/**
 * @param {{ timeZone: string, workingDays: string | number[], startMin: number, endMin: number }} calendar
 * @param {Iterable<string>} [holidays]  calendar days, "2026-10-06"
 */
export function createSchedule(calendar = DEFAULT_CALENDAR, holidays = []) {
  const { timeZone, startMin, endMin } = calendar;
  const days = new Set(weekdays(calendar.workingDays));
  const closed = new Set(holidays);
  if (days.size === 0 || !(endMin > startMin)) {
    throw new Error('A business calendar needs a working day and opening hours.');
  }

  const isWorkingDay = (ymd) => days.has(weekdayOf(ymd)) && !closed.has(ymd);

  /** The opening hours of one calendar day as instants, or null when closed. */
  function windowOf(ymd) {
    if (!isWorkingDay(ymd)) return null;
    return {
      open: zoneWallToUtc(ymd, startMin, timeZone),
      close: zoneWallToUtc(ymd, endMin, timeZone),
    };
  }

  /**
   * The instant `minutes` business minutes after `from`. Outside opening
   * hours the count starts at the next opening; a target that ends exactly at
   * closing time is due at closing time, not the next morning.
   * @param {Date} from
   * @param {number} minutes
   * @returns {Date}
   */
  function add(from, minutes) {
    let remaining = Math.max(0, Math.round(minutes)) * MINUTE;
    const start = from.getTime();
    let ymd = zoneDay(from, timeZone);
    for (let i = 0; i < MAX_DAYS; i += 1) {
      const window = windowOf(ymd);
      if (window) {
        const at = Math.max(start, window.open);
        if (at < window.close) {
          const room = window.close - at;
          if (remaining <= room) return new Date(at + remaining);
          remaining -= room;
        }
      }
      ymd = nextDay(ymd);
    }
    throw new Error('No working time found: check the calendar.');
  }

  /**
   * Whole business minutes between two instants (0 when `to` is not later).
   * @param {Date} from
   * @param {Date} to
   */
  function between(from, to) {
    const start = from.getTime();
    const end = to.getTime();
    if (!(end > start)) return 0;
    let total = 0;
    let ymd = zoneDay(from, timeZone);
    const last = zoneDay(to, timeZone);
    for (let i = 0; i < MAX_DAYS; i += 1) {
      const window = windowOf(ymd);
      if (window) {
        const lo = Math.max(start, window.open);
        const hi = Math.min(end, window.close);
        if (hi > lo) total += hi - lo;
      }
      if (ymd === last) break;
      ymd = nextDay(ymd);
    }
    return Math.floor(total / MINUTE);
  }

  return {
    add,
    between,
    isWorkingDay,
    /** Business minutes in one full working day. */
    dayMinutes: endMin - startMin,
    timeZone,
  };
}

/**
 * A ticket's four dates: when the first response and the resolution are due,
 * and when each is 75% used.
 *
 * @param {object} input
 * @param {Date} input.createdAt
 * @param {{ firstResponseMinutes: number, resolveMinutes: number }} input.policy
 * @param {number} [input.pausedMinutes]  business minutes the clock stood still
 * @param {ReturnType<typeof createSchedule>} schedule
 */
export function slaDates({ createdAt, policy, pausedMinutes = 0 }, schedule) {
  const due = (target, share = 1) =>
    schedule.add(createdAt, Math.round(target * share) + pausedMinutes);
  return {
    firstResponseDueAt: due(policy.firstResponseMinutes),
    firstResponseRiskAt: due(policy.firstResponseMinutes, RISK_SHARE),
    resolveDueAt: due(policy.resolveMinutes),
    resolveRiskAt: due(policy.resolveMinutes, RISK_SHARE),
  };
}

/**
 * Where a ticket stands against its target right now.
 *
 *   paused      Pending, waiting on the requester: the clock is stopped
 *   met/missed  closed, in or out of time. The clock stops when the requester
 *               confirms (or a Lead closes the ticket), not when IT sets it to
 *               Resolved (D143); a ticket closed before then is judged by the
 *               day it was resolved
 *   on_track    less than 75% of the target in force is used
 *   at_risk     75% or more is used
 *   breached    the due date has passed
 *
 * The target in force is the first response until an agent has answered, and
 * the resolution after that.
 *
 * @param {{ status: string, slaActive: boolean, nextDueAt: Date, nextRiskAt: Date,
 *   resolveDueAt: Date, resolvedAt?: Date | null, closedAt?: Date | null,
 *   closeMode?: string | null }} ticket
 * @param {Date} now
 */
export function slaState(ticket, now) {
  if (ticket.status === 'Closed') {
    // Tickets closed since D143 carry a closeMode and stopped at closedAt; the
    // older ones closed themselves days after IT resolved them.
    const done = ticket.closeMode ? ticket.closedAt : (ticket.resolvedAt ?? ticket.closedAt);
    return done && done.getTime() > ticket.resolveDueAt.getTime() ? 'missed' : 'met';
  }
  if (!ticket.slaActive) return 'paused';
  const at = now.getTime();
  if (at >= ticket.nextDueAt.getTime()) return 'breached';
  if (at >= ticket.nextRiskAt.getTime()) return 'at_risk';
  return 'on_track';
}
