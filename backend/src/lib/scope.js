/**
 * scope.js — company scoping. Every read and write of a business table goes
 * through here (CLAUDE.md rule 1).
 *
 * The scope comes from `req.user`, which the session middleware builds from
 * UserProfile and its RoleAssignments:
 *
 *   { id, companyId, roles: [{ role, scopeCompanyId }] }
 *
 * and never from anything the client sent. A companyId in a path, query or
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

/** A HoldingAdmin assignment counts only when it is holding-wide. */
export function isHoldingAdmin(req) {
  return rolesOf(requireUser(req)).some(
    (r) => r.role === ROLES.HOLDING_ADMIN && r.scopeCompanyId == null
  );
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
