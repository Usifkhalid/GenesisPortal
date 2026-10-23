/**
 * rules.js — the helpdesk's fixed vocabulary and the small pure rules built on
 * it. No I/O: the service asks, the store fetches.
 *
 * Who may read a ticket is decided here and nowhere else, and it is NOT the
 * company rule of lib/scope.js. A ticket is read by:
 *   - its requester (the person it is for, whoever logged it);
 *   - the members of its support team, for every company that team serves,
 *     whatever company the member belongs to.
 * Nobody else: a HoldingAdmin or CompanyAdmin who is not on the team sees no
 * tickets but their own (D135). This is the one documented exception to
 * CLAUDE.md rule 1 (docs/DECISIONS.md D99). Anyone without access gets 404.
 */

import { normalizeText } from '../../lib/text-search.js';

/** Most urgent first. */
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

export const STATUSES = ['New', 'Open', 'Pending', 'Resolved', 'Closed'];

/**
 * Still somebody's job. Resolved is here: IT has said it is fixed, but the
 * ticket stays open until its requester confirms (D143).
 */
export const ACTIVE_STATUSES = ['New', 'Open', 'Pending', 'Resolved'];

/**
 * The statuses in which the SLA clock runs. Only Pending (waiting on the
 * requester) and Closed stop it; Resolved keeps it running until the
 * requester confirms.
 */
export const RUNNING_STATUSES = ['New', 'Open', 'Resolved'];

/**
 * What an agent may set by hand. A ticket is New only until it is touched, and
 * it is Closed only by its requester's confirmation or by a Lead's
 * "close without confirmation" (D143).
 */
export const SETTABLE_STATUSES = ['Open', 'Pending', 'Resolved'];

/** How a ticket was closed: the requester said it is solved, or a Lead closed it. */
export const CLOSE_MODES = ['confirmed', 'lead'];

export const RATINGS = [1, 2, 3, 4, 5];
export const MAX_FEEDBACK = 1000;
export const MAX_REASON = 1000;
/** While a ticket waits for its requester's confirmation they are reminded this often. */
export const REMINDER_HOURS = 24;

export const SOURCES = ['portal', 'phone', 'walkIn'];

export const MEMBER_ROLES = ['Agent', 'Lead'];

export const SLA_FILTERS = ['on_track', 'at_risk', 'breached'];

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Per comment; the files sent with the description count as one comment. */
export const MAX_ATTACHMENTS = 5;

/** A requester may reopen for this many days after the ticket was resolved. */
export const REOPEN_DAYS = 7;

/** Targets for a team that has no policy row for a priority, in business minutes. */
export const DEFAULT_SLA = {
  P1: { firstResponseMinutes: 60, resolveMinutes: 240 },
  P2: { firstResponseMinutes: 240, resolveMinutes: 480 },
  P3: { firstResponseMinutes: 480, resolveMinutes: 1440 },
  P4: { firstResponseMinutes: 960, resolveMinutes: 2400 },
};

/** "IT-2026-00042". */
export const ticketNumber = (prefix, year, sequence) =>
  `${prefix}-${year}-${String(sequence).padStart(5, '0')}`;

/** A ticket number as typed in a link: "it-2026-42" is not one, "IT-2026-00042" is. */
export const TICKET_NUMBER = /^[A-Za-z]{1,10}-\d{4}-\d{5}$/;

/** Does this team take tickets from this company? */
export function serves(team, servedCompanyIds, companyId) {
  if (!team?.isActive) return false;
  return team.servesAllCompanies || servedCompanyIds.includes(companyId);
}

/**
 * The role a viewer acts in on one ticket: 'Lead', 'Agent', or null when they
 * are not staff for it.
 *
 * @param {{ memberships: { teamId: string, role: string, companyIds: string[] | null }[] }} viewer
 * @param {{ teamId: string, companyId: string }} ticket
 */
export function staffRoleOn(viewer, ticket) {
  const member = viewer.memberships.find(
    (m) =>
      m.teamId === ticket.teamId &&
      (m.companyIds === null || m.companyIds.includes(ticket.companyId))
  );
  return member?.role ?? null;
}

/** A Lead's powers: assigning, and working any ticket of the team. */
export const isLead = (role) => role === 'Lead';

const words = (text) =>
  normalizeText(text)
    .split(/[\s/,]+/)
    .filter(Boolean)
    .sort()
    .join(' ');

/**
 * The location a person's ticket starts at: the one whose name is their
 * directory office ("Cairo HQ" finds "HQ Cairo"), or null when none matches.
 * @param {string | null | undefined} officeLocation
 * @param {{ id: string, nameEn: string, nameAr: string, isActive: boolean }[]} locations
 */
export function matchLocation(officeLocation, locations) {
  const wanted = words(officeLocation ?? '');
  if (!wanted) return null;
  const found = locations.find(
    (l) => l.isActive && (words(l.nameEn) === wanted || words(l.nameAr) === wanted)
  );
  return found?.id ?? null;
}

/** A file name safe to keep and to send back in a header. */
export function cleanFileName(name) {
  const base = String(name ?? '')
    .normalize('NFC')
    .split(/[\\/]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .trim();
  return base.slice(-200);
}
