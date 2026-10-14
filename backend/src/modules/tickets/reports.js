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
 *               still waiting on the requester)
 *
 * The CSV is one row per ticket with the same facts, for a spreadsheet.
 */

import { toCsv } from '../admin/csv.js';
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

const average = (list) =>
  list.length ? Math.round(list.reduce((sum, n) => sum + n, 0) / list.length) : null;

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
  async function facts(req, query) {
    const scopes = await tickets.staffScopes(req);
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
      rows.push({
        ticket: t,
        firstResponse: targetState(t.firstRespondedAt, t.firstResponseDueAt, at),
        resolution: targetState(t.resolvedAt, t.resolveDueAt, at),
        firstResponseMinutes: t.firstRespondedAt
          ? schedule.between(t.createdAt, t.firstRespondedAt)
          : null,
        resolveMinutes: t.resolvedAt
          ? Math.max(0, schedule.between(t.createdAt, t.resolvedAt) - (t.slaPausedMinutes ?? 0))
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

  /** GET /api/helpdesk/reports */
  async function report(req, query) {
    const { range, rows } = await facts(req, query);
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
