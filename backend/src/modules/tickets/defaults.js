/**
 * defaults.js — the IT helpdesk's reference data, created when missing and
 * never changed: the IT team, its working hours, SLA targets, categories and
 * canned replies, the group's ticket locations and the public holidays. No
 * people and no tickets.
 *
 * Used by `npm run db:live:setup` and by creating a company in the portal, so a
 * database with no support team (the live one) gets one and a new company is
 * served at once. Safe to run any number of times: it reads, adds what is
 * absent, and leaves an administrator's edits alone.
 *
 * The data is the team's and the group's, not a company's (D99, D141): the IT
 * team has `servesAllCompanies`, so every active company, GEN, HLD, MSR and any
 * added later, is served by the same rows. Only a team an administrator
 * narrowed to chosen companies (`servesAllCompanies` false) gets a
 * SupportTeamCompany row for each active company that lacks one.
 */

import { HOLIDAYS, SUPPORT_TEAMS, TICKET_LOCATIONS } from '../../../prisma/seed-data.js';
import { writeAudit } from '../../lib/audit.js';

/** The live database's team: seed-data.js's IT team under its production names. */
export const LIVE_TEAM = { nameEn: 'IT Helpdesk', nameAr: 'الدعم الفني' };

const EMPTY = Object.freeze({
  team: 0,
  calendar: 0,
  sla: 0,
  categories: 0,
  cannedReplies: 0,
  locations: 0,
  holidays: 0,
  companies: 0,
});

/**
 * @param {import('@prisma/client').PrismaClient} db  a client or a transaction
 * @param {object} [options]
 * @param {object | null} [options.req]  the signed-in admin, for the audit row
 * @returns {Promise<{ teamId: string, created: Record<string, number> }>} what was added
 */
export async function ensureHelpdeskDefaults(db, { req = null } = {}) {
  const { calendar, sla, categories, cannedReplies, code, servesAllCompanies } =
    SUPPORT_TEAMS[0];
  const team = { code, servesAllCompanies };
  const created = { ...EMPTY };

  let row = await db.supportTeam.findFirst({ where: { code: team.code } });
  if (!row) {
    row = await db.supportTeam.create({ data: { ...team, ...LIVE_TEAM } });
    created.team = 1;
  }
  const teamId = row.id;

  if (!(await db.businessCalendar.findFirst({ where: { teamId } }))) {
    await db.businessCalendar.create({ data: { teamId, ...calendar } });
    created.calendar = 1;
  }

  const policies = new Set(
    (await db.slaPolicy.findMany({ where: { teamId } })).map((p) => p.priority)
  );
  for (const policy of sla.filter((p) => !policies.has(p.priority))) {
    await db.slaPolicy.create({ data: { teamId, ...policy } });
    created.sla += 1;
  }

  const haveCategories = new Set(
    (await db.ticketCategory.findMany({ where: { teamId } })).map((c) => c.nameEn)
  );
  for (const [sortOrder, category] of categories.entries()) {
    if (haveCategories.has(category.nameEn)) continue;
    await db.ticketCategory.create({ data: { teamId, sortOrder, ...category } });
    created.categories += 1;
  }

  const haveReplies = new Set(
    (await db.cannedReply.findMany({ where: { teamId } })).map((r) => r.titleEn)
  );
  for (const [sortOrder, reply] of cannedReplies.entries()) {
    if (haveReplies.has(reply.titleEn)) continue;
    await db.cannedReply.create({ data: { teamId, sortOrder, ...reply } });
    created.cannedReplies += 1;
  }

  const haveLocations = new Set((await db.ticketLocation.findMany({})).map((l) => l.nameEn));
  for (const [sortOrder, location] of TICKET_LOCATIONS.entries()) {
    if (haveLocations.has(location.nameEn)) continue;
    await db.ticketLocation.create({ data: { sortOrder, ...location } });
    created.locations += 1;
  }

  const haveDates = new Set((await db.holiday.findMany({})).map((h) => h.date));
  for (const holiday of HOLIDAYS.filter((h) => !haveDates.has(h.date))) {
    await db.holiday.create({ data: holiday });
    created.holidays += 1;
  }

  if (!row.servesAllCompanies) {
    const served = new Set(
      (await db.supportTeamCompany.findMany({ where: { teamId } })).map((c) => c.companyId)
    );
    for (const company of await db.company.findMany({ where: { isActive: true } })) {
      if (served.has(company.id)) continue;
      await db.supportTeamCompany.create({ data: { teamId, companyId: company.id } });
      created.companies += 1;
    }
  }

  if (Object.values(created).some(Boolean)) {
    await writeAudit(
      req,
      'helpdesk.defaults.create',
      'SupportTeam',
      null,
      { code: team.code, created },
      {
        tx: db,
        companyId: null,
        entityId: teamId,
      }
    );
  }
  return { teamId, created };
}
