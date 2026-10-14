/**
 * store-prisma.js — the helpdesk's reads and writes over Prisma.
 *
 * The service holds the rules; the store holds the queries, so the same rules
 * run over this and over store-memory.js. Rows go in and come out exactly as
 * the tables hold them (no joins: the service looks up the people and names
 * it needs by id).
 *
 * The small tables share four methods, addressed by a short table name:
 *
 *   find(table, where, { orderBy })   where: field → value, or an array for "in"
 *   get(table, id)
 *   insert(table, data)
 *   update(table, id, patch)
 *   remove(table, where)
 *
 * Tickets have their own list and count, driven by one filter object that
 * both stores understand (see `ticketWhere`).
 *
 * `transaction(fn)` hands fn a store bound to one Prisma transaction, which
 * also carries `auditLog` for lib/audit.js.
 */

import { getPrisma } from '../../lib/prisma.js';

/** Short name → Prisma delegate. Nothing outside this list can be addressed. */
export const TABLES = {
  team: 'supportTeam',
  teamCompany: 'supportTeamCompany',
  member: 'supportTeamMember',
  category: 'ticketCategory',
  location: 'ticketLocation',
  sla: 'slaPolicy',
  calendar: 'businessCalendar',
  holiday: 'holiday',
  canned: 'cannedReply',
  ticket: 'ticket',
  comment: 'ticketComment',
  attachment: 'ticketAttachment',
  event: 'ticketEvent',
};

function delegate(db, table) {
  const name = TABLES[table];
  if (!name) throw new Error(`Unknown helpdesk table: ${table}`);
  return db[name];
}

const whereOf = (where = {}) =>
  Object.fromEntries(
    Object.entries(where).map(([key, value]) => [
      key,
      Array.isArray(value) ? { in: value } : value,
    ])
  );

const PERSON = {
  id: true,
  email: true,
  displayNameEn: true,
  displayNameAr: true,
  companyId: true,
  officeLocation: true,
  language: true,
  isActive: true,
};

/**
 * The ticket filter as a Prisma `where`.
 *
 *   requesterId   tickets raised for this person
 *   scopes        [{ teamId, companyIds | null }]: any of these; [] is nothing
 *   statuses, priority, teamId, companyId, locationId, categoryId
 *   assigneeId    an id, or null for unassigned
 *   sla           on_track | at_risk | breached, judged at `now`
 *   riskBy        the clock is running and 75% is used by this instant
 *   autoCloseBy   due to close itself by this instant
 *   createdFrom, createdBefore   raised in [from, before)
 *   q             in the number or the subject
 */
export function ticketWhere(f = {}) {
  const AND = [];
  if (f.scopes) {
    AND.push({
      OR: f.scopes.map((s) => ({
        teamId: s.teamId,
        ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}),
      })),
    });
  }
  if (f.q) AND.push({ OR: [{ number: { contains: f.q } }, { subject: { contains: f.q } }] });
  if (f.sla === 'on_track') AND.push({ slaActive: true, nextRiskAt: { gt: f.now } });
  if (f.sla === 'at_risk') {
    AND.push({ slaActive: true, nextRiskAt: { lte: f.now }, nextDueAt: { gt: f.now } });
  }
  if (f.sla === 'breached') AND.push({ slaActive: true, nextDueAt: { lte: f.now } });
  if (f.riskBy) AND.push({ slaActive: true, nextRiskAt: { lte: f.riskBy } });
  if (f.autoCloseBy) AND.push({ autoCloseAt: { lte: f.autoCloseBy } });
  if (f.createdFrom) AND.push({ createdAt: { gte: f.createdFrom } });
  if (f.createdBefore) AND.push({ createdAt: { lt: f.createdBefore } });

  return {
    ...(f.requesterId ? { requesterId: f.requesterId } : {}),
    ...(f.statuses ? { status: { in: f.statuses } } : {}),
    ...(f.priority ? { priority: f.priority } : {}),
    ...(f.teamId ? { teamId: f.teamId } : {}),
    ...(f.companyId ? { companyId: f.companyId } : {}),
    ...(f.locationId ? { locationId: f.locationId } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.assigneeId !== undefined ? { assigneeId: f.assigneeId } : {}),
    ...(AND.length ? { AND } : {}),
  };
}

/** `due`: the running clocks first, nearest due date first. `recent`: newest first. */
const ORDER = {
  due: [{ slaActive: 'desc' }, { nextDueAt: 'asc' }, { number: 'asc' }],
  recent: [{ createdAt: 'desc' }, { number: 'desc' }],
};

/** @param {import('@prisma/client').PrismaClient} db */
function operations(db) {
  return {
    /** What lib/audit.js writes to. */
    auditLog: db.auditLog,

    /* ---- the small tables */
    async find(table, where = {}, { orderBy } = {}) {
      return delegate(db, table).findMany({
        where: whereOf(where),
        ...(orderBy ? { orderBy } : {}),
      });
    },

    async get(table, id) {
      return delegate(db, table).findUnique({ where: { id } });
    },

    async insert(table, data) {
      return delegate(db, table).create({ data });
    },

    async update(table, id, patch) {
      return delegate(db, table).update({ where: { id }, data: patch });
    },

    async remove(table, where) {
      const { count } = await delegate(db, table).deleteMany({ where: whereOf(where) });
      return count;
    },

    /* ---- people and companies */
    async getUsers(ids) {
      if (ids.length === 0) return [];
      return db.userProfile.findMany({ where: { id: { in: ids } }, select: PERSON });
    },

    async listCompanies() {
      return db.company.findMany({
        select: { id: true, code: true, nameEn: true, nameAr: true, isActive: true },
        orderBy: { nameEn: 'asc' },
      });
    },

    /* ---- tickets */

    /** Makes the counter row for a prefix and year, once. Not in a transaction. */
    async ensureSequence(prefix, year) {
      const where = { prefix_year: { prefix, year } };
      if (await db.ticketSequence.findUnique({ where })) return;
      try {
        await db.ticketSequence.create({ data: { prefix, year, last: 0 } });
      } catch (err) {
        // Someone else made it in the same instant: that is the row we wanted.
        if (err?.code !== 'P2002') throw err;
      }
    },

    /**
     * The next number for a prefix and year. Call it inside the transaction
     * that creates the ticket: the update locks the counter row until that
     * transaction ends, so concurrent creates queue here and each reads its
     * own number. A rolled-back create gives its number back.
     */
    async nextTicketNumber(prefix, year) {
      const { count } = await db.ticketSequence.updateMany({
        where: { prefix, year },
        data: { last: { increment: 1 } },
      });
      if (count !== 1) throw new Error('Ticket sequence row is missing.');
      const row = await db.ticketSequence.findUnique({
        where: { prefix_year: { prefix, year } },
      });
      return row.last;
    },

    async listTickets(filter = {}) {
      const where = ticketWhere(filter);
      const [total, items] = await Promise.all([
        db.ticket.count({ where }),
        db.ticket.findMany({
          where,
          orderBy: ORDER[filter.order ?? 'recent'],
          skip: filter.skip ?? 0,
          ...(filter.take ? { take: filter.take } : {}),
        }),
      ]);
      return { total, items };
    },

    async countTickets(filter = {}) {
      return db.ticket.count({ where: ticketWhere(filter) });
    },
  };
}

/** Prisma's code for a transaction that lost a deadlock or a write conflict. */
const WRITE_CONFLICT = 'P2034';
const ATTEMPTS = 4;

/** A deadlock's loser was rolled back whole; running it again is safe. */
async function withRetry(run) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      if (err?.code !== WRITE_CONFLICT || attempt >= ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

export function createPrismaTicketStore() {
  const names = Object.keys(operations(/** @type {any} */ ({}))).filter(
    (name) => name !== 'auditLog'
  );

  const methods = Object.fromEntries(
    names.map((name) => [name, async (...args) => operations(await getPrisma())[name](...args)])
  );

  return {
    ...methods,
    transaction: (fn) =>
      withRetry(async () => {
        const db = await getPrisma();
        return db.$transaction((tx) => fn(operations(tx)), { timeout: 30_000 });
      }),
  };
}
