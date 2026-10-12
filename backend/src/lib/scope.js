/**
 * scope.js — company scoping. Every read and write of a business table goes
 * through here (CLAUDE.md rule 1).
 *
 * The scope comes from `req.user`, which the session middleware builds from
 * UserProfile and its RoleAssignments:
 *
 *   { id, companyId, roles: [{ role, scopeCompanyId }], scopes }
 *
 * (`scopes` is scopesOf(user): the same answers worked out once, for callers
 * that only need to look) and never from anything the client sent. A companyId in a path, query or
 * body is only a request; pass it through resolveCompanyId or
 * assertCompanyAccess before using it.
 *
 * Reads:   prisma.thing.findMany({ where: scopeWhere(req, { status: 'open' }) })
 * One row: assertRecordAccess(req, await prisma.thing.findUnique({ where: { id } }))
 * Writes:  data: { ...body, companyId: resolveCompanyId(req, body.companyId) }
 * Admin:   assertCompanyAdmin(req, companyId)
 *
 * Another company's record answers 404, not 403, so its existence is not
 * disclosed (docs/API.md).
 *
 * One table is deliberately not scoped here: Ticket. A helpdesk ticket is
 * read by its requester and by its support team, whatever their companies
 * (modules/tickets/rules.js, docs/DECISIONS.md D99). Nothing else may follow it.
 */

import { HttpError } from '../middleware/errors.js';
import { ROLES } from './roles.js';

/** The signed-in user, or 401. */
export function requireUser(req) {
  const user = req?.user;
  if (!user?.id || !user.companyId) throw new HttpError(401, 'unauthenticated');
  return user;
}

const rolesOf = (user) => (Array.isArray(user.roles) ? user.roles : []);

/**
 * Does the user hold this role in a form that counts? A HoldingAdmin
 * assignment must be holding-wide and a CompanyAdmin one must name a company.
 * @param {{ roles?: { role: string, scopeCompanyId: string | null }[] }} user
 * @param {string} role
 */
export function hasRole(user, role) {
  return rolesOf(user).some((r) => {
    if (r.role !== role) return false;
    if (role === ROLES.HOLDING_ADMIN) return r.scopeCompanyId == null;
    if (role === ROLES.COMPANY_ADMIN) return Boolean(r.scopeCompanyId);
    return true;
  });
}

/** A HoldingAdmin assignment counts only when it is holding-wide. */
export function isHoldingAdmin(req) {
  return hasRole(requireUser(req), ROLES.HOLDING_ADMIN);
}

/**
 * The companies the user may read: `null` for all of them (HoldingAdmin),
 * otherwise their own company plus any they administer.
 * @returns {string[] | null}
 */
export function companyIdsFor(req) {
  const user = requireUser(req);
  if (isHoldingAdmin(req)) return null;

  const ids = new Set([user.companyId]);
  for (const r of rolesOf(user)) {
    if (r.role === ROLES.COMPANY_ADMIN && r.scopeCompanyId) ids.add(r.scopeCompanyId);
  }
  return [...ids];
}

/** The companies the user administers: `null` for all, possibly empty. */
export function adminCompanyIdsFor(req) {
  const user = requireUser(req);
  if (isHoldingAdmin(req)) return null;

  return [
    ...new Set(
      rolesOf(user)
        .filter((r) => r.role === ROLES.COMPANY_ADMIN && r.scopeCompanyId)
        .map((r) => r.scopeCompanyId)
    ),
  ];
}

/**
 * What a user may reach, worked out once from their role assignments. The
 * session middleware puts this on req.user.scopes.
 * @param {{ id: string, companyId: string, roles: object[] }} user
 * @returns {{ holdingAdmin: boolean, companyIds: string[] | null, adminCompanyIds: string[] | null }}
 */
export function scopesOf(user) {
  const req = { user };
  return Object.freeze({
    holdingAdmin: isHoldingAdmin(req),
    companyIds: companyIdsFor(req),
    adminCompanyIds: adminCompanyIdsFor(req),
  });
}

/**
 * A Prisma `where` limited to the user's companies.
 *
 * The caller's own conditions are ANDed with the scope rather than merged, so
 * a `companyId` or an `OR` inside them can narrow the result but never widen
 * it. That makes it safe to pass a filter built from validated query input.
 *
 * @param {import('express').Request} req
 * @param {object} [where]  the caller's conditions
 * @param {{ field?: string }} [options]  the scoping column, when it is not
 *   `companyId` (RoleAssignment uses `scopeCompanyId`; Company itself uses `id`)
 */
export function scopeWhere(req, where = {}, { field = 'companyId' } = {}) {
  const ids = companyIdsFor(req);
  if (ids === null) return where;

  const scope = { [field]: ids.length === 1 ? ids[0] : { in: ids } };
  return Object.keys(where).length === 0 ? scope : { AND: [where, scope] };
}

/** May the user read this company's records? */
export function canAccessCompany(req, companyId) {
  if (typeof companyId !== 'string' || companyId === '') return false;
  const ids = companyIdsFor(req);
  return ids === null || ids.includes(companyId);
}

/** May the user administer this company? */
export function canAdminCompany(req, companyId) {
  if (typeof companyId !== 'string' || companyId === '') return false;
  const ids = adminCompanyIdsFor(req);
  return ids === null || ids.includes(companyId);
}

/** Throws 404 unless the user may read this company. */
export function assertCompanyAccess(req, companyId) {
  if (!canAccessCompany(req, companyId)) throw new HttpError(404, 'not_found');
}

/**
 * Throws unless the user administers this company: 404 when the company is
 * outside their scope altogether, 403 when they can see it but not run it.
 */
export function assertCompanyAdmin(req, companyId) {
  assertCompanyAccess(req, companyId);
  if (!canAdminCompany(req, companyId)) throw new HttpError(403, 'forbidden');
}

/** Throws 403 unless the user is a holding-wide admin. */
export function assertHoldingAdmin(req) {
  if (!isHoldingAdmin(req)) throw new HttpError(403, 'forbidden');
}

/**
 * The companyId to write with: the one the client asked for if the user may
 * use it, otherwise (nothing asked) the user's own.
 * @param {import('express').Request} req
 * @param {string | null} [requested]  a companyId from the client, unverified
 */
export function resolveCompanyId(req, requested) {
  const user = requireUser(req);
  if (requested == null) return user.companyId;
  assertCompanyAccess(req, requested);
  return requested;
}

/**
 * Guards a row fetched by id: returns it when it exists and is in scope,
 * otherwise throws 404. A missing row and a foreign row are indistinguishable.
 * @template T
 * @param {import('express').Request} req
 * @param {T | null | undefined} record
 * @param {{ field?: string }} [options]
 * @returns {T}
 */
export function assertRecordAccess(req, record, { field = 'companyId' } = {}) {
  if (!record || !canAccessCompany(req, record[field])) throw new HttpError(404, 'not_found');
  return record;
}
