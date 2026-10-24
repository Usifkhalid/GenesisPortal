/**
 * service.js — helpdesk tickets: the rules, apart from HTTP and from storage.
 *
 * Who reads a ticket (rules.js, docs/DECISIONS.md D99): its requester, the
 * members of its support team for the companies that team serves. Not the
 * requester's colleagues, not their CompanyAdmin and not a HoldingAdmin who is
 * not on the team (D135).
 * Every route here starts from `loadTicket` or from a filter that carries the
 * viewer's own id or team scopes, and anything out of reach answers 404, so a
 * ticket's existence is never disclosed: not by id, list, search, count,
 * attachment address or number.
 *
 * The life of a ticket:
 *   New → Open              an agent takes it, is assigned it, or answers
 *   Open ⇄ Pending          the clock stops while the requester is asked
 *                           something; their reply sets it running again
 *   → Resolved              IT says it is fixed and asks the requester. The
 *                           ticket stays open and its clock keeps running; the
 *                           requester is reminded every 24 hours. Nothing
 *                           closes it on a timer (D143)
 *   Resolved → Closed       the requester confirms and rates it ("solved"), or
 *                           a Lead closes it without confirmation, with a
 *                           reason. Only now does the resolution clock stop
 *   Resolved → Open         the requester says it is not solved (a reason is
 *                           required); the assignee is told
 *   Closed → Open           the requester may still reopen for seven days
 *                           after it was resolved; a rating, once given, stays
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
 * People are told through lib/notify.js after a change is saved, never before
 * and never in a way that can fail it: the new ticket, a first assignment, a
 * public reply, a new status, "is your problem solved?" and its reminders, a
 * "not solved", a confirmation, and the SLA alerts of `watchSla`. An internal
 * note tells nobody. The person who did the thing is not told of it.
 *
 * Errors a screen can act on carry a stable code (docs/API.md):
 *   unknown_category, unknown_location, unknown_requester, unknown_assignee,
 *   ticket_closed, not_resolved, reopen_window_closed, lead_only, own_work,
 *   rating_required, already_rated, unsupported_file, empty_upload, file_too_large, too_many_attachments.
 */

import { randomUUID } from 'node:crypto';

import { ATTACHMENT_EXTENSIONS, detectAttachment } from '../../lib/file-type.js';
import { logger } from '../../lib/logger.js';
import { bothLanguages } from '../../lib/messages.js';
import { silentNotify } from '../../lib/notify.js';
import { writeAudit } from '../../lib/audit.js';
import { requireUser } from '../../lib/scope.js';
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
  DEFAULT_SLA,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  PRIORITIES,
  REMINDER_HOURS,
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
const REMINDER_MS = REMINDER_HOURS * 60 * 60 * 1000;
const unique = (list) => [...new Set(list.filter(Boolean))];

const person = (p) =>
  p ? { id: p.id, displayNameEn: p.displayNameEn, displayNameAr: p.displayNameAr } : null;
const named = (row) => (row ? { id: row.id, nameEn: row.nameEn, nameAr: row.nameAr } : null);

/** `attention` is what waits on the requester: Pending, and Resolved awaiting their word. */
const statusesOf = (filter) =>
  filter === 'all'
    ? undefined
    : filter === 'active'
      ? ACTIVE_STATUSES
      : filter === 'attention'
        ? ['Pending', 'Resolved']
        : [filter];

/**
 * @param {object} deps
 * @param {object} deps.store  see store-prisma.js
 * @param {object} deps.storage  see lib/storage.js
 * @param {() => Date} [deps.now]
 * @param {{ warn: Function }} [deps.log]
 * @param {(userIds: string[], key: string, data?: object) => Promise<object>} [deps.notify]
 *   see lib/notify.js
 * @param {string} [deps.staffPage]  the page IT staff work tickets in: '/helpdesk' in
 *   the portal (D135); '' in the IT Helpdesk app, where everyone's tickets are on
 *   its one page
 */
export function createTicketService({
  store,
  storage,
  now = () => new Date(),
  log = logger,
  notify = silentNotify,
  staffPage = '/helpdesk',
}) {
  /** Where a notification about a ticket leads: IT's page for IT, the requester's otherwise. */
  const ticketLink = (id, inHelpdesk) => `${inHelpdesk ? staffPage : ''}#tickets/${id}`;

  /* ------------------------------------------------------------ the viewer */

  /**
   * Who is asking, in helpdesk terms: the teams they are on (active ones),
   * the companies each of those serves. Read on every request, so someone
   * taken off a team loses the queue at once. An administrator's role counts
   * for nothing here (D135).
   */
  async function viewerOf(req) {
    const user = requireUser(req);
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
    return { user, memberships, isStaff: memberships.length > 0 };
  }

  /** The filter part that keeps a staff list inside what the viewer serves. */
  const scopesOf = (viewer) =>
    viewer.memberships.map(({ teamId, companyIds }) => ({ teamId, companyIds }));

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

  /* -------------------------------------------------------- telling people */

  /** A person's name in both languages, for a notification's text. */
  async function nameOf(userId) {
    if (!userId) return '';
    const [p] = await store.getUsers([userId]);
    return p ? { en: p.displayNameEn, ar: p.displayNameAr || p.displayNameEn } : '';
  }

  /** Which of these people are on an active support team: they work in /helpdesk. */
  async function itMemberIds(userIds) {
    const rows = await store.find('member', { userId: userIds });
    if (rows.length === 0) return new Set();
    const active = await store.find('team', {
      id: unique(rows.map((r) => r.teamId)),
      isActive: true,
    });
    const teamIds = new Set(active.map((t) => t.id));
    return new Set(rows.filter((r) => teamIds.has(r.teamId)).map((r) => r.userId));
  }

  /** Ids of the team's leads who are still active. */
  async function leadIds(teamId) {
    const members = await store.find('member', { teamId, role: 'Lead' });
    if (members.length === 0) return [];
    const people = await store.getUsers(members.map((m) => m.userId));
    return people.filter((p) => p.isActive).map((p) => p.id);
  }

  /**
   * Tells people about a ticket, once the change is saved. Whatever goes wrong
   * here is logged and swallowed: the ticket has already changed. The actor is
   * left out of the recipients.
   * @param {string[]} userIds
   * @param {string} key  a template in notification-text.js
   * @param {object} ticket
   * @param {{ actorId?: string | null, extra?: object }} [options]
   * @returns {Promise<number>} how many deliveries were made (in-app rows and emails)
   */
  async function tell(userIds, key, ticket, { actorId = null, extra = {} } = {}) {
    let delivered = 0;
    try {
      const to = unique(userIds).filter((id) => id !== actorId);
      if (to.length === 0) return 0;
      // IT team members open the ticket in the Helpdesk, everyone else in the
      // portal (D135).
      const it = await itMemberIds(to);
      for (const inHelpdesk of [false, true]) {
        const group = to.filter((id) => it.has(id) === inHelpdesk);
        if (group.length === 0) continue;
        const sent = await notify(group, key, {
          link: ticketLink(ticket.id, inHelpdesk),
          number: ticket.number,
          subject: ticket.subject,
          ...extra,
        });
        delivered += (sent?.inApp ?? 0) + (sent?.email ?? 0);
      }
    } catch (err) {
      log.warn({ err, ticketId: ticket.id, key }, 'ticket notification failed');
    }
    return delivered;
  }

  /** The requester is told of a new status, unless they set it themselves. */
  const tellStatus = (ticket, status, actorId) =>
    tell([ticket.requesterId], 'ticket.status', ticket, {
      actorId,
      extra: { status: bothLanguages(`ticket.status.${status}`) },
    });

  /** "Is your problem solved?": IT has set the ticket to Resolved. */
  const tellResolved = (ticket, actorId) =>
    tell([ticket.requesterId], 'ticket.resolved', ticket, { actorId });

  /** Who has the ticket: its assignee, or the team's leads while nobody does. */
  async function holdersOf(ticket) {
    return ticket.assigneeId ? [ticket.assigneeId] : leadIds(ticket.teamId);
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
   * A pause runs from the moment the ticket becomes Pending or Closed; its
   * business minutes are added when the ticket moves on. A Resolved ticket is
   * still open and its clock runs.
   */
  function transition(ticket, to, at, schedule) {
    const waited = ticket.slaPausedAt ? schedule.between(ticket.slaPausedAt, at) : 0;
    const out = {
      status: to,
      slaPausedMinutes: ticket.slaPausedMinutes + waited,
      // The clock stands still while Pending and once the ticket is closed.
      slaPausedAt: RUNNING_STATUSES.includes(to) ? null : at,
    };
    if (to === 'Resolved') {
      Object.assign(out, {
        resolvedAt: at,
        closedAt: null,
        closeMode: null,
        closeReason: null,
      });
    } else if (to === 'Closed') {
      Object.assign(out, { resolvedAt: ticket.resolvedAt ?? at, closedAt: at });
    } else {
      // Open, Pending or New: the ticket is not done. Whatever rating it has stays.
      Object.assign(out, {
        resolvedAt: null,
        closedAt: null,
        closeMode: null,
        closeReason: null,
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
    // A resolved ticket that only closes keeps the dates it is judged by.
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
      closeMode: t.closeMode ?? null,
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

  /**
   * May this viewer work the ticket: reply to the requester, change its status,
   * priority or category, reopen it? A Lead always; an agent
   * only on a ticket assigned to them (D122). Everyone else on the team reads
   * it and adds internal notes.
   */
  function works(staffRole, ticket, viewer) {
    if (!staffRole) return false;
    return isLead(staffRole) || ticket.assigneeId === viewer.user.id;
  }

  const notAssignee = () =>
    refuse(403, 'not_assignee', 'Only the agent this ticket is assigned to can do that.');

  /** A ticket in full, with what this viewer may do to it. */
  function ticketView({ viewer, staffRole, isRequester }, t, refs, at) {
    const closed = t.status === 'Closed';
    const done = closed || t.status === 'Resolved';
    // The requester decides when it is solved; the agent who worked it cannot
    // answer for them or rate themselves (D143).
    const ownWork = Boolean(staffRole) && t.assigneeId === viewer.user.id;
    const asked = isRequester && t.status === 'Resolved' && !ownWork;
    return {
      ...summaryView(viewer, t, refs, at),
      description: t.description,
      /** The requester's stars and words, once given; never changed. */
      rating:
        t.rating == null
          ? null
          : { stars: t.rating, feedback: t.ratingFeedback ?? null, at: t.ratedAt ?? null },
      /** A Lead's reason for closing without confirmation: for the team only. */
      closeReason: staffRole ? (t.closeReason ?? null) : null,
      assetTag: t.assetTag,
      createdBy: person(refs.people.get(t.createdById)),
      /** For the team only: the language a canned reply is written in. */
      ...(staffRole
        ? { requesterLanguage: refs.people.get(t.requesterId)?.language === 'ar' ? 'ar' : 'en' }
        : {}),
      can: {
        // A public reply: the requester, or the team member who works the ticket.
        comment: !closed && (!staffRole || isRequester || works(staffRole, t, viewer)),
        internalNote: Boolean(staffRole),
        attach: !closed,
        // A requester answers a Resolved ticket with "solved" or "not solved";
        // reopening is for a Closed one (inside the window) and for the team.
        reopen:
          done &&
          ((Boolean(staffRole) && works(staffRole, t, viewer)) ||
            (isRequester && closed && withinReopenWindow(t, at))),
        /** "Yes, solved" (with a rating the first time) and "No, still a problem". */
        confirm: asked,
        needsRating: asked && t.rating == null,
        notSolved: asked,
        /** A Lead closes a ticket whose requester does not answer. */
        closeWithoutConfirmation:
          isLead(staffRole) && (t.status === 'Resolved' || t.status === 'Pending'),
        /** The staff view of the ticket (SLA, codes, the team's panels). */
        manage: Boolean(staffRole),
        /** Status, priority and category: the assignee or a Lead (D122). */
        work: works(staffRole, t, viewer),
        reassign: isLead(staffRole),
      },
    };
  }

  /** Each file's scan state; a storage without scanning (a test's) says nothing. */
  const scanStates = async (rows) =>
    typeof storage.states === 'function'
      ? storage.states(rows.map((a) => a.storageKey))
      : undefined;

  const attachmentView = (a, refs) => ({
    id: a.id,
    fileName: a.fileName,
    contentType: a.contentType,
    size: a.size,
    isInternal: a.isInternal,
    uploadedBy: person(refs.people.get(a.uploadedById)),
    // pending | clean | infected (lib/file-scan.js): only a clean file downloads.
    scan: refs.scans?.get(a.storageKey) ?? 'clean',
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

    const scans = await scanStates(shownAttachments);
    const refs = await refsFor([ticket], {
      userIds: [
        ...shownEvents.map((e) => e.actorId),
        ...shownEvents
          .filter((e) => e.type === 'assigned')
          .flatMap((e) => [e.fromValue, e.toValue]),
        ...shownAttachments.map((a) => a.uploadedById),
      ],
    });
    refs.scans = scans;
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
      for (const [i, { withComment, ...event }] of events.entries()) {
        await tx.insert('event', {
          ticketId: ticket.id,
          actorId,
          fromValue: null,
          toValue: null,
          commentId: event.type === 'comment' || withComment ? commentId : null,
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
    const staffTeams = new Set(viewer.memberships.map((m) => m.teamId));
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

    const isMember = viewer.memberships.some((m) => m.teamId === team.id);
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
      closeMode: null,
      closeReason: null,
      rating: null,
      ratingFeedback: null,
      ratedAt: null,
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
      // An agent raising a ticket for someone who phoned or has no computer is
      // an action on another person's behalf: the log names both.
      if (row.createdById !== row.requesterId) {
        await writeAudit(
          req,
          'ticket.create_on_behalf',
          'Ticket',
          null,
          {
            id: row.id,
            number: row.number,
            requesterId: row.requesterId,
            createdById: row.createdById,
            source: row.source,
            teamId: row.teamId,
            categoryId: row.categoryId,
          },
          { tx, companyId: row.companyId }
        );
      }
      return row;
    });

    // The requester gets the confirmation; the team's leads see it arrive.
    await tell([requester.id], 'ticket.created', ticket);
    await tell(await leadIds(team.id), 'ticket.created', ticket, { actorId: viewer.user.id });

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
    // `canAssign` tells the navigation which number matters: a Lead's is the
    // unassigned tickets, an agent's the ones given to them (D118).
    const canAssign = viewer.memberships.some((m) => m.role === 'Lead');
    return { mine, queue: { unassigned, breachingSoon, assignedToMe, canAssign } };
  }

  async function get(req, id) {
    const ctx = await loadTicket(req, id);
    return detail(ctx, ctx.ticket);
  }

  /**
   * The id of the ticket with this number, for a link by number (the old
   * portal's links and emails, D146). Asked like any ticket: one the person may
   * not see is not found.
   */
  async function idByNumber(req, number) {
    const [row] = await store.find('ticket', { number });
    if (!row) throw notFound();
    const { ticket } = await loadTicket(req, row.id);
    return { id: ticket.id, number: ticket.number };
  }

  /** Back to Open, by its requester (inside the window) or by staff. */
  async function reopenPatch(ctx, at) {
    const { ticket, staffRole, isRequester } = ctx;
    if (ticket.status !== 'Resolved' && ticket.status !== 'Closed') {
      throw refuse(409, 'not_resolved', 'Only a resolved or closed ticket can be reopened.');
    }
    if (staffRole && !isRequester && !works(staffRole, ticket, ctx.viewer)) throw notAssignee();
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
    await tellStatus(row, 'Open', ctx.viewer.user.id);
    return detail(ctx, row);
  }

  /* ---------------------------------- the requester decides when it is solved */

  /**
   * The requester's own action on a Resolved ticket. Anyone else who may read
   * the ticket is refused (403), and the agent who worked it cannot answer for
   * the requester when they happen to be both (D143).
   */
  async function requesterContext(req, id) {
    const ctx = await loadTicket(req, id);
    const { ticket, viewer, staffRole, isRequester } = ctx;
    if (!isRequester) throw forbidden();
    if (staffRole && ticket.assigneeId === viewer.user.id) {
      throw refuse(
        403,
        'own_work',
        'You cannot confirm or rate a ticket you worked on yourself.'
      );
    }
    if (ticket.status !== 'Resolved') {
      throw refuse(409, 'not_resolved', 'IT has not marked this ticket as solved.');
    }
    return ctx;
  }

  /** Aborts the transaction when the ticket is no longer Resolved (a double click). */
  const stillResolved = (ticketId) => async (tx) => {
    const fresh = await tx.get('ticket', ticketId);
    if (fresh?.status !== 'Resolved') {
      throw refuse(409, 'not_resolved', 'IT has not marked this ticket as solved.');
    }
    return null;
  };

  /** "Yes, solved": a rating (the first time), then Closed. The resolution clock stops. */
  async function confirm(req, id, { rating, feedback }) {
    const ctx = await requesterContext(req, id);
    const { ticket, viewer } = ctx;
    const at = now();
    const rated = ticket.rating != null;
    if (rated && rating !== undefined) {
      throw refuse(
        409,
        'already_rated',
        'This ticket has been rated and the rating cannot change.'
      );
    }
    if (!rated && rating === undefined) {
      throw refuse(400, 'rating_required', 'Rate the support from 1 to 5 stars.');
    }
    const patch = {
      ...(await recalculate(ticket, { status: 'Closed' }, at)),
      closeMode: 'confirmed',
      closeReason: null,
      ...(rated ? {} : { rating, ratingFeedback: feedback || null, ratedAt: at }),
    };
    const row = await save(
      ticket,
      patch,
      [{ type: 'confirmed', fromValue: 'Resolved', toValue: 'Closed' }],
      viewer.user.id,
      at,
      stillResolved(ticket.id)
    );
    await tell(await holdersOf(row), 'ticket.confirmed', row, {
      actorId: viewer.user.id,
      extra: {
        actor: await nameOf(viewer.user.id),
        stars: String(row.rating ?? ''),
      },
    });
    return detail(ctx, row);
  }

  /** "No, still a problem": the reason joins the conversation and the ticket reopens. */
  async function notSolved(req, id, { reason }) {
    const ctx = await requesterContext(req, id);
    const { ticket, viewer } = ctx;
    const at = now();
    const patch = await recalculate(ticket, { status: 'Open' }, at);
    const row = await save(
      ticket,
      patch,
      [
        { type: 'comment', isInternal: false },
        { type: 'notSolved', fromValue: 'Resolved', toValue: 'Open', withComment: true },
      ],
      viewer.user.id,
      at,
      async (tx) => {
        await stillResolved(ticket.id)(tx);
        const made = await tx.insert('comment', {
          ticketId: ticket.id,
          authorId: viewer.user.id,
          body: reason,
          isInternal: false,
          createdAt: at,
        });
        return made.id;
      }
    );
    await tell(await holdersOf(row), 'ticket.notSolved', row, {
      actorId: viewer.user.id,
      extra: {
        actor: await nameOf(viewer.user.id),
        excerpt: reason.length > 200 ? `${reason.slice(0, 197)}…` : reason,
      },
    });
    return detail(ctx, row);
  }

  /**
   * A Lead closes a ticket the requester does not answer, with a reason. It is
   * kept on the ticket, written to the audit log, and counted apart from the
   * confirmed ones in the reports. An agent cannot (D143).
   */
  async function closeWithoutConfirmation(req, id, { reason }) {
    const ctx = await loadTicket(req, id);
    const { ticket, staffRole, viewer } = ctx;
    if (!staffRole) throw forbidden();
    if (!isLead(staffRole)) {
      throw refuse(
        403,
        'lead_only',
        'Only a team lead can close a ticket without confirmation.'
      );
    }
    if (ticket.status !== 'Resolved' && ticket.status !== 'Pending') {
      throw refuse(
        409,
        ticket.status === 'Closed' ? 'ticket_closed' : 'not_resolved',
        'Only a resolved or pending ticket can be closed without confirmation.'
      );
    }
    const at = now();
    const patch = {
      ...(await recalculate(ticket, { status: 'Closed' }, at)),
      closeMode: 'lead',
      closeReason: reason,
    };
    const row = await save(
      ticket,
      patch,
      [{ type: 'closedByLead', fromValue: ticket.status, toValue: 'Closed' }],
      viewer.user.id,
      at,
      async (tx) => {
        const fresh = await tx.get('ticket', ticket.id);
        if (fresh?.status !== 'Resolved' && fresh?.status !== 'Pending') {
          throw refuse(409, 'not_resolved', 'This ticket changed. Reload it.');
        }
        await writeAudit(
          req,
          'ticket.close_without_confirmation',
          'Ticket',
          ticket,
          { ...ticket, ...patch },
          {
            tx,
            companyId: ticket.companyId,
          }
        );
        return null;
      }
    );
    await tellStatus(row, 'Closed', viewer.user.id);
    return detail(ctx, row);
  }

  async function comment(req, id, { body, isInternal }) {
    const ctx = await loadTicket(req, id);
    const { ticket, staffRole, isRequester, viewer } = ctx;
    const at = now();
    if (isInternal && !staffRole) throw forbidden();
    // A public word from the team is the assignee's or a Lead's; any other
    // agent writes an internal note (D122). The requester always may.
    if (!isInternal && staffRole && !isRequester && !works(staffRole, ticket, viewer)) {
      throw notAssignee();
    }
    if (ticket.status === 'Closed' && !isInternal) {
      throw refuse(409, 'ticket_closed', 'This ticket is closed. Reopen it to reply.');
    }

    let patch = {};
    const events = [{ type: 'comment', isInternal }];
    if (!isInternal && isRequester) {
      // The requester has answered: the clock runs again, and a resolved
      // ticket is not resolved after all.
      if (ticket.status === 'Pending') {
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

    // An internal note is between agents and tells nobody. A public reply goes
    // to the other side: the requester's to whoever has the ticket (the leads
    // while it is unassigned), an agent's to the requester.
    if (!isInternal) {
      const to = isRequester
        ? row.assigneeId
          ? [row.assigneeId]
          : await leadIds(row.teamId)
        : [row.requesterId];
      await tell(to, 'ticket.comment', row, {
        actorId: viewer.user.id,
        extra: {
          actor: await nameOf(viewer.user.id),
          excerpt: body.length > 200 ? `${body.slice(0, 197)}…` : body,
        },
      });
    }
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
    // A file on the description or on a public reply speaks for the team.
    if (!isInternal && staffRole && !ctx.isRequester && !works(staffRole, ticket, viewer)) {
      throw notAssignee();
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
    await storage.put(storageKey, buffer, {
      uploadedById: viewer.user.id,
      fileName,
      link: ticketLink(ticket.id, viewer.isStaff),
    });
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
      refs.scans = await scanStates([row]);
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

  /** The teams a staff viewer works in. */
  async function teamsOf(viewer) {
    const teams = await store.find('team', { isActive: true });
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

    const assigning =
      body.assigneeId !== undefined && body.assigneeId !== (ticket.assigneeId ?? null);
    // Status, priority and category are the assignee's or a Lead's (D122).
    // Assigning is checked first: its refusal says more.
    if (!assigning && !works(staffRole, ticket, viewer)) throw notAssignee();

    if (body.assigneeId !== undefined && body.assigneeId !== (ticket.assigneeId ?? null)) {
      // Assigning, reassigning and unassigning are the Lead's alone; an agent
      // works the tickets given to them (D118, D135).
      if (!isLead(staffRole)) {
        throw refuse(403, 'lead_only', 'Only a team lead can assign or reassign a ticket.');
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

    if (patch.assigneeId) {
      await tell([patch.assigneeId], 'ticket.assigned', row, {
        actorId: viewer.user.id,
        extra: { actor: await nameOf(viewer.user.id) },
      });
    }
    if (changes.status === 'Resolved') await tellResolved(row, viewer.user.id);
    else if (changes.status) await tellStatus(row, changes.status, viewer.user.id);
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
   * Reminds the requester of every Resolved ticket that is still waiting for
   * their word, once for each 24 hours it has waited (bell and email). The key
   * carries the ticket, the moment it was resolved and the count, so a run
   * that overlaps another, or one that repeats, tells nobody twice; a ticket
   * resolved again after a reopen starts counting afresh. Nothing is ever
   * closed here. Returns how many reminders were delivered.
   */
  async function remindResolved() {
    const at = now();
    let reminded = 0;
    const { items } = await store.listTickets({
      statuses: ['Resolved'],
      resolvedBefore: new Date(at.getTime() - REMINDER_MS),
      order: 'recent',
      take: 500,
    });
    for (const ticket of items) {
      try {
        const waits = Math.floor((at.getTime() - ticket.resolvedAt.getTime()) / REMINDER_MS);
        if (waits < 1) continue;
        const sent = await tell([ticket.requesterId], 'ticket.confirmReminder', ticket, {
          extra: { dedupeKey: `confirm:${ticket.id}:${ticket.resolvedAt.getTime()}:${waits}` },
        });
        if (sent > 0) reminded += 1;
      } catch (err) {
        log.warn({ err, ticketId: ticket.id }, 'resolved-ticket reminder failed');
      }
    }
    return reminded;
  }

  /* -------------------------------------------------------- the SLA watch */

  /**
   * Alerts for tickets whose running clock has used 75% of its target, or all
   * of it, once per threshold: the assignee and the team's leads (the leads
   * alone while it is unassigned). The target in force is the first response
   * until the ticket is answered and the resolution after, so each is warned
   * of separately. A ticket already past its target gets the breach alert
   * only, never the 75% one on top. Returns how many tickets were alerted.
   */
  async function watchSla() {
    const at = now();
    const PAGE = 200;
    const out = { atRisk: 0, breached: 0 };

    for (let skip = 0; skip < PAGE * 25; skip += PAGE) {
      const { items } = await store.listTickets({
        riskBy: at,
        order: 'due',
        skip,
        take: PAGE,
      });
      for (const ticket of items) {
        try {
          const breached = ticket.nextDueAt.getTime() <= at.getTime();
          const phase = ticket.firstRespondedAt ? 'resolution' : 'firstResponse';
          const to = unique([ticket.assigneeId, ...(await leadIds(ticket.teamId))]);
          const sent = await notify(to, breached ? 'ticket.slaBreached' : 'ticket.slaAtRisk', {
            // The assignee and the leads: the IT team, in the Helpdesk.
            link: ticketLink(ticket.id, true),
            number: ticket.number,
            subject: ticket.subject,
            phase: bothLanguages(`notification.phase.${phase}`),
            dedupeKey: `sla:${ticket.id}:${phase}:${breached ? 100 : 75}`,
          });
          if (sent.inApp + sent.email > 0) out[breached ? 'breached' : 'atRisk'] += 1;
        } catch (err) {
          log.warn({ err, ticketId: ticket.id }, 'SLA watch failed for a ticket');
        }
      }
      if (items.length < PAGE) break;
    }
    return out;
  }

  return {
    options,
    create,
    listMine,
    counts,
    get,
    idByNumber,
    comment,
    addAttachment,
    readAttachment,
    reopen,
    queue,
    queueOptions,
    update,
    cannedReplies,
    confirm,
    notSolved,
    closeWithoutConfirmation,
    remindResolved,
    watchSla,
    /** For the Helpdesk's reports (reports.js): the reader's team scopes, or 403. */
    staffScopes: async (req) => scopesOf(await staffViewer(req)),
    scheduleFor,
  };
}
