/**
 * admin-service.js — the helpdesk's configuration: teams and their members,
 * categories, locations, SLA targets, working hours, public holidays and
 * canned replies.
 *
 * IT settings are the IT Leads' (D135): a team's Lead manages that team's
 * name, served companies, categories, canned replies, SLA targets and
 * working hours, and any Lead manages the shared locations and holidays.
 * Who is on the team is the HoldingAdmin's alone (`listMembership`,
 * `setMember`, `removeMember`), and a team always keeps at least one active
 * Lead. Nobody else reaches any of it, administrators included. Every write
 * is one transaction with its AuditLog row (CLAUDE.md rule 7); the rows are
 * holding-wide (companyId NULL), since the helpdesk belongs to no one company.
 *
 * A change to targets, hours or holidays applies to a ticket the next time
 * its status or priority changes; tickets already resolved keep the dates
 * they were judged by.
 *
 * Errors a screen can act on: name_taken, date_taken, unknown_company,
 * unknown_user, unknown_team, last_lead.
 */

import { writeAudit } from '../../lib/audit.js';
import { isHoldingAdmin, requireUser } from '../../lib/scope.js';
import { DEFAULT_CALENDAR, weekdays } from '../../lib/sla.js';
import { HttpError } from '../../middleware/errors.js';
import { DEFAULT_SLA, PRIORITIES } from './rules.js';

const notFound = () => new HttpError(404, 'not_found');
const forbidden = () => new HttpError(403, 'forbidden');
const taken = (code, message) => new HttpError(409, code, message);

const person = (p) =>
  p
    ? {
        id: p.id,
        displayNameEn: p.displayNameEn,
        displayNameAr: p.displayNameAr,
        email: p.email,
        isActive: p.isActive,
      }
    : null;

const calendarView = (row) => ({
  timeZone: row.timeZone,
  workingDays: weekdays(row.workingDays),
  startMin: row.startMin,
  endMin: row.endMin,
});

const policyView = (row) => ({
  priority: row.priority,
  firstResponseMinutes: row.firstResponseMinutes,
  resolveMinutes: row.resolveMinutes,
});

/** @param {{ store: object }} deps  see store-prisma.js */
export function createHelpdeskAdminService({ store }) {
  /* ------------------------------------------------------------ permission */

  /** Team membership is the HoldingAdmin's. */
  function assertHolding(req) {
    requireUser(req);
    if (!isHoldingAdmin(req)) throw forbidden();
  }

  /** Locations and holidays are shared by every team: any Lead. */
  async function assertAnyLead(req) {
    await ledTeamIds(req);
  }

  /** The active teams the caller leads; 403 when they lead none. */
  async function ledTeamIds(req) {
    const user = requireUser(req);
    const leading = await store.find('member', { userId: user.id, role: 'Lead' });
    if (leading.length === 0) throw forbidden();
    const teams = await store.find('team', {
      id: leading.map((m) => m.teamId),
      isActive: true,
    });
    if (teams.length === 0) throw forbidden();
    return teams.map((t) => t.id);
  }

  /** 404 when the team is not one the caller leads: its existence is not theirs to learn. */
  async function assertLeads(req, teamId) {
    const ids = await ledTeamIds(req);
    if (!ids.includes(teamId)) throw notFound();
  }

  async function teamOr404(id) {
    const team = await store.get('team', id);
    if (!team) throw notFound();
    return team;
  }

  /** One audited write: `fn` returns the rows before and after. */
  function audited(req, action, entity, fn) {
    return store.transaction(async (tx) => {
      const { before = null, after = null, entityId } = await fn(tx);
      await writeAudit(req, action, entity, before, after, { tx, companyId: null, entityId });
      return after;
    });
  }

  /* ------------------------------------------------------------------ teams */

  async function teamViews(teams) {
    const ids = teams.map((t) => t.id);
    if (ids.length === 0) return [];
    const [companies, members, calendars, policies] = await Promise.all([
      store.find('teamCompany', { teamId: ids }),
      store.find('member', { teamId: ids }),
      store.find('calendar', { teamId: ids }),
      store.find('sla', { teamId: ids }),
    ]);
    const people = new Map(
      (await store.getUsers([...new Set(members.map((m) => m.userId))])).map((p) => [p.id, p])
    );
    return teams.map((team) => ({
      id: team.id,
      code: team.code,
      nameEn: team.nameEn,
      nameAr: team.nameAr,
      servesAllCompanies: team.servesAllCompanies,
      companyIds: companies.filter((c) => c.teamId === team.id).map((c) => c.companyId),
      isActive: team.isActive,
      members: members
        .filter((m) => m.teamId === team.id)
        .map((m) => ({ ...person(people.get(m.userId)), role: m.role }))
        .sort((a, b) => (a.displayNameEn ?? '').localeCompare(b.displayNameEn ?? '')),
      calendar: calendarView(calendars.find((c) => c.teamId === team.id) ?? DEFAULT_CALENDAR),
      sla: PRIORITIES.map((priority) =>
        policyView(
          policies.find((p) => p.teamId === team.id && p.priority === priority) ?? {
            priority,
            ...DEFAULT_SLA[priority],
          }
        )
      ),
      updatedAt: team.updatedAt,
    }));
  }

  /** The teams the caller leads, with their settings. */
  async function listTeams(req) {
    const ids = await ledTeamIds(req);
    const teams = await store.find('team', { id: ids }, { orderBy: [{ nameEn: 'asc' }] });
    return { items: await teamViews(teams) };
  }

  const membershipView = (view) => ({
    id: view.id,
    code: view.code,
    nameEn: view.nameEn,
    nameAr: view.nameAr,
    isActive: view.isActive,
    members: view.members,
  });

  /**
   * For the HoldingAdmin: every active team with its members, and nothing
   * else (no settings, no tickets).
   */
  async function listMembership(req) {
    assertHolding(req);
    const teams = await store.find(
      'team',
      { isActive: true },
      { orderBy: [{ nameEn: 'asc' }] }
    );
    return { items: (await teamViews(teams)).map(membershipView) };
  }

  async function membershipOf(teamId) {
    return membershipView(await teamView(teamId));
  }

  async function teamView(id) {
    const [view] = await teamViews([await teamOr404(id)]);
    return view;
  }

  const teamSnapshot = (team, companyIds) => ({
    id: team.id,
    code: team.code,
    nameEn: team.nameEn,
    nameAr: team.nameAr,
    servesAllCompanies: team.servesAllCompanies,
    companyIds,
    isActive: team.isActive,
  });

  async function knownCompanyIds(ids) {
    if (ids.length === 0) return ids;
    const known = new Set((await store.listCompanies()).map((c) => c.id));
    if (ids.some((id) => !known.has(id))) {
      throw new HttpError(400, 'unknown_company', 'One of those companies does not exist.');
    }
    return ids;
  }

  /** A Lead renames their team or changes the companies it serves. */
  async function updateTeam(req, id, body) {
    await assertLeads(req, id);
    const team = await teamOr404(id);
    const { companyIds: wanted, ...patch } = body;
    const current = (await store.find('teamCompany', { teamId: id })).map((c) => c.companyId);
    const all = patch.servesAllCompanies ?? team.servesAllCompanies;
    const companyIds = all ? [] : await knownCompanyIds(wanted ?? current);

    await audited(req, 'helpdesk.team.update', 'SupportTeam', async (tx) => {
      const after = Object.keys(patch).length ? await tx.update('team', id, patch) : team;
      if (companyIds.join() !== current.join()) {
        await tx.remove('teamCompany', { teamId: id });
        for (const companyId of companyIds)
          await tx.insert('teamCompany', { teamId: id, companyId });
      }
      return { before: teamSnapshot(team, current), after: teamSnapshot(after, companyIds) };
    });
    return teamView(id);
  }

  /* ---------------------------------------------------------------- members */

  const memberSnapshot = (m) => ({
    id: m.id,
    teamId: m.teamId,
    userId: m.userId,
    role: m.role,
  });

  /**
   * 409 `last_lead` when taking `userId` off the Leads would leave the team
   * with no active Lead to assign tickets and keep its settings.
   */
  async function assertKeepsLead(teamId, userId) {
    const others = (await store.find('member', { teamId, role: 'Lead' })).filter(
      (m) => m.userId !== userId
    );
    const people = others.length ? await store.getUsers(others.map((m) => m.userId)) : [];
    if (!people.some((p) => p.isActive)) {
      throw new HttpError(409, 'last_lead', 'The team needs at least one active lead.');
    }
  }

  /**
   * Adds someone to a team, or changes their role on it. From their next
   * request they work in the Helpdesk and no longer in the portal (D135).
   */
  async function setMember(req, teamId, userId, { role }) {
    assertHolding(req);
    await teamOr404(teamId);
    const [user] = await store.getUsers([userId]);
    if (!user?.isActive) {
      throw new HttpError(400, 'unknown_user', 'That person is not in the directory.');
    }
    const [existing] = await store.find('member', { teamId, userId });
    if (existing?.role === 'Lead' && role !== 'Lead') await assertKeepsLead(teamId, userId);
    if (existing?.role !== role) {
      await audited(
        req,
        existing ? 'helpdesk.member.update' : 'helpdesk.member.add',
        'SupportTeamMember',
        async (tx) => {
          const after = existing
            ? await tx.update('member', existing.id, { role })
            : await tx.insert('member', { teamId, userId, role });
          return {
            before: existing ? memberSnapshot(existing) : null,
            after: memberSnapshot(after),
          };
        }
      );
    }
    return membershipOf(teamId);
  }

  /**
   * Off the team: from their next request they are back in the portal. Their
   * tickets stay assigned until a Lead moves them.
   */
  async function removeMember(req, teamId, userId) {
    assertHolding(req);
    await teamOr404(teamId);
    const [existing] = await store.find('member', { teamId, userId });
    if (!existing) throw notFound();
    if (existing.role === 'Lead') await assertKeepsLead(teamId, userId);
    await audited(req, 'helpdesk.member.remove', 'SupportTeamMember', async (tx) => {
      await tx.remove('member', { id: existing.id });
      return { before: memberSnapshot(existing), entityId: existing.id };
    });
    return membershipOf(teamId);
  }

  /* ------------------------------------------------- targets and the calendar */

  async function setSla(req, teamId, { policies }) {
    await assertLeads(req, teamId);
    await teamOr404(teamId);
    const current = await store.find('sla', { teamId });
    const asMap = (rows) =>
      Object.fromEntries(
        rows.map((r) => [
          r.priority,
          { firstResponseMinutes: r.firstResponseMinutes, resolveMinutes: r.resolveMinutes },
        ])
      );
    await audited(req, 'helpdesk.sla.update', 'SlaPolicy', async (tx) => {
      for (const { priority, ...targets } of policies) {
        const row = current.find((r) => r.priority === priority);
        if (row) await tx.update('sla', row.id, targets);
        else await tx.insert('sla', { teamId, priority, ...targets });
      }
      return {
        before: { teamId, ...asMap(current) },
        after: { teamId, ...asMap(policies) },
        entityId: teamId,
      };
    });
    return teamView(teamId);
  }

  async function setCalendar(req, teamId, body) {
    await assertLeads(req, teamId);
    await teamOr404(teamId);
    const [current] = await store.find('calendar', { teamId });
    const data = { ...body, workingDays: body.workingDays.join(',') };
    await audited(req, 'helpdesk.calendar.update', 'BusinessCalendar', async (tx) => {
      if (current) await tx.update('calendar', current.id, data);
      else await tx.insert('calendar', { teamId, ...data });
      return {
        before: current ? { teamId, ...calendarView(current) } : null,
        after: { teamId, ...body },
        entityId: teamId,
      };
    });
    return teamView(teamId);
  }

  /* ------------------------------------------- categories and canned replies */

  /** List, create and update for a table whose rows belong to a team. */
  function teamOwned({ table, entity, action, view, unique }) {
    return {
      async list(req, { teamId } = {}) {
        const ids = await ledTeamIds(req);
        if (teamId && !ids.includes(teamId)) throw notFound();
        const where = teamId ? { teamId } : { teamId: ids };
        const rows = await store.find(table, where, {
          orderBy: [{ teamId: 'asc' }, { sortOrder: 'asc' }],
        });
        return { items: rows.map(view) };
      },

      async create(req, body) {
        await assertLeads(req, body.teamId);
        if (!(await store.get('team', body.teamId))) {
          throw new HttpError(400, 'unknown_team', 'Choose a team.');
        }
        if (unique) await unique(body.teamId, body, null);
        const row = await audited(req, `${action}.create`, entity, async (tx) => ({
          after: await tx.insert(table, { ...body, isActive: true }),
        }));
        return view(row);
      },

      async update(req, id, patch) {
        const before = await store.get(table, id);
        // Checked before saying whether the row exists.
        await ledTeamIds(req);
        if (!before) throw notFound();
        await assertLeads(req, before.teamId);
        if (unique) await unique(before.teamId, patch, id);
        const row = await audited(req, `${action}.update`, entity, async (tx) => ({
          before,
          after: await tx.update(table, id, patch),
        }));
        return view(row);
      },
    };
  }

  const categories = teamOwned({
    table: 'category',
    entity: 'TicketCategory',
    action: 'helpdesk.category',
    view: (c) => ({
      id: c.id,
      teamId: c.teamId,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      defaultPriority: c.defaultPriority,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
    }),
    async unique(teamId, { nameEn }, exceptId) {
      if (nameEn === undefined) return;
      const same = await store.find('category', { teamId, nameEn });
      if (same.some((c) => c.id !== exceptId)) {
        throw taken('name_taken', 'This team already has a category with that name.');
      }
    },
  });

  const canned = teamOwned({
    table: 'canned',
    entity: 'CannedReply',
    action: 'helpdesk.canned',
    view: (r) => ({
      id: r.id,
      teamId: r.teamId,
      titleEn: r.titleEn,
      titleAr: r.titleAr,
      bodyEn: r.bodyEn,
      bodyAr: r.bodyAr,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
    }),
  });

  /* -------------------------------------------------- locations and holidays */

  const locationView = (l) => ({
    id: l.id,
    nameEn: l.nameEn,
    nameAr: l.nameAr,
    sortOrder: l.sortOrder,
    isActive: l.isActive,
  });

  async function assertLocationName(nameEn, exceptId) {
    if (nameEn === undefined) return;
    const same = await store.find('location', { nameEn });
    if (same.some((l) => l.id !== exceptId)) {
      throw taken('name_taken', 'There is already a location with that name.');
    }
  }

  async function listLocations(req) {
    await assertAnyLead(req);
    const rows = await store.find('location', {}, { orderBy: [{ sortOrder: 'asc' }] });
    return { items: rows.map(locationView) };
  }

  async function createLocation(req, body) {
    await assertAnyLead(req);
    await assertLocationName(body.nameEn, null);
    const row = await audited(
      req,
      'helpdesk.location.create',
      'TicketLocation',
      async (tx) => ({
        after: await tx.insert('location', { ...body, isActive: true }),
      })
    );
    return locationView(row);
  }

  async function updateLocation(req, id, patch) {
    await assertAnyLead(req);
    const before = await store.get('location', id);
    if (!before) throw notFound();
    await assertLocationName(patch.nameEn, id);
    const row = await audited(
      req,
      'helpdesk.location.update',
      'TicketLocation',
      async (tx) => ({
        before,
        after: await tx.update('location', id, patch),
      })
    );
    return locationView(row);
  }

  const holidayView = (h) => ({ id: h.id, date: h.date, nameEn: h.nameEn, nameAr: h.nameAr });

  async function assertHolidayDate(date, exceptId) {
    if (date === undefined) return;
    const same = await store.find('holiday', { date });
    if (same.some((h) => h.id !== exceptId)) {
      throw taken('date_taken', 'That day is already a holiday.');
    }
  }

  async function listHolidays(req, { year } = {}) {
    await assertAnyLead(req);
    const rows = await store.find('holiday', {}, { orderBy: [{ date: 'asc' }] });
    return {
      items: rows.filter((h) => !year || h.date.startsWith(`${year}-`)).map(holidayView),
    };
  }

  async function createHoliday(req, body) {
    await assertAnyLead(req);
    await assertHolidayDate(body.date, null);
    const row = await audited(req, 'helpdesk.holiday.create', 'Holiday', async (tx) => ({
      after: await tx.insert('holiday', body),
    }));
    return holidayView(row);
  }

  async function updateHoliday(req, id, patch) {
    await assertAnyLead(req);
    const before = await store.get('holiday', id);
    if (!before) throw notFound();
    await assertHolidayDate(patch.date, id);
    const row = await audited(req, 'helpdesk.holiday.update', 'Holiday', async (tx) => ({
      before,
      after: await tx.update('holiday', id, patch),
    }));
    return holidayView(row);
  }

  async function removeHoliday(req, id) {
    await assertAnyLead(req);
    const before = await store.get('holiday', id);
    if (!before) throw notFound();
    await audited(req, 'helpdesk.holiday.remove', 'Holiday', async (tx) => {
      await tx.remove('holiday', { id });
      return { before, entityId: id };
    });
  }

  return {
    listTeams,
    listMembership,
    updateTeam,
    setMember,
    removeMember,
    setSla,
    setCalendar,
    listCategories: categories.list,
    createCategory: categories.create,
    updateCategory: categories.update,
    listCannedReplies: canned.list,
    createCannedReply: canned.create,
    updateCannedReply: canned.update,
    listLocations,
    createLocation,
    updateLocation,
    listHolidays,
    createHoliday,
    updateHoliday,
    removeHoliday,
  };
}
