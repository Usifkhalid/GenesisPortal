/**
 * service.js — helpdesk tickets: the rules, apart from HTTP and from storage.
 *
 * Who reads a ticket (rules.js, docs/DECISIONS.md D99): its requester, the
 * members of its support team for the companies that team serves, and a
 * HoldingAdmin. Not the requester's colleagues and not their CompanyAdmin.
 * Every route here starts from `loadTicket` or from a filter that carries the
 * viewer's own id or team scopes, and anything out of reach answers 404, so a
 * ticket's existence is never disclosed: not by id, list, search, count,
 * attachment address or number.
 *
 * The life of a ticket:
 *   New → Open              an agent takes it, is assigned it, or answers
 *   Open ⇄ WaitingOnRequester   the clock stops while the requester is asked
 *                           something; their reply sets it running again
 *   → Resolved              closes itself three working days later unless the
 *                           requester replies (which reopens it)
 *   → Closed                the requester may still reopen for seven days
 *                           after it was resolved
 *
 * The SLA clock (lib/sla.js) counts the team's business minutes. Both due
 * dates are "target plus paused minutes, from creation", worked out again
 * from the team's current targets whenever the status or the priority
 * changes. Three derived columns (nextDueAt, nextRiskAt, slaActive) let the
 * queue filter and sort in the database.
 *
 * Everything that happens to a ticket is a TicketEvent row; configuration
 * changes are AuditLog rows (admin-service.js).
 *
 * Errors a screen can act on carry a stable code (docs/API.md):
 *   unknown_category, unknown_location, unknown_requester, unknown_assignee,
 *   ticket_closed, not_resolved, reopen_window_closed, lead_only,
 *   unsupported_file, empty_upload, file_too_large, too_many_attachments.
 */

import { randomUUID } from 'node:crypto';

import { ATTACHMENT_EXTENSIONS, detectAttachment } from '../../lib/file-type.js';
import { logger } from '../../lib/logger.js';
import { isHoldingAdmin, requireUser } from '../../lib/scope.js';
import {
  DEFAULT_CALENDAR,
  createSchedule,
  slaDates,
  slaState,
  zoneDay,
} from '../../lib/sla.js';
import { HttpError } from '../../middleware/errors.js';
import {
  ACTIVE_STATUSES,
  AUTO_CLOSE_WORKING_DAYS,
  DEFAULT_SLA,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  PRIORITIES,
  REOPEN_DAYS,
  RUNNING_STATUSES,
  SOURCES,
  STATUSES,
  cleanFileName,
  isLead,
  matchLocation,
  serves,
  staffRoleOn,
  ticketNumber,
} from './rules.js';

const notFound = () => new HttpError(404, 'not_found');
const forbidden = () => new HttpError(403, 'forbidden');
const refuse = (status, code, message, details) =>
  new HttpError(status, code, message, details);

const DAY_MS = 24 * 60 * 60 * 1000;
const unique = (list) => [...new Set(list.filter(Boolean))];

const person = (p) =>
  p ? { id: p.id, displayNameEn: p.displayNameEn, displayNameAr: p.displayNameAr } : null;
const named = (row) => (row ? { id: row.id, nameEn: row.nameEn, nameAr: row.nameAr } : null);

const statusesOf = (filter) =>
  filter === 'all' ? undefined : filter === 'active' ? ACTIVE_STATUSES : [filter];

/**
 * @param {object} deps
 * @param {object} deps.store  see store-prisma.js
 * @param {object} deps.storage  see lib/storage.js
 * @param {() => Date} [deps.now]
 * @param {{ warn: Function }} [deps.log]
 */
export function createTicketService({ store, storage, now = () => new Date(), log = logger }) {
  /* ------------------------------------------------------------ the viewer */

  /**
   * Who is asking, in helpdesk terms: the teams they are on (active ones),
   * the companies each of those serves, and whether they are a HoldingAdmin.
   * Read on every request, so someone taken off a team loses the queue at once.
   */
  async function viewerOf(req) {
    const user = requireUser(req);
    const holdingAdmin = isHoldingAdmin(req);
    const mine = await store.find('member', { userId: user.id });
    let memberships = [];
    if (mine.length > 0) {
      const teams = await store.find('team', {
        id: mine.map((m) => m.teamId),
        isActive: true,
      });
      const limited = teams.filter((t) => !t.servesAllCompanies).map((t) => t.id);
      const served = limited.length ? await store.find('teamCompany', { teamId: limited }) : [];
      memberships = teams.map((team) => ({
        teamId: team.id,
        role: mine.find((m) => m.teamId === team.id).role,
        companyIds: team.servesAllCompanies
          ? null
          : served.filter((s) => s.teamId === team.id).map((s) => s.companyId),
      }));
    }
    return { user, holdingAdmin, memberships, isStaff: holdingAdmin || memberships.length > 0 };
  }

  /** The filter part that keeps a staff list inside what the viewer serves. */
  const scopesOf = (viewer) =>
    viewer.holdingAdmin
      ? undefined
      : viewer.memberships.map(({ teamId, companyIds }) => ({ teamId, companyIds }));

  /** A ticket and the viewer's standing on it, or 404. */
  async function loadTicket(req, id) {
    const viewer = await viewerOf(req);
    const ticket = await store.get('ticket', id);
    if (!ticket) throw notFound();
    const staffRole = staffRoleOn(viewer, ticket);
    const isRequester = ticket.requesterId === viewer.user.id;
    if (!staffRole && !isRequester) throw notFound();
    return { viewer, ticket, staffRole, isRequester };
  }

  /* ---------------------------------------------------------------- the SLA */

  async function scheduleFor(teamId) {
    const [calendars, holidays] = await Promise.all([
      store.find('calendar', { teamId }),
      store.find('holiday'),
    ]);
    return createSchedule(
      calendars[0] ?? DEFAULT_CALENDAR,
      holidays.map((h) => h.date)
    );
  }

  async function policyFor(teamId, priority) {
    const [row] = await store.find('sla', { teamId, priority });
    return row ?? DEFAULT_SLA[priority];
  }

  /** The dates and flags that follow from a ticket's priority, pauses and status. */
  function slaFields(ticket, policy, schedule) {
    const dates = slaDates(
      { createdAt: ticket.createdAt, policy, pausedMinutes: ticket.slaPausedMinutes },
      schedule
    );
    const answered = Boolean(ticket.firstRespondedAt);
    return {
      firstResponseDueAt: dates.firstResponseDueAt,
      resolveDueAt: dates.resolveDueAt,
      nextDueAt: answered ? dates.resolveDueAt : dates.firstResponseDueAt,
      nextRiskAt: answered ? dates.resolveRiskAt : dates.firstResponseRiskAt,
      slaActive: RUNNING_STATUSES.includes(ticket.status),
    };
  }

  /**
   * What moving to another status does to the clock and the closing dates.
   * A pause runs from the moment the ticket stops being New or Open; its
   * business minutes are added when the ticket moves on. Closing an already
   * resolved ticket touches nothing: its result against the target is settled.
   */
  function transition(ticket, to, at, schedule) {
    const out = { status: to };
    if (!(ticket.status === 'Resolved' && to === 'Closed')) {
      const waited = ticket.slaPausedAt ? schedule.between(ticket.slaPausedAt, at) : 0;
      out.slaPausedMinutes = ticket.slaPausedMinutes + waited;
      out.slaPausedAt = to === 'Open' ? null : at;
    }
    if (to === 'Open' || to === 'WaitingOnRequester') {
      Object.assign(out, { resolvedAt: null, closedAt: null, autoCloseAt: null });
    } else if (to === 'Resolved') {
      Object.assign(out, {
        resolvedAt: at,
        closedAt: null,
        autoCloseAt: schedule.add(at, AUTO_CLOSE_WORKING_DAYS * schedule.dayMinutes),
      });
    } else if (to === 'Closed') {
      Object.assign(out, {
        resolvedAt: ticket.resolvedAt ?? at,
        closedAt: at,
        autoCloseAt: null,
      });
    }
    return out;
  }

  /**
   * The full patch for a change of status, priority or first response: the
   * change itself plus every date that follows from it.
   * @param {object} ticket
   * @param {{ status?: string, priority?: string, firstRespondedAt?: Date }} changes
   * @param {Date} at
   */
  async function recalculate(ticket, changes, at) {
    const schedule = await scheduleFor(ticket.teamId);
    const patch = { ...changes };
    if (changes.status && changes.status !== ticket.status) {
      Object.assign(patch, transition(ticket, changes.status, at, schedule));
    }
    const next = { ...ticket, ...patch };
    // A resolved ticket that only closes keeps the dates it was judged by.
    if (!(ticket.status === 'Resolved' && next.status === 'Closed')) {
      const policy = await policyFor(ticket.teamId, next.priority);
      Object.assign(patch, slaFields(next, policy, schedule));
    } else {
      patch.slaActive = false;
    }
    return patch;
  }

  /* --------------------------------------------------------------- reading */

  /** The people and names a set of tickets (and their history) refer to. */
  async function refsFor(tickets, { userIds = [] } = {}) {
    const teamIds = unique(tickets.map((t) => t.teamId));
    const [people, teams, categories, locations, companies] = await Promise.all([
      store.getUsers(
        unique([
          ...tickets.flatMap((t) => [t.requesterId, t.createdById, t.assigneeId]),
          ...userIds,
        ])
      ),
      teamIds.length ? store.find('team', { id: teamIds }) : [],
      teamIds.length ? store.find('category', { teamId: teamIds }) : [],
      store.find('location'),
      store.listCompanies(),
    ]);
    const byId = (rows) => new Map(rows.map((row) => [row.id, row]));
    return {
      people: byId(people),
      teams: byId(teams),
      categories: byId(categories),
      locations: byId(locations),
      companies: byId(companies),
    };
  }

  const withinReopenWindow = (ticket, at) =>
    Boolean(ticket.resolvedAt) &&
    at.getTime() - ticket.resolvedAt.getTime() <= REOPEN_DAYS * DAY_MS;

  /** A ticket as one row of a list. */
  function summaryView(viewer, t, refs, at) {
    const team = refs.teams.get(t.teamId);
    const company = refs.companies.get(t.companyId);
    return {
      id: t.id,
      number: t.number,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      source: t.source,
      team: team ? { ...named(team), code: team.code } : null,
      category: named(refs.categories.get(t.categoryId)),
      location: named(refs.locations.get(t.locationId)),
      company: company ? { ...named(company), code: company.code } : null,
      requester: person(refs.people.get(t.requesterId)),
      assignee: person(refs.people.get(t.assigneeId)),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      firstRespondedAt: t.firstRespondedAt,
      resolvedAt: t.resolvedAt,
      closedAt: t.closedAt,
      sla: {
        state: slaState(t, at),
        firstResponseDueAt: t.firstResponseDueAt,
        resolveDueAt: t.resolveDueAt,
        /** The date in force: first response until answered, then resolution. */
        dueAt: t.nextDueAt,
        pausedMinutes: t.slaPausedMinutes,
      },
      mine: t.requesterId === viewer.user.id,
    };
  }

  /** A ticket in full, with what this viewer may do to it. */
  function ticketView({ viewer, staffRole, isRequester }, t, refs, at) {
    const closed = t.status === 'Closed';
    const done = closed || t.status === 'Resolved';
    return {
      ...summaryView(viewer, t, refs, at),
      description: t.description,
      assetTag: t.assetTag,
      createdBy: person(refs.people.get(t.createdById)),
      /** For the team only: the language a canned reply is written in. */
      ...(staffRole
        ? { requesterLanguage: refs.people.get(t.requesterId)?.language === 'ar' ? 'ar' : 'en' }
        : {}),
      can: {
        comment: !closed,
        internalNote: Boolean(staffRole),
        attach: !closed,
        reopen: done && (Boolean(staffRole) || (isRequester && withinReopenWindow(t, at))),
        manage: Boolean(staffRole),
        reassign: isLead(staffRole),
      },
    };
  }

  const attachmentView = (a, refs) => ({
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    size: a.size,
    isInternal: a.isInternal,
    uploadedBy: person(refs.people.get(a.uploadedById)),
    createdAt: a.createdAt,
    url: `/api/tickets/${a.ticketId}/attachments/${a.id}`,
  });

  /** A ticket with its timeline, as the viewer may see it. */
  async function detail(ctx, ticket) {
    const staff = Boolean(ctx.staffRole);
    const where = { ticketId: ticket.id };
    const oldestFirst = { orderBy: [{ createdAt: 'asc' }] };
    const [events, comments, attachments] = await Promise.all([
      store.find('event', where, oldestFirst),
      store.find('comment', where, oldestFirst),
      store.find('attachment', where, oldestFirst),
    ]);
    // An internal note, its files and its trace do not exist for the requester.
    const seen = (rows) => rows.filter((row) => staff || !row.isInternal);
    const shownEvents = seen(events);
    const shownAttachments = seen(attachments);
    const commentById = new Map(seen(comments).map((c) => [c.id, c]));

    const refs = await refsFor([ticket], {
      userIds: [
        ...shownEvents.map((e) => e.actorId),
        ...shownEvents
          .filter((e) => e.type === 'assigned')
          .flatMap((e) => [e.fromValue, e.toValue]),
        ...shownAttachments.map((a) => a.uploadedById),
      ],
    });
    const valueOf = (type, value) => {
      if (value == null) return null;
      if (type === 'assigned') return person(refs.people.get(value));
      if (type === 'category') return named(refs.categories.get(value));
      return value;
    };
    const filesOf = (commentId) =>
      shownAttachments
        .filter((a) => (a.commentId ?? null) === commentId)
        .map((a) => attachmentView(a, refs));

    return {
      ticket: ticketView(ctx, ticket, refs, now()),
      /** The files sent with the description. */
      attachments: filesOf(null),
      timeline: shownEvents.map((e) => {
        const comment = e.commentId ? commentById.get(e.commentId) : null;
        return {
          id: e.id,
          type: e.type,
          at: e.createdAt,
          /** null: the system (a ticket that closed itself). */
          actor: person(refs.people.get(e.actorId)),
          from: valueOf(e.type, e.fromValue),
          to: valueOf(e.type, e.toValue),
          isInternal: e.isInternal,
          comment: comment
            ? { id: comment.id, body: comment.body, attachments: filesOf(comment.id) }
            : null,
        };
      }),
    };
  }

  /* --------------------------------------------------------------- writing */

  /** Saves a patch and its events in one transaction; returns the new row. */
  function save(ticket, patch, events, actorId, at, extra) {
    return store.transaction(async (tx) => {
      // `extra` writes the comment, when there is one, and hands back its id.
      const commentId = extra ? await extra(tx) : null;
      const row = Object.keys(patch).length
        ? await tx.update('ticket', ticket.id, patch)
        : ticket;
      for (const [i, event] of events.entries()) {
        await tx.insert('event', {
          ticketId: ticket.id,
          actorId,
          fromValue: null,
          toValue: null,
          commentId: event.type === 'comment' ? commentId : null,
          isInternal: false,
          ...event,
          // Kept in the order they happened, even within one request.
          createdAt: new Date(at.getTime() + i),
        });
      }
      return row;
    });
  }

  const statusEvent = (from, to) => ({ type: 'status', fromValue: from, toValue: to });

  /* ------------------------------------------------------ for every person */

  /** What the "new ticket" form needs. */
  async function options(req) {
    const viewer = await viewerOf(req);
    const [teams, teamCompanies, categories, locations, [me]] = await Promise.all([
      store.find('team', { isActive: true }),
      store.find('teamCompany'),
      store.find('category', { isActive: true }, { orderBy: [{ sortOrder: 'asc' }] }),
      store.find('location', { isActive: true }, { orderBy: [{ sortOrder: 'asc' }] }),
      store.getUsers([viewer.user.id]),
    ]);
    const servedBy = (team) =>
      teamCompanies.filter((s) => s.teamId === team.id).map((s) => s.companyId);
    const staffTeams = new Set(
      viewer.holdingAdmin ? teams.map((t) => t.id) : viewer.memberships.map((m) => m.teamId)
    );
    const open = new Set(
      teams
        .filter((t) => staffTeams.has(t.id) || serves(t, servedBy(t), viewer.user.companyId))
        .map((t) => t.id)
    );
    return {
      teams: teams.filter((t) => open.has(t.id)).map((t) => ({ ...named(t), code: t.code })),
      categories: categories
        .filter((c) => open.has(c.teamId))
        .map((c) => ({ ...named(c), teamId: c.teamId, defaultPriority: c.defaultPriority })),
      locations: locations.map(named),
      defaultLocationId: matchLocation(me?.officeLocation, locations),
      priorities: PRIORITIES,
      statuses: STATUSES,
      sources: SOURCES,
      /** May log a ticket for someone else, with a source. */
      canLogForOthers: staffTeams.size > 0,
      attachments: {
        maxBytes: MAX_ATTACHMENT_BYTES,
        maxPerComment: MAX_ATTACHMENTS,
        extensions: ATTACHMENT_EXTENSIONS,
      },
    };
  }

  async function create(req, body) {
    const viewer = await viewerOf(req);
    const at = now();

    const category = await store.get('category', body.categoryId);
    const team = category?.isActive ? await store.get('team', category.teamId) : null;
    if (!team?.isActive) throw refuse(400, 'unknown_category', 'Choose a category.');

    const isMember =
      viewer.holdingAdmin || viewer.memberships.some((m) => m.teamId === team.id);
    const forOther = body.requesterId !== undefined && body.requesterId !== viewer.user.id;
    // The priority is the requester's own answer to "how urgent is it?"; only
    // the source and another requester are for the team (D106).
    const agentFields = forOther || (body.source ?? 'portal') !== 'portal';
    if (agentFields && !isMember) throw forbidden();

    const [requester] = await store.getUsers([forOther ? body.requesterId : viewer.user.id]);
    if (!requester?.isActive) {
      throw refuse(400, 'unknown_requester', 'That person is not in the directory.');
    }
    const served = team.servesAllCompanies
      ? []
      : (await store.find('teamCompany', { teamId: team.id })).map((s) => s.companyId);
    if (!serves(team, served, requester.companyId)) {
      throw forOther
        ? refuse(400, 'unknown_requester', 'This team does not serve that person’s company.')
        : refuse(400, 'unknown_category', 'Choose a category.');
    }

    const locations = await store.find('location', { isActive: true });
    let locationId = body.locationId ?? null;
    if (body.locationId === undefined) {
      locationId = matchLocation(requester.officeLocation, locations);
    } else if (locationId && !locations.some((l) => l.id === locationId)) {
      throw refuse(400, 'unknown_location', 'Choose a location.');
    }

    const priority = body.priority ?? category.defaultPriority;
    const [schedule, policy] = await Promise.all([
      scheduleFor(team.id),
      policyFor(team.id, priority),
    ]);
    const draft = {
      companyId: requester.companyId,
      teamId: team.id,
      categoryId: category.id,
      locationId,
      requesterId: requester.id,
      createdById: viewer.user.id,
      source: body.source ?? (forOther ? 'phone' : 'portal'),
      assigneeId: null,
      subject: body.subject,
      description: body.description,
      priority,
      status: 'New',
      firstRespondedAt: null,
      resolvedAt: null,
      closedAt: null,
      slaPausedMinutes: 0,
      slaPausedAt: null,
      autoCloseAt: null,
      assetTag: body.assetTag || null,
      createdAt: at,
    };
    Object.assign(draft, slaFields(draft, policy, schedule));

    // The year on the team's own calendar: a ticket raised at 00:30 on
    // 1 January in Cairo belongs to the new year, whatever UTC says.
    const year = Number(zoneDay(at, schedule.timeZone).slice(0, 4));
    await store.ensureSequence(team.code, year);
    const ticket = await store.transaction(async (tx) => {
      const sequence = await tx.nextTicketNumber(team.code, year);
      const row = await tx.insert('ticket', {
        ...draft,
        number: ticketNumber(team.code, year, sequence),
      });
      await tx.insert('event', {
        ticketId: row.id,
        actorId: viewer.user.id,
        type: 'created',
        fromValue: null,
        toValue: 'New',
        commentId: null,
        isInternal: false,
        createdAt: at,
      });
      return row;
    });

    return detail(
      {
        viewer,
        staffRole: staffRoleOn(viewer, ticket),
        isRequester: ticket.requesterId === viewer.user.id,
      },
      ticket
    );
  }

  async function listMine(req, { status, q, page, pageSize }) {
    const viewer = await viewerOf(req);
    const at = now();
    const { total, items } = await store.listTickets({
      requesterId: viewer.user.id,
      statuses: statusesOf(status),
      q,
      order: 'recent',
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const refs = await refsFor(items);
    return { total, page, pageSize, items: items.map((t) => summaryView(viewer, t, refs, at)) };
  }

  /**
   * The numbers beside "Tickets" in the navigation. `queue` is null for
   * anyone who is not helpdesk staff, so nothing about other people's tickets
   * can be read from it.
   */
  async function counts(req) {
    const viewer = await viewerOf(req);
    const mine = await store.countTickets({
      requesterId: viewer.user.id,
      statuses: ACTIVE_STATUSES,
    });
    if (!viewer.isStaff) return { mine, queue: null };

    const scopes = scopesOf(viewer);
    const [unassigned, breachingSoon, assignedToMe] = await Promise.all([
      store.countTickets({ scopes, statuses: ACTIVE_STATUSES, assigneeId: null }),
      store.countTickets({ scopes, statuses: ACTIVE_STATUSES, riskBy: now() }),
      store.countTickets({ scopes, statuses: ACTIVE_STATUSES, assigneeId: viewer.user.id }),
    ]);
    return { mine, queue: { unassigned, breachingSoon, assignedToMe } };
  }

  async function get(req, id) {
    const ctx = await loadTicket(req, id);
    return detail(ctx, ctx.ticket);
  }

  /** Back to Open, by its requester (inside the window) or by staff. */
  async function reopenPatch(ctx, at) {
    const { ticket, staffRole, isRequester } = ctx;
    if (ticket.status !== 'Resolved' && ticket.status !== 'Closed') {
      throw refuse(409, 'not_resolved', 'Only a resolved or closed ticket can be reopened.');
    }
    if (!staffRole && !(isRequester && withinReopenWindow(ticket, at))) {
      throw refuse(
        409,
        'reopen_window_closed',
        `A ticket can be reopened for ${REOPEN_DAYS} days after it was resolved. Raise a new one.`,
        { days: REOPEN_DAYS }
      );
    }
    return {
      patch: await recalculate(ticket, { status: 'Open' }, at),
      events: [{ type: 'reopened', fromValue: ticket.status, toValue: 'Open' }],
    };
  }

  async function reopen(req, id) {
    const ctx = await loadTicket(req, id);
    const at = now();
    const { patch, events } = await reopenPatch(ctx, at);
    const row = await save(ctx.ticket, patch, events, ctx.viewer.user.id, at);
    return detail(ctx, row);
  }

  async function comment(req, id, { body, isInternal }) {
    const ctx = await loadTicket(req, id);
    const { ticket, staffRole, isRequester, viewer } = ctx;
    const at = now();
    if (isInternal && !staffRole) throw forbidden();
    if (ticket.status === 'Closed' && !isInternal) {
      throw refuse(409, 'ticket_closed', 'This ticket is closed. Reopen it to reply.');
    }

    let patch = {};
    const events = [{ type: 'comment', isInternal }];
    if (!isInternal && isRequester) {
      // The requester has answered: the clock runs again, and a resolved
      // ticket is not resolved after all.
      if (ticket.status === 'WaitingOnRequester') {
        patch = await recalculate(ticket, { status: 'Open' }, at);
        events.push(statusEvent(ticket.status, 'Open'));
      } else if (ticket.status === 'Resolved') {
        const reopened = await reopenPatch(ctx, at);
        patch = reopened.patch;
        events.push(...reopened.events);
      }
    } else if (!isInternal) {
      // An agent's first public word is the first response.
      const changes = {};
      if (!ticket.firstRespondedAt) changes.firstRespondedAt = at;
      if (ticket.status === 'New') {
        changes.status = 'Open';
        events.push(statusEvent('New', 'Open'));
      }
      if (Object.keys(changes).length) patch = await recalculate(ticket, changes, at);
    }

    const row = await save(ticket, patch, events, viewer.user.id, at, async (tx) => {
      const made = await tx.insert('comment', {
        ticketId: ticket.id,
        authorId: viewer.user.id,
        body,
        isInternal,
        createdAt: at,
      });
      return made.id;
    });
    return detail(ctx, row);
  }

  async function addAttachment(req, id, { name, commentId }, buffer) {
    const ctx = await loadTicket(req, id);
    const { ticket, staffRole, viewer } = ctx;
    const at = now();
    if (ticket.status === 'Closed') {
      throw refuse(409, 'ticket_closed', 'This ticket is closed. Reopen it to add a file.');
    }

    let isInternal = false;
    if (commentId) {
      const target = await store.get('comment', commentId);
      // Someone else's comment, or an internal one the viewer cannot see, is not there.
      if (
        !target ||
        target.ticketId !== ticket.id ||
        target.authorId !== viewer.user.id ||
        (target.isInternal && !staffRole)
      ) {
        throw notFound();
      }
      isInternal = target.isInternal;
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw refuse(400, 'empty_upload', 'The file is empty.');
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throw refuse(413, 'file_too_large', 'A file can be 10 MB at most.', {
        maxBytes: MAX_ATTACHMENT_BYTES,
      });
    }
    const fileName = cleanFileName(name);
    const kind = detectAttachment(buffer, fileName);
    if (!kind) {
      throw refuse(
        415,
        'unsupported_file',
        'Attach an image, a PDF, a Word, Excel or PowerPoint file, or a .txt or .log file.',
        { extensions: ATTACHMENT_EXTENSIONS }
      );
    }
    const together = await store.find('attachment', {
      ticketId: ticket.id,
      commentId: commentId ?? null,
    });
    if (together.length >= MAX_ATTACHMENTS) {
      throw refuse(409, 'too_many_attachments', `At most ${MAX_ATTACHMENTS} files at a time.`, {
        max: MAX_ATTACHMENTS,
      });
    }

    const storageKey = `ticket-${randomUUID()}.${kind.ext}`;
    await storage.put(storageKey, buffer);
    try {
      const row = await store.transaction(async (tx) => {
        const made = await tx.insert('attachment', {
          ticketId: ticket.id,
          commentId: commentId ?? null,
          uploadedById: viewer.user.id,
          fileName,
          contentType: kind.type,
          size: buffer.length,
          storageKey,
          isInternal,
          createdAt: at,
        });
        await tx.insert('event', {
          ticketId: ticket.id,
          actorId: viewer.user.id,
          type: 'attachment',
          fromValue: null,
          toValue: fileName,
          commentId: commentId ?? null,
          isInternal,
          createdAt: at,
        });
        return made;
      });
      const refs = await refsFor([], { userIds: [viewer.user.id] });
      return attachmentView(row, refs);
    } catch (err) {
      // No row points at the bytes: do not leave them behind.
      await storage.remove(storageKey).catch((cause) => {
        log.warn({ err: cause, storageKey }, 'orphaned ticket attachment');
      });
      throw err;
    }
  }

  /** The bytes of one attachment, for someone who may read its ticket. */
  async function readAttachment(req, id, attachmentId) {
    const { staffRole } = await loadTicket(req, id);
    const row = await store.get('attachment', attachmentId);
    if (!row || row.ticketId !== id || (row.isInternal && !staffRole)) throw notFound();
    const buffer = await storage.get(row.storageKey);
    if (!buffer) throw notFound();
    return { buffer, type: row.contentType, fileName: row.fileName };
  }

  /* ---------------------------------------------------------- for the team */

  async function staffViewer(req) {
    const viewer = await viewerOf(req);
    if (!viewer.isStaff) throw forbidden();
    return viewer;
  }

  /** The team's tickets, nearest due date first. */
  async function queue(req, query) {
    const viewer = await staffViewer(req);
    const at = now();
    const { status, assignee, page, pageSize, ...rest } = query;
    const { total, items } = await store.listTickets({
      ...rest,
      scopes: scopesOf(viewer),
      statuses: statusesOf(status),
      ...(assignee === undefined
        ? {}
        : {
            assigneeId:
              assignee === 'unassigned' ? null : assignee === 'me' ? viewer.user.id : assignee,
          }),
      now: at,
      order: 'due',
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const refs = await refsFor(items);
    return { total, page, pageSize, items: items.map((t) => summaryView(viewer, t, refs, at)) };
  }

  /** The teams a staff viewer works in: every active one for a HoldingAdmin. */
  async function teamsOf(viewer) {
    const teams = await store.find('team', { isActive: true });
    if (viewer.holdingAdmin) return teams;
    const mine = new Set(viewer.memberships.map((m) => m.teamId));
    return teams.filter((t) => mine.has(t.id));
  }

  /** What the queue's filters and the assign menu need. */
  async function queueOptions(req) {
    const viewer = await staffViewer(req);
    const teams = await teamsOf(viewer);
    const teamIds = teams.map((t) => t.id);
    const [members, categories, locations, companies, served] = await Promise.all([
      teamIds.length ? store.find('member', { teamId: teamIds }) : [],
      teamIds.length
        ? store.find('category', { teamId: teamIds }, { orderBy: [{ sortOrder: 'asc' }] })
        : [],
      store.find('location', {}, { orderBy: [{ sortOrder: 'asc' }] }),
      store.listCompanies(),
      teamIds.length ? store.find('teamCompany', { teamId: teamIds }) : [],
    ]);
    const people = new Map(
      (await store.getUsers(unique(members.map((m) => m.userId)))).map((p) => [p.id, p])
    );
    const everyCompany = teams.some((t) => t.servesAllCompanies);
    const servedIds = new Set(served.map((s) => s.companyId));
    return {
      teams: teams.map((t) => ({ ...named(t), code: t.code })),
      agents: members
        .filter((m) => people.get(m.userId)?.isActive)
        .map((m) => ({ ...person(people.get(m.userId)), teamId: m.teamId, role: m.role })),
      categories: categories.map((c) => ({
        ...named(c),
        teamId: c.teamId,
        isActive: c.isActive,
      })),
      locations: locations.map((l) => ({ ...named(l), isActive: l.isActive })),
      companies: companies
        .filter((c) => everyCompany || servedIds.has(c.id))
        .map((c) => ({ ...named(c), code: c.code })),
      priorities: PRIORITIES,
      statuses: STATUSES,
    };
  }

  /** Assign, or change the status, priority or category. */
  async function update(req, id, body) {
    const ctx = await loadTicket(req, id);
    const { ticket, staffRole, viewer } = ctx;
    // The requester can see the ticket, so this is a refusal, not a 404.
    if (!staffRole) throw forbidden();
    const at = now();
    const patch = {};
    const changes = {};
    const events = [];

    if (body.assigneeId !== undefined && body.assigneeId !== (ticket.assigneeId ?? null)) {
      // An agent takes an unassigned ticket, hands on or gives back their
      // own; taking one from a colleague is the lead's call.
      const theirs = ticket.assigneeId == null || ticket.assigneeId === viewer.user.id;
      if (!theirs && !isLead(staffRole)) {
        throw refuse(403, 'lead_only', 'Only a team lead can reassign someone else’s ticket.');
      }
      if (body.assigneeId) {
        const [membership] = await store.find('member', {
          teamId: ticket.teamId,
          userId: body.assigneeId,
        });
        const [target] = membership ? await store.getUsers([body.assigneeId]) : [];
        if (!target?.isActive) {
          throw refuse(400, 'unknown_assignee', 'Choose someone on this team.');
        }
      }
      patch.assigneeId = body.assigneeId;
      events.push({
        type: 'assigned',
        fromValue: ticket.assigneeId ?? null,
        toValue: body.assigneeId,
      });
      // Someone has it now: it is no longer new.
      if (body.assigneeId && ticket.status === 'New' && body.status === undefined) {
        changes.status = 'Open';
      }
    }

    if (body.categoryId !== undefined && body.categoryId !== ticket.categoryId) {
      const category = await store.get('category', body.categoryId);
      if (!category?.isActive || category.teamId !== ticket.teamId) {
        throw refuse(400, 'unknown_category', 'Choose one of this team’s categories.');
      }
      patch.categoryId = category.id;
      events.push({ type: 'category', fromValue: ticket.categoryId, toValue: category.id });
    }

    if (body.priority !== undefined && body.priority !== ticket.priority) {
      changes.priority = body.priority;
      events.push({ type: 'priority', fromValue: ticket.priority, toValue: body.priority });
    }

    if (body.status !== undefined && body.status !== ticket.status)
      changes.status = body.status;
    if (changes.status) {
      const reopening = ticket.status === 'Resolved' || ticket.status === 'Closed';
      events.push(
        reopening && changes.status === 'Open'
          ? { type: 'reopened', fromValue: ticket.status, toValue: 'Open' }
          : statusEvent(ticket.status, changes.status)
      );
    }

    if (Object.keys(changes).length)
      Object.assign(patch, await recalculate(ticket, changes, at));
    const row = events.length ? await save(ticket, patch, events, viewer.user.id, at) : ticket;
    return detail(ctx, row);
  }

  /** The replies an agent can drop into a comment. */
  async function cannedReplies(req, { teamId } = {}) {
    const viewer = await staffViewer(req);
    const teamIds = (await teamsOf(viewer)).map((t) => t.id);
    if (teamId && !teamIds.includes(teamId)) throw notFound();
    const wanted = teamId ? [teamId] : teamIds;
    const rows = wanted.length
      ? await store.find(
          'canned',
          { teamId: wanted, isActive: true },
          { orderBy: [{ sortOrder: 'asc' }, { titleEn: 'asc' }] }
        )
      : [];
    return {
      items: rows.map((r) => ({
        id: r.id,
        teamId: r.teamId,
        titleEn: r.titleEn,
        titleAr: r.titleAr,
        bodyEn: r.bodyEn,
        bodyAr: r.bodyAr,
      })),
    };
  }

  /* ---------------------------------------------------------------- the job */

  /**
   * Closes every resolved ticket whose three working days are up. Nobody is
   * acting, so the event has no actor. Returns how many it closed.
   */
  async function closeResolved() {
    const at = now();
    const { items } = await store.listTickets({
      statuses: ['Resolved'],
      autoCloseBy: at,
      order: 'recent',
      take: 500,
    });
    let closed = 0;
    for (const item of items) {
      try {
        const done = await store.transaction(async (tx) => {
          // Read again inside the transaction: the requester may just have replied.
          const ticket = await tx.get('ticket', item.id);
          if (ticket?.status !== 'Resolved' || !ticket.autoCloseAt || ticket.autoCloseAt > at) {
            return false;
          }
          await tx.update('ticket', ticket.id, {
            status: 'Closed',
            closedAt: at,
            autoCloseAt: null,
            slaActive: false,
          });
          await tx.insert('event', {
            ticketId: ticket.id,
            actorId: null,
            type: 'autoClosed',
            fromValue: 'Resolved',
            toValue: 'Closed',
            commentId: null,
            isInternal: false,
            createdAt: at,
          });
          return true;
        });
        if (done) closed += 1;
      } catch (err) {
        log.warn({ err, ticketId: item.id }, 'ticket auto-close failed');
      }
    }
    return closed;
  }

  return {
    options,
    create,
    listMine,
    counts,
    get,
    comment,
    addAttachment,
    readAttachment,
    reopen,
    queue,
    queueOptions,
    update,
    cannedReplies,
    closeResolved,
  };
}
