/**
 * from-portal.js — the portal's IT helpdesk moves into this app's database
 * (`npm run migrate:from-portal -- --as <email> [--dry-run] [--force-merge]`,
 * D145). The command line is backend/scripts/migrate-from-portal.js; this is
 * the work, given its clients, so tests run it on fake data.
 *
 * What is copied, in this order (a row's references are always copied before
 * it, and the SLA and reminder "once" keys before the tickets they guard):
 *
 *   companies and their mail domains, departments, people (all of them, HR's
 *   fields and staff ids kept), their plain User roles and the --as person's
 *   HoldingAdmin role; ticket notifications (unread ones, and every one that
 *   carries a dedupe key, so no SLA alert or reminder goes out twice) and
 *   ticket notification switches; the IT team with its companies, members
 *   (leads and agents), working hours, SLA targets, categories, locations,
 *   holidays and canned replies; the ticket counters; every ticket with its
 *   replies, internal notes, history, SLA clock and pause, rating, feedback
 *   and close reason; attachments (the bytes into this app's storage, their
 *   malware-scan verdict as it was); the ticket and IT-settings audit rows,
 *   marked origin "portal", with their time and actor.
 *
 * Matching: a company by code, a domain by name, a department by company and
 * name, a person by Entra object id and then by email, team settings by their
 * natural key (team code; team + priority; team + English name; date). A
 * match keeps this app's row; for the IT team's settings the portal's values
 * are written over it ("take them from the portal, not the defaults"). A
 * matched person gets HR's fields only when this app has none from HR yet.
 * Everything else keeps the portal's id, ticket numbers and dates included.
 *
 * Every row copied or matched gets a PortalImport row in the same transaction,
 * so a second run, or a run after a crash, copies nothing twice. Nothing here
 * sends mail or raises an alert: rows are written directly, never through
 * lib/notify.js.
 */

import { createHash, randomUUID } from 'node:crypto';

import { TEMPLATES } from '@mg/shared/web/assets/js/notification-text.js';

/** The audit actions that are the helpdesk's (tickets, IT team, IT settings). */
export const AUDIT_PREFIXES = Object.freeze(['ticket.', 'helpdesk.']);

/** Notification templates about tickets (their category is "tickets"). */
export const TICKET_TEMPLATES = Object.freeze(
  Object.entries(TEMPLATES)
    .filter(([, category]) => category === 'tickets')
    .map(([key]) => key)
);

/** AuditLog's columns in the portal (it has no `origin`). */
const AUDIT_SELECT = Object.freeze({
  id: true,
  at: true,
  actorId: true,
  companyId: true,
  action: true,
  entity: true,
  entityId: true,
  before: true,
  after: true,
  ip: true,
  createdAt: true,
  updatedAt: true,
});

/** The order tables are copied and reported in. */
export const TABLES = Object.freeze([
  'Company',
  'CompanyDomain',
  'Department',
  'UserProfile',
  'RoleAssignment',
  'Notification',
  'NotificationPreference',
  'SupportTeam',
  'SupportTeamCompany',
  'SupportTeamMember',
  'BusinessCalendar',
  'SlaPolicy',
  'TicketCategory',
  'TicketLocation',
  'Holiday',
  'CannedReply',
  'TicketSequence',
  'Ticket',
  'TicketComment',
  'FileScan',
  'TicketAttachment',
  'TicketEvent',
  'AuditLog',
]);

/** Prisma delegate and the target column a PortalImport targetId names. */
const MODEL = {
  Company: ['company', 'id'],
  CompanyDomain: ['companyDomain', 'id'],
  Department: ['department', 'id'],
  UserProfile: ['userProfile', 'id'],
  RoleAssignment: ['roleAssignment', 'id'],
  Notification: ['notification', 'id'],
  NotificationPreference: ['notificationPreference', 'id'],
  SupportTeam: ['supportTeam', 'id'],
  SupportTeamCompany: ['supportTeamCompany', 'id'],
  SupportTeamMember: ['supportTeamMember', 'id'],
  BusinessCalendar: ['businessCalendar', 'id'],
  SlaPolicy: ['slaPolicy', 'id'],
  TicketCategory: ['ticketCategory', 'id'],
  TicketLocation: ['ticketLocation', 'id'],
  Holiday: ['holiday', 'id'],
  CannedReply: ['cannedReply', 'id'],
  TicketSequence: ['ticketSequence', 'id'],
  Ticket: ['ticket', 'id'],
  TicketComment: ['ticketComment', 'id'],
  FileScan: ['fileScan', 'storageKey'],
  TicketAttachment: ['ticketAttachment', 'id'],
  TicketEvent: ['ticketEvent', 'id'],
  AuditLog: ['auditLog', 'id'],
};

/** SQL Server takes at most 2100 parameters a statement. */
const CHUNK = 1000;

const NUMBER = /^([A-Z0-9]+)-(\d{4})-(\d+)$/;

/** A refusal: the run stops before writing anything, with this message. */
export class MigrationRefused extends Error {}

/** A row that is left out, with the reason the report counts. */
class Skip extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const lower = (value) => String(value ?? '').toLowerCase();

/** IT's links in the portal were "/helpdesk#tickets/<id>"; here every link is "#tickets/<id>". */
export function helpdeskLink(link) {
  return typeof link === 'string' ? link.replace(/^\/helpdesk(?=#)/, '') : link;
}

function rewritePayload(payload) {
  try {
    const value = JSON.parse(payload);
    if (value && typeof value === 'object' && 'link' in value) {
      value.link = helpdeskLink(value.link);
      return JSON.stringify(value);
    }
  } catch {
    // Not JSON: copied as it was.
  }
  return payload;
}

async function inChunks(values, read) {
  const out = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    out.push(...(await read(values.slice(i, i + CHUNK))));
  }
  return out;
}

/* ------------------------------------------------------------ reading */

/**
 * Everything the migration reads from the portal, in one pass. Reads only
 * (the client is wrapped by source.js).
 * @param {object} source  the portal's database, read-only
 */
export async function readPortal(source) {
  const all = (model, args = {}) => source[model].findMany(args);
  const [
    companies,
    domains,
    departments,
    users,
    roles,
    teams,
    teamCompanies,
    members,
    calendars,
    policies,
    categories,
    locations,
    holidays,
    replies,
    sequences,
    tickets,
    comments,
    attachments,
    events,
    notifications,
    preferences,
    audit,
  ] = await Promise.all([
    all('company'),
    all('companyDomain'),
    all('department'),
    all('userProfile'),
    all('roleAssignment'),
    all('supportTeam'),
    all('supportTeamCompany'),
    all('supportTeamMember'),
    all('businessCalendar'),
    all('slaPolicy'),
    all('ticketCategory'),
    all('ticketLocation'),
    all('holiday'),
    all('cannedReply'),
    all('ticketSequence'),
    all('ticket'),
    all('ticketComment'),
    all('ticketAttachment'),
    all('ticketEvent'),
    all('notification', { where: { templateKey: { in: [...TICKET_TEMPLATES] } } }),
    all('notificationPreference', { where: { category: 'tickets' } }),
    all('auditLog', {
      where: { OR: AUDIT_PREFIXES.map((prefix) => ({ action: { startsWith: prefix } })) },
      select: AUDIT_SELECT,
    }),
  ]);
  const scans = await inChunks(
    attachments.map((a) => a.storageKey),
    (keys) => all('fileScan', { where: { storageKey: { in: keys } } })
  );
  return {
    Company: companies,
    CompanyDomain: domains,
    Department: departments,
    UserProfile: users,
    RoleAssignment: roles,
    // Unread ones for the bell; every keyed one so alerts and reminders stay "once".
    Notification: notifications.filter((n) => n.readAt == null || n.dedupeKey != null),
    NotificationPreference: preferences,
    SupportTeam: teams,
    SupportTeamCompany: teamCompanies,
    SupportTeamMember: members,
    BusinessCalendar: calendars,
    SlaPolicy: policies,
    TicketCategory: categories,
    TicketLocation: locations,
    Holiday: holidays,
    CannedReply: replies,
    TicketSequence: sequences,
    Ticket: tickets,
    TicketComment: comments,
    FileScan: scans,
    TicketAttachment: attachments,
    TicketEvent: events,
    AuditLog: audit,
  };
}

/** What a dry run reads when mghelpdesk_live does not exist yet: nothing. */
export function emptyTarget() {
  const empty = { findMany: async () => [], count: async () => 0 };
  return new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : empty) });
}

/* ------------------------------------------------------------ the run */

/**
 * @param {object} options
 * @param {object} options.source  the portal's database, read-only (source.js)
 * @param {object} options.target  this app's database (a PrismaClient)
 * @param {{ get: Function }} options.sourceFiles  the portal's stored files
 * @param {{ get: Function, put: Function }} options.targetFiles  this app's,
 *   unwrapped: the scan verdict is copied, not made again
 * @param {string} options.asEmail  an active holding-wide HoldingAdmin of the portal
 * @param {boolean} [options.dryRun]  plan and count, write nothing
 * @param {boolean} [options.forceMerge]  allow tickets here that did not come from the portal
 * @param {() => Date} [options.now]
 * @returns {Promise<object>} the report (counts only; no names or emails)
 *
 * A real run also refuses while the portal's helpdesk jobs are still running
 * (its SLA watch or confirmation reminders took their lease lately: set
 * PORTAL_HELPDESK_JOBS=off and restart the portal), or while a helpdesk
 * server works on this database (any of its jobs did): either would send
 * alerts from half-copied data. A dry run only warns.
 */
export async function migrateFromPortal({
  source,
  target,
  sourceFiles,
  targetFiles,
  asEmail,
  dryRun = false,
  forceMerge = false,
  now = () => new Date(),
}) {
  const runId = randomUUID();
  const data = await readPortal(source);

  /* ---- what this app already holds */
  const imported = new Map(TABLES.map((t) => [t, new Map()]));
  for (const row of await target.portalImport.findMany({})) {
    imported.get(row.entity)?.set(row.sourceId, row.targetId);
  }
  const have = async (model, select) => target[model].findMany({ select });
  const [
    tCompanies,
    tDomains,
    tDepartments,
    tUsers,
    tRoles,
    tTeams,
    tTeamCompanies,
    tMembers,
    tCalendars,
    tPolicies,
    tCategories,
    tLocations,
    tHolidays,
    tReplies,
    tSequences,
    tTickets,
    tPreferences,
  ] = await Promise.all([
    have('company', { id: true, code: true }),
    have('companyDomain', { id: true, domain: true, companyId: true }),
    have('department', { id: true, companyId: true, nameEn: true, nameAr: true }),
    have('userProfile', { id: true, entraObjectId: true, email: true, hrImportedAt: true }),
    have('roleAssignment', { id: true, userId: true, role: true, scopeCompanyId: true }),
    have('supportTeam', { id: true, code: true }),
    have('supportTeamCompany', { id: true, teamId: true, companyId: true }),
    have('supportTeamMember', { id: true, teamId: true, userId: true }),
    have('businessCalendar', { id: true, teamId: true }),
    have('slaPolicy', { id: true, teamId: true, priority: true }),
    have('ticketCategory', { id: true, teamId: true, nameEn: true }),
    have('ticketLocation', { id: true, nameEn: true }),
    have('holiday', { id: true, date: true }),
    have('cannedReply', { id: true, teamId: true, titleEn: true }),
    have('ticketSequence', { id: true, prefix: true, year: true, last: true }),
    have('ticket', { id: true, number: true }),
    have('notificationPreference', { id: true, userId: true, category: true, channel: true }),
  ]);
  // Rows that keep the portal's id: only "is it here already" matters.
  const idsOf = async (model, ids) =>
    new Set(
      (
        await inChunks(ids, (chunk) =>
          target[model].findMany({ where: { id: { in: chunk } }, select: { id: true } })
        )
      ).map((r) => r.id)
    );
  const fresh = (table) =>
    data[table].map((r) => r.id).filter((id) => !imported.get(table).has(id));
  const [tComments, tAttachments, tEvents, tNotifications, tAudit, tScans] = await Promise.all([
    idsOf('ticketComment', fresh('TicketComment')),
    idsOf('ticketAttachment', fresh('TicketAttachment')),
    idsOf('ticketEvent', fresh('TicketEvent')),
    idsOf('notification', fresh('Notification')),
    idsOf('auditLog', fresh('AuditLog')),
    inChunks(
      data.FileScan.map((s) => s.storageKey),
      (keys) =>
        target.fileScan.findMany({
          where: { storageKey: { in: keys } },
          select: { storageKey: true },
        })
    ).then((rows) => new Set(rows.map((r) => r.storageKey))),
  ]);

  /* ---- refusals, before anything is written */
  const asUser = data.UserProfile.find((u) => lower(u.email) === lower(asEmail));
  const isHoldingAdmin = (rows, userId) =>
    rows.some(
      (r) => r.userId === userId && r.role === 'HoldingAdmin' && r.scopeCompanyId == null
    );
  if (!asUser?.isActive || !isHoldingAdmin(data.RoleAssignment, asUser.id)) {
    throw new MigrationRefused(
      '--as must be an active holding-wide HoldingAdmin of the portal. Nothing was copied.'
    );
  }
  const asTarget = tUsers.find(
    (u) => u.entraObjectId === asUser.entraObjectId || lower(u.email) === lower(asUser.email)
  );
  const targetAdmins = tRoles.filter(
    (r) => r.role === 'HoldingAdmin' && r.scopeCompanyId == null
  );
  if (targetAdmins.length && !(asTarget && isHoldingAdmin(tRoles, asTarget.id))) {
    throw new MigrationRefused(
      'The helpdesk already has administrators and --as is not one of them. Nothing was copied.'
    );
  }

  const busy = (rows, names, minutes) =>
    rows.filter(
      (r) =>
        (!names || names.includes(r.name)) &&
        r.lastStartedAt &&
        now() - new Date(r.lastStartedAt) < minutes * 60_000
    ).length > 0;
  const [portalLeases, ownLeases] = await Promise.all([
    source.jobLease.findMany({}),
    target.jobLease.findMany({}),
  ]);
  const jobsWarnings = [];
  // The SLA watch runs every five minutes while the portal's helpdesk jobs are on.
  if (busy(portalLeases, ['sla-watch', 'ticket-confirmation-reminders'], 15)) {
    jobsWarnings.push(
      "The portal's helpdesk jobs ran lately: set PORTAL_HELPDESK_JOBS=off in apps/portal/.env, restart the portal, and run again in 15 minutes."
    );
  }
  if (busy(ownLeases, null, 15)) {
    jobsWarnings.push(
      'A helpdesk server is working on this database (its jobs ran lately): stop it, then run again in 15 minutes.'
    );
  }
  if (jobsWarnings.length && !dryRun) {
    throw new MigrationRefused(`${jobsWarnings.join(' ')} Nothing was copied.`);
  }

  const fromPortal = new Set(imported.get('Ticket').values());
  const foreign = tTickets.filter((t) => !fromPortal.has(t.id));
  if (foreign.length && !forceMerge) {
    throw new MigrationRefused(
      `The helpdesk already has ${foreign.length} ticket(s) that did not come from the portal. ` +
        'Run with --force-merge to add the portal’s tickets beside them. Nothing was copied.'
    );
  }
  const foreignNumbers = new Set(foreign.map((t) => t.number));
  const clashes = data.Ticket.filter((t) => foreignNumbers.has(t.number)).length;
  if (clashes) {
    throw new MigrationRefused(
      `${clashes} portal ticket number(s) are already used here by other tickets; ` +
        'numbers must stay as they are. Nothing was copied.'
    );
  }

  const codesHere = new Set(tCompanies.map((c) => c.code));
  const domainsHere = new Set(tDomains.map((d) => lower(d.domain)));
  const taken = data.Company.filter(
    (c) => !codesHere.has(c.code) && domainsHere.has(lower(c.domain))
  ).length;
  if (taken) {
    throw new MigrationRefused(
      `${taken} portal company mail domain(s) belong to another company here. Nothing was copied.`
    );
  }

  /* ---- the report */
  const companyCode = new Map(data.Company.map((c) => [c.id, c.code]));
  const ticketCompany = new Map(data.Ticket.map((t) => [t.id, t.companyId]));
  const userCompany = new Map(data.UserProfile.map((u) => [u.id, u.companyId]));
  const codeOf = (companyId) => (companyId ? (companyCode.get(companyId) ?? '?') : 'group');
  const report = {
    runId,
    at: now().toISOString(),
    dryRun,
    forceMerge,
    tables: {},
    sequences: [],
    attachments: { files: 0, bytes: 0, infected: 0, missingInSource: 0 },
    warnings: [...jobsWarnings],
  };
  const tally = (table) =>
    (report.tables[table] ??= {
      source: 0,
      created: 0,
      matched: 0,
      already: 0,
      skipped: 0,
      reasons: {},
      byCompany: {},
    });

  /** The id a portal row has here, or a Skip naming what was missing. */
  const need = (table, id) => {
    const mapped = imported.get(table).get(id);
    if (mapped === undefined) throw new Skip(`no_${table}`);
    return mapped;
  };
  const maybe = (table, id) => (id == null ? null : need(table, id));

  /**
   * Copies one table. `spec`:
   *   company(row)        the company code it is counted under (optional)
   *   key(row)            the PortalImport sourceId (default row.id)
   *   data(row)           the row as it is created here (throws Skip)
   *   match(row, data)    the id of a row already here, or null
   *   update(row, data)   values written over a matched row (optional)
   *   before(row, data)   work outside the transaction, e.g. copying bytes
   *   created(row, data)  bookkeeping once written (or planned, in a dry run)
   */
  async function copy(table, rows, spec) {
    const t = tally(table);
    const [model, keyField] = MODEL[table];
    for (const row of rows) {
      const sourceId = spec.key?.(row) ?? row.id;
      t.source += 1;
      const company = spec.company?.(row);
      if (company) t.byCompany[company] = (t.byCompany[company] ?? 0) + 1;
      if (imported.get(table).has(sourceId)) {
        t.already += 1;
        continue;
      }
      let values;
      try {
        values = spec.data(row);
      } catch (err) {
        if (!(err instanceof Skip)) throw err;
        t.skipped += 1;
        t.reasons[err.reason] = (t.reasons[err.reason] ?? 0) + 1;
        continue;
      }
      const existing = spec.match?.(row, values) ?? null;
      const targetId = existing ?? values[keyField];
      if (existing) t.matched += 1;
      else t.created += 1;

      if (!dryRun) {
        await spec.before?.(row, values, existing);
        const changes = [];
        const patch = existing ? spec.update?.(row, values) : null;
        if (!existing) changes.push(target[model].create({ data: values }));
        else if (patch && Object.keys(patch).length) {
          changes.push(target[model].update({ where: { [keyField]: existing }, data: patch }));
        }
        changes.push(
          target.portalImport.create({ data: { entity: table, sourceId, targetId, runId } })
        );
        await target.$transaction(changes);
      }
      imported.get(table).set(sourceId, targetId);
      if (!existing) spec.created?.(row, values);
    }
  }

  const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));

  /* ---- companies, domains, departments */
  const companyByCode = new Map(tCompanies.map((c) => [c.code, c.id]));
  const domainOwner = new Map(tDomains.map((d) => [lower(d.domain), d]));
  await copy('Company', data.Company, {
    company: (c) => c.code,
    // An uploaded logo is a portal file; the static ones are served by both apps.
    data: (c) => ({ ...c, logoKey: null, logoUrl: c.logoKey ? null : c.logoUrl }),
    match: (c) => companyByCode.get(c.code) ?? null,
  });
  await copy('CompanyDomain', data.CompanyDomain, {
    company: (d) => codeOf(d.companyId),
    data: (d) => ({ ...d, domain: lower(d.domain), companyId: need('Company', d.companyId) }),
    match: (d, values) => {
      const owner = domainOwner.get(values.domain);
      if (owner && owner.companyId !== values.companyId) {
        report.warnings.push(`domain_owned_elsewhere:${values.domain}`);
      }
      return owner?.id ?? null;
    },
  });
  await copy('Department', data.Department, {
    company: (d) => codeOf(d.companyId),
    data: (d) => ({ ...d, companyId: need('Company', d.companyId) }),
    match: (_d, v) =>
      tDepartments.find(
        (x) => x.companyId === v.companyId && (x.nameEn === v.nameEn || x.nameAr === v.nameAr)
      )?.id ?? null,
  });

  /* ---- people */
  const byOid = new Map(tUsers.map((u) => [u.entraObjectId, u]));
  const byEmail = new Map(tUsers.map((u) => [lower(u.email), u]));
  const HR_LISTED = ['companyId', 'departmentId', 'jobTitle', 'officeLocation'];
  await copy('UserProfile', data.UserProfile, {
    company: (u) => codeOf(u.companyId),
    data: (u) => ({
      ...u,
      email: lower(u.email),
      companyId: need('Company', u.companyId),
      departmentId: maybe('Department', u.departmentId),
      // Managers once everyone is here (below).
      managerId: null,
    }),
    match: (u) => (byOid.get(u.entraObjectId) ?? byEmail.get(lower(u.email)))?.id ?? null,
    // HR's fields, when HR has not been imported here for this person yet.
    update: (u, values) => {
      const here = byOid.get(u.entraObjectId) ?? byEmail.get(lower(u.email));
      if (here?.hrImportedAt || !u.hrImportedAt) return {};
      const listed = String(u.hrFields ?? '')
        .split(',')
        .filter((f) => HR_LISTED.includes(f));
      return {
        ...pick(u, ['staffId', 'employmentCategory', 'hireDate', 'hrFields', 'hrImportedAt']),
        ...pick(values, listed),
      };
    },
  });
  if (!dryRun) {
    for (const u of data.UserProfile) {
      if (!u.managerId) continue;
      const id = imported.get('UserProfile').get(u.id);
      const managerId = imported.get('UserProfile').get(u.managerId);
      if (!id || !managerId) continue;
      await target.userProfile.updateMany({
        where: { id, managerId: null },
        data: { managerId },
      });
    }
  }

  /* ---- roles: everyone's plain User role; the --as person's HoldingAdmin */
  const roleKey = (r) => `${r.userId}|${r.role}|${r.scopeCompanyId ?? ''}`;
  const roleHere = new Map(tRoles.map((r) => [roleKey(r), r.id]));
  const otherAdmin = { count: 0 };
  await copy(
    'RoleAssignment',
    data.RoleAssignment.filter((r) => {
      const keep =
        r.role === 'User' ||
        (r.userId === asUser.id && r.role === 'HoldingAdmin' && r.scopeCompanyId == null);
      if (!keep) otherAdmin.count += 1;
      return keep;
    }),
    {
      company: (r) => codeOf(r.scopeCompanyId ?? userCompany.get(r.userId)),
      data: (r) => ({
        ...r,
        userId: need('UserProfile', r.userId),
        scopeCompanyId: maybe('Company', r.scopeCompanyId),
      }),
      match: (_r, v) => roleHere.get(roleKey(v)) ?? null,
    }
  );
  if (otherAdmin.count) {
    report.warnings.push(
      `admin_roles_not_copied:${otherAdmin.count} (the helpdesk's administrators are set in its own Administration)`
    );
  }

  /* ---- notifications before tickets: their dedupe keys keep alerts "once" */
  await copy('Notification', data.Notification, {
    company: (n) => codeOf(n.companyId),
    data: (n) => ({
      ...n,
      userId: need('UserProfile', n.userId),
      companyId: need('Company', n.companyId),
      payload: rewritePayload(n.payload),
    }),
    match: (n) => (tNotifications.has(n.id) ? n.id : null),
  });
  const prefKey = (p) => `${p.userId}|${p.category}|${p.channel}`;
  const prefHere = new Map(tPreferences.map((p) => [prefKey(p), p.id]));
  await copy('NotificationPreference', data.NotificationPreference, {
    company: (p) => codeOf(p.companyId),
    data: (p) => ({
      ...p,
      userId: need('UserProfile', p.userId),
      companyId: need('Company', p.companyId),
    }),
    match: (_p, v) => prefHere.get(prefKey(v)) ?? null,
  });

  /* ---- the IT team and its settings: the portal's values win */
  await copy('SupportTeam', data.SupportTeam, {
    data: (t) => ({ ...t }),
    match: (t) => tTeams.find((x) => x.code === t.code)?.id ?? null,
    update: (t) => pick(t, ['nameEn', 'nameAr', 'servesAllCompanies', 'isActive']),
  });
  const team = (id) => need('SupportTeam', id);
  await copy('SupportTeamCompany', data.SupportTeamCompany, {
    company: (s) => codeOf(s.companyId),
    data: (s) => ({ ...s, teamId: team(s.teamId), companyId: need('Company', s.companyId) }),
    match: (_s, v) =>
      tTeamCompanies.find((x) => x.teamId === v.teamId && x.companyId === v.companyId)?.id ??
      null,
  });
  await copy('SupportTeamMember', data.SupportTeamMember, {
    company: (m) => codeOf(userCompany.get(m.userId)),
    data: (m) => ({ ...m, teamId: team(m.teamId), userId: need('UserProfile', m.userId) }),
    match: (_m, v) =>
      tMembers.find((x) => x.teamId === v.teamId && x.userId === v.userId)?.id ?? null,
    update: (m) => pick(m, ['role']),
  });
  await copy('BusinessCalendar', data.BusinessCalendar, {
    data: (c) => ({ ...c, teamId: team(c.teamId) }),
    match: (_c, v) => tCalendars.find((x) => x.teamId === v.teamId)?.id ?? null,
    update: (c) => pick(c, ['timeZone', 'workingDays', 'startMin', 'endMin']),
  });
  await copy('SlaPolicy', data.SlaPolicy, {
    data: (p) => ({ ...p, teamId: team(p.teamId) }),
    match: (_p, v) =>
      tPolicies.find((x) => x.teamId === v.teamId && x.priority === v.priority)?.id ?? null,
    update: (p) => pick(p, ['firstResponseMinutes', 'resolveMinutes']),
  });
  await copy('TicketCategory', data.TicketCategory, {
    data: (c) => ({ ...c, teamId: team(c.teamId) }),
    match: (_c, v) =>
      tCategories.find((x) => x.teamId === v.teamId && x.nameEn === v.nameEn)?.id ?? null,
    update: (c) => pick(c, ['nameAr', 'defaultPriority', 'sortOrder', 'isActive']),
  });
  await copy('TicketLocation', data.TicketLocation, {
    data: (l) => ({ ...l }),
    match: (l) => tLocations.find((x) => x.nameEn === l.nameEn)?.id ?? null,
    update: (l) => pick(l, ['nameAr', 'sortOrder', 'isActive']),
  });
  await copy('Holiday', data.Holiday, {
    data: (h) => ({ ...h }),
    match: (h) => tHolidays.find((x) => x.date === h.date)?.id ?? null,
    update: (h) => pick(h, ['nameEn', 'nameAr']),
  });
  await copy('CannedReply', data.CannedReply, {
    data: (r) => ({ ...r, teamId: team(r.teamId) }),
    match: (_r, v) =>
      tReplies.find((x) => x.teamId === v.teamId && x.titleEn === v.titleEn)?.id ?? null,
    update: (r) => pick(r, ['titleAr', 'bodyEn', 'bodyAr', 'sortOrder', 'isActive']),
  });
  const teamsHere = tTeams.length;
  const settingsLeftHere = teamsHere
    ? tCategories.filter((c) => !data.TicketCategory.some((p) => p.nameEn === c.nameEn)).length
    : 0;
  if (settingsLeftHere) {
    report.warnings.push(
      `categories_here_not_in_portal:${settingsLeftHere} (left as they were; deactivate them in IT settings if unwanted)`
    );
  }

  /* ---- counters, then tickets and everything on them */
  const seqKey = (s) => `${s.prefix}|${s.year}`;
  const seqHere = new Map(tSequences.map((s) => [seqKey(s), s]));
  await copy('TicketSequence', data.TicketSequence, {
    data: (s) => ({ ...s }),
    match: (s) => seqHere.get(seqKey(s))?.id ?? null,
    update: (s) => ({ last: Math.max(s.last, seqHere.get(seqKey(s))?.last ?? 0) }),
    created: (s) => seqHere.set(seqKey(s), { ...s }),
  });

  const ticketCode = (row) => codeOf(ticketCompany.get(row.ticketId));
  await copy('Ticket', data.Ticket, {
    company: (t) => codeOf(t.companyId),
    data: (t) => ({
      ...t,
      companyId: need('Company', t.companyId),
      teamId: need('SupportTeam', t.teamId),
      categoryId: need('TicketCategory', t.categoryId),
      locationId: maybe('TicketLocation', t.locationId),
      requesterId: need('UserProfile', t.requesterId),
      createdById: need('UserProfile', t.createdById),
      assigneeId: maybe('UserProfile', t.assigneeId),
    }),
    // Numbers were checked above: a ticket here with the same number came from the portal.
    match: () => null,
  });
  await copy('TicketComment', data.TicketComment, {
    company: ticketCode,
    data: (c) => ({
      ...c,
      ticketId: need('Ticket', c.ticketId),
      authorId: need('UserProfile', c.authorId),
    }),
    match: (c) => (tComments.has(c.id) ? c.id : null),
  });
  const scanState = new Map(data.FileScan.map((s) => [s.storageKey, s.state]));
  await copy('FileScan', data.FileScan, {
    key: (s) => s.storageKey,
    data: (s) => ({
      ...s,
      uploadedById: s.uploadedById
        ? (imported.get('UserProfile').get(s.uploadedById) ?? null)
        : null,
      link: helpdeskLink(s.link),
    }),
    match: (s) => (tScans.has(s.storageKey) ? s.storageKey : null),
  });
  await copy('TicketAttachment', data.TicketAttachment, {
    company: ticketCode,
    data: (a) => ({
      ...a,
      ticketId: need('Ticket', a.ticketId),
      commentId: maybe('TicketComment', a.commentId),
      uploadedById: need('UserProfile', a.uploadedById),
    }),
    match: (a) => (tAttachments.has(a.id) ? a.id : null),
    // The bytes first: a row whose file is not here yet would only be refused
    // (no verdict is served), never served wrong.
    before: async (a) => {
      if (scanState.get(a.storageKey) === 'infected') return;
      const bytes = await sourceFiles.get(a.storageKey);
      if (!bytes) return;
      await targetFiles.put(a.storageKey, bytes);
    },
  });
  for (const a of data.TicketAttachment) {
    if (scanState.get(a.storageKey) === 'infected') {
      report.attachments.infected += 1;
      continue;
    }
    const bytes = await sourceFiles.get(a.storageKey);
    if (!bytes) {
      report.attachments.missingInSource += 1;
      continue;
    }
    report.attachments.files += 1;
    report.attachments.bytes += bytes.length;
  }
  await copy('TicketEvent', data.TicketEvent, {
    company: ticketCode,
    data: (e) => ({
      ...e,
      ticketId: need('Ticket', e.ticketId),
      actorId: maybe('UserProfile', e.actorId),
    }),
    match: (e) => (tEvents.has(e.id) ? e.id : null),
  });

  /* ---- the yearly counters continue after the highest number */
  const highest = new Map();
  for (const number of [
    ...tTickets.map((t) => t.number),
    ...data.Ticket.map((t) => t.number),
  ]) {
    const m = NUMBER.exec(number);
    if (!m) continue;
    const key = `${m[1]}|${Number(m[2])}`;
    highest.set(key, Math.max(highest.get(key) ?? 0, Number(m[3])));
  }
  for (const [key, max] of highest) {
    const [prefix, yearText] = key.split('|');
    const year = Number(yearText);
    const row = seqHere.get(key);
    const last = Math.max(row?.last ?? 0, max);
    if (!dryRun) {
      if (!row) {
        await target.ticketSequence.create({ data: { prefix, year, last } });
      } else if (row.last < last) {
        await target.ticketSequence.updateMany({
          where: { prefix, year, last: { lt: last } },
          data: { last },
        });
      }
    }
    report.sequences.push({ prefix, year, last });
  }

  /* ---- the audit trail, marked as the portal's */
  await copy('AuditLog', data.AuditLog, {
    company: (a) => codeOf(a.companyId),
    data: (a) => ({
      ...a,
      // A person or company not copied would be odd, but never a reason to lose the row.
      actorId: a.actorId ? (imported.get('UserProfile').get(a.actorId) ?? null) : null,
      companyId: a.companyId ? (imported.get('Company').get(a.companyId) ?? null) : null,
      origin: 'portal',
    }),
    match: (a) => (tAudit.has(a.id) ? a.id : null),
  });

  /* ---- the run itself, audited under the --as person */
  const copied = Object.values(report.tables).reduce((n, t) => n + t.created + t.matched, 0);
  report.copied = copied;
  if (!dryRun) {
    await target.auditLog.create({
      data: {
        actorId: imported.get('UserProfile').get(asUser.id) ?? null,
        companyId: null,
        action: 'helpdesk.migrate_from_portal',
        entity: 'PortalImport',
        entityId: runId,
        before: null,
        after: JSON.stringify({
          copied,
          forceMerge,
          tables: Object.fromEntries(
            Object.entries(report.tables).map(([k, t]) => [
              k,
              {
                created: t.created,
                matched: t.matched,
                already: t.already,
                skipped: t.skipped,
              },
            ])
          ),
        }),
        ip: null,
      },
    });
  }
  return report;
}

/* ------------------------------------------------------------ checking */

/**
 * After a real run: per table the counts match (every portal row the run took
 * has its row here), every ticket number is here on the same ticket, and
 * every attachment's bytes are here with the same size and hash. Reads only.
 *
 * @returns {Promise<{ ok: boolean, problems: string[], checked: object }>}
 */
export async function verifyMigration({ source, target, sourceFiles, targetFiles, report }) {
  const data = await readPortal(source);
  const problems = [];
  const checked = { tables: {}, ticketNumbers: 0, attachmentFiles: 0 };

  const maps = new Map(TABLES.map((t) => [t, new Map()]));
  for (const row of await target.portalImport.findMany({})) {
    maps.get(row.entity)?.set(row.sourceId, row.targetId);
  }

  for (const table of TABLES) {
    const [model, keyField] = MODEL[table];
    // The rows the run took (admin roles but the --as person's are left out on
    // purpose), less those it skipped with a reason.
    const taken = report.tables[table];
    const expected = (taken?.source ?? 0) - (taken?.skipped ?? 0);
    const map = maps.get(table);
    const sourceKeys = data[table].map((r) => (table === 'FileScan' ? r.storageKey : r.id));
    const mapped = sourceKeys.filter((k) => map.has(k));
    const targets = [...new Set(mapped.map((k) => map.get(k)))];
    const found = await inChunks(targets, (chunk) =>
      target[model].findMany({
        where: { [keyField]: { in: chunk } },
        select: { [keyField]: true },
      })
    );
    checked.tables[table] = { portal: data[table].length, expected, here: found.length };
    if (mapped.length !== expected) {
      problems.push(`${table}: ${expected} expected, ${mapped.length} recorded as copied`);
    }
    if (found.length !== targets.length) {
      problems.push(
        `${table}: ${targets.length - found.length} copied row(s) are missing here`
      );
    }
  }

  const numbers = data.Ticket.map((t) => t.number);
  const here = new Map(
    (
      await inChunks(numbers, (chunk) =>
        target.ticket.findMany({
          where: { number: { in: chunk } },
          select: { id: true, number: true },
        })
      )
    ).map((t) => [t.number, t.id])
  );
  for (const t of data.Ticket) {
    if (here.get(t.number) !== maps.get('Ticket').get(t.id)) {
      problems.push(`ticket ${t.number} is missing or not the portal's`);
    }
  }
  checked.ticketNumbers = here.size;

  const scanState = new Map(data.FileScan.map((s) => [s.storageKey, s.state]));
  for (const a of data.TicketAttachment) {
    if (scanState.get(a.storageKey) === 'infected') continue;
    const before = await sourceFiles.get(a.storageKey);
    if (!before) continue; // missing in the portal already: counted in the run's report
    const after = await targetFiles.get(a.storageKey);
    if (!after) problems.push(`attachment ${a.id}: file missing here`);
    else if (after.length !== before.length || sha256(after) !== sha256(before)) {
      problems.push(`attachment ${a.id}: size or hash differs`);
    } else checked.attachmentFiles += 1;
  }

  return { ok: problems.length === 0, problems, checked };
}
