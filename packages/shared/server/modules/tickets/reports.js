/**
 * reports.js — the IT Helpdesk's reports (D135): what came in over a range of
 * days, and how the team did against its targets.
 *
 * The range is calendar days on Cairo's clock, both ends included, over the
 * day each ticket was raised; 30 days to today when none is asked for, a year
 * at most. The tickets are the ones the reader serves (their teams, and the
 * companies each team serves), as in the queue.
 *
 *   counts      by status, priority, category, company and location
 *   SLA         first response and resolution: met, breached, or still open
 *               and within target ("pending")
 *   averages    business minutes on the team's clock from raising to the first
 *               response, and to resolution (less the minutes the clock stood
 *               still while Pending)
 *   satisfaction  over the tickets CLOSED in the range (not raised in it): how
 *               many the requester confirmed and how many a lead closed
 *               without confirmation, the share of rated tickets with 4 or 5
 *               stars, the average rating, per agent (the assignee) and per
 *               category (D143)
 *
 * The CSV is one row per ticket with the same facts, for a spreadsheet.
 */

import { toCsv } from '../../lib/csv.js';
import { addDaysYmd, cairoDayEnd, cairoDayStart, formatCairo } from '../../lib/time.js';
import { zoneDay } from '../../lib/sla.js';
import { HttpError } from '../../middleware/errors.js';
import { PRIORITIES, STATUSES } from './rules.js';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;

/**
 * Met when it happened by the due date; breached when it happened late, or
 * has not happened and the due date has passed; otherwise pending.
 * @returns {'met' | 'breached' | 'pending'}
 */
export function targetState(doneAt, dueAt, now) {
  if (doneAt) return doneAt.getTime() <= dueAt.getTime() ? 'met' : 'breached';
  return now.getTime() > dueAt.getTime() ? 'breached' : 'pending';
}

/**
 * When the resolution clock stopped: the day the requester confirmed (or a
 * lead closed it), not the day IT set Resolved (D143). A ticket closed before
 * that rule closed itself days after it was resolved, so it keeps its
 * resolved date; a ticket that is Resolved and not yet closed is still running.
 */
const resolutionAt = (t) =>
  t.status === 'Closed' ? (t.closeMode ? t.closedAt : (t.resolvedAt ?? t.closedAt)) : null;

const average = (list) =>
  list.length ? Math.round(list.reduce((sum, n) => sum + n, 0) / list.length) : null;

/** Stars out of 5 to one decimal, or null when nothing was rated. */
const averageStars = (stars) =>
  stars.length
    ? Math.round((stars.reduce((sum, n) => sum + n, 0) / stars.length) * 10) / 10
    : null;

/**
 * What satisfaction means for a set of closed tickets: how they were closed and
 * what the requesters said. Satisfied is 4 or 5 stars, out of all that were rated.
 */
export function satisfactionOf(tickets) {
  const stars = tickets.filter((t) => t.rating != null).map((t) => t.rating);
  const satisfied = stars.filter((n) => n >= 4).length;
  return {
    closed: tickets.length,
    confirmed: tickets.filter((t) => t.closeMode === 'confirmed').length,
    closedByLead: tickets.filter((t) => t.closeMode === 'lead').length,
    rated: stars.length,
    satisfied,
    satisfiedPercent: stars.length ? Math.round((satisfied / stars.length) * 100) : null,
    averageRating: averageStars(stars),
  };
}

/**
 * @param {object} deps
 * @param {object} deps.store  see store-prisma.js
 * @param {{ staffScopes: (req: object) => Promise<object[]>, scheduleFor: (teamId: string) => Promise<object> }} deps.tickets
 *   the ticket service
 * @param {() => Date} [deps.now]
 */
export function createReportService({ store, tickets, now = () => new Date() }) {
  /** The days asked for, checked; the last 30 days by default. */
  function rangeOf({ from, to }) {
    const today = zoneDay(now(), 'Africa/Cairo');
    const last = to ?? (from && from > today ? from : today);
    const first = from ?? addDaysYmd(last, -(DEFAULT_DAYS - 1));
    if (first > last) throw new HttpError(400, 'bad_range', 'The start is after the end.');
    if (first < addDaysYmd(last, -(MAX_DAYS - 1))) {
      throw new HttpError(400, 'bad_range', `At most ${MAX_DAYS} days at a time.`);
    }
    return { from: first, to: last };
  }

  /** The tickets in range with what every report row needs, worked out once. */
  async function facts(req, query, scopesAsked) {
    const scopes = scopesAsked ?? (await tickets.staffScopes(req));
    const range = rangeOf(query);
    const { items } = await store.listTickets({
      scopes,
      createdFrom: cairoDayStart(range.from),
      createdBefore: cairoDayEnd(range.to),
      order: 'recent',
    });
    const at = now();
    const schedules = new Map();
    const scheduleOf = async (teamId) => {
      if (!schedules.has(teamId)) schedules.set(teamId, await tickets.scheduleFor(teamId));
      return schedules.get(teamId);
    };
    const rows = [];
    for (const t of items) {
      const schedule = await scheduleOf(t.teamId);
      const done = resolutionAt(t);
      rows.push({
        ticket: t,
        firstResponse: targetState(t.firstRespondedAt, t.firstResponseDueAt, at),
        resolution: targetState(done, t.resolveDueAt, at),
        firstResponseMinutes: t.firstRespondedAt
          ? schedule.between(t.createdAt, t.firstRespondedAt)
          : null,
        resolveMinutes: done
          ? Math.max(0, schedule.between(t.createdAt, done) - (t.slaPausedMinutes ?? 0))
          : null,
      });
    }
    return { range, rows };
  }

  /** Names for the ids the rows refer to. */
  async function namesFor(rows) {
    const ids = (key) => [...new Set(rows.map((r) => r.ticket[key]).filter(Boolean))];
    const [categories, locations, companies, people] = await Promise.all([
      store.find('category', { id: ids('categoryId') }),
      store.find('location', { id: ids('locationId') }),
      store.listCompanies(),
      store.getUsers(ids('assigneeId')),
    ]);
    const byId = (list) => new Map(list.map((x) => [x.id, x]));
    return {
      category: byId(categories),
      location: byId(locations),
      company: byId(companies),
      person: byId(people),
    };
  }

  /** Satisfaction over the tickets closed in the range, as a whole, per agent and per category. */
  async function satisfaction(scopes, range) {
    const { items } = await store.listTickets({
      scopes,
      closedFrom: cairoDayStart(range.from),
      closedBefore: cairoDayEnd(range.to),
      statuses: ['Closed'],
      order: 'recent',
    });
    const [categories, people] = await Promise.all([
      store.find('category', { id: [...new Set(items.map((t) => t.categoryId))] }),
      store.getUsers([...new Set(items.map((t) => t.assigneeId).filter(Boolean))]),
    ]);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const personById = new Map(people.map((p) => [p.id, p]));

    const groupBy = (key, describe) => {
      const groups = new Map();
      for (const t of items) {
        const id = t[key] ?? null;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(t);
      }
      return [...groups.entries()]
        .map(([id, list]) => ({ id, ...describe(id), ...satisfactionOf(list) }))
        .sort(
          (a, b) =>
            b.closed - a.closed || String(a.nameEn ?? '').localeCompare(String(b.nameEn ?? ''))
        );
    };

    return {
      ...satisfactionOf(items),
      byAgent: groupBy('assigneeId', (id) => ({
        nameEn: personById.get(id)?.displayNameEn ?? null,
        nameAr: personById.get(id)?.displayNameAr || personById.get(id)?.displayNameEn || null,
      })),
      byCategory: groupBy('categoryId', (id) => ({
        nameEn: categoryById.get(id)?.nameEn ?? null,
        nameAr: categoryById.get(id)?.nameAr ?? null,
      })),
    };
  }

  /** GET /api/helpdesk/reports */
  async function report(req, query) {
    const scopes = await tickets.staffScopes(req);
    const { range, rows } = await facts(req, query, scopes);
    const names = await namesFor(rows);

    const tally = (key, order) => {
      const counts = new Map();
      for (const r of rows) {
        const value = r.ticket[key] ?? null;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const keys = order ?? [...counts.keys()];
      return keys.map((value) => ({ key: value, count: counts.get(value) ?? 0 }));
    };
    const named = (list, map, extra = () => ({})) =>
      list
        .map(({ key, count }) => {
          const row = key ? map.get(key) : null;
          return {
            id: key,
            nameEn: row?.nameEn ?? null,
            nameAr: row?.nameAr ?? null,
            ...extra(row),
            count,
          };
        })
        .sort((a, b) => b.count - a.count || (a.nameEn ?? '').localeCompare(b.nameEn ?? ''));
    const states = (key) => ({
      met: rows.filter((r) => r[key] === 'met').length,
      breached: rows.filter((r) => r[key] === 'breached').length,
      pending: rows.filter((r) => r[key] === 'pending').length,
    });
    const minutes = (key) => rows.map((r) => r[key]).filter((n) => n !== null);

    return {
      from: range.from,
      to: range.to,
      total: rows.length,
      byStatus: tally('status', STATUSES).map(({ key, count }) => ({ status: key, count })),
      byPriority: tally('priority', PRIORITIES).map(({ key, count }) => ({
        priority: key,
        count,
      })),
      byCategory: named(tally('categoryId'), names.category),
      byCompany: named(tally('companyId'), names.company, (c) => ({ code: c?.code ?? null })),
      byLocation: named(tally('locationId'), names.location),
      sla: { firstResponse: states('firstResponse'), resolution: states('resolution') },
      averages: {
        firstResponseMinutes: average(minutes('firstResponseMinutes')),
        resolveMinutes: average(minutes('resolveMinutes')),
      },
      satisfaction: await satisfaction(scopes, range),
    };
  }

  /** GET /api/helpdesk/reports/export.csv: one row per ticket. */
  async function exportCsv(req, query) {
    const { range, rows } = await facts(req, query);
    const names = await namesFor(rows);
    const when = (date) => (date ? formatCairo(date) : '');
    const name = (map, id) => map.get(id)?.nameEn ?? '';
    const person = (id) => names.person.get(id)?.displayNameEn ?? '';
    const header = [
      'Number',
      'Raised (Cairo)',
      'Company',
      'Category',
      'Location',
      'Priority',
      'Status',
      'Source',
      'Assignee',
      'First response (Cairo)',
      'Resolved (Cairo)',
      'Closed (Cairo)',
      'Closed how',
      'Rating (1-5)',
      'First response SLA',
      'Resolution SLA',
      'First response (business minutes)',
      'Resolution (business minutes)',
    ];
    const body = rows.map(({ ticket: t, ...r }) => [
      t.number,
      when(t.createdAt),
      names.company.get(t.companyId)?.code ?? '',
      name(names.category, t.categoryId),
      name(names.location, t.locationId),
      t.priority,
      t.status,
      t.source,
      person(t.assigneeId),
      when(t.firstRespondedAt),
      when(t.resolvedAt),
      when(t.closedAt),
      t.closeMode ?? '',
      t.rating ?? '',
      r.firstResponse,
      r.resolution,
      r.firstResponseMinutes ?? '',
      r.resolveMinutes ?? '',
    ]);
    return {
      fileName: `helpdesk-report-${range.from}-to-${range.to}.csv`,
      csv: toCsv([header, ...body]),
    };
  }

  return { report, exportCsv };
}
