/**
 * auth.js — who is asking.
 *
 * loadUser turns the session's user id into req.user, read fresh from
 * UserProfile and RoleAssignment on every request, so a role that is revoked
 * or a person who is deactivated loses access at once rather than when their
 * session runs out.
 *
 *   req.user = { id, companyId, roles: [{ role, scopeCompanyId }], scopes }
 *
 * is everything lib/scope.js needs. The fuller record (names, company
 * branding) is on req.account for GET /api/me.
 */

import { roleSchema } from '../lib/roles.js';
import { hasRole, requireUser, scopesOf } from '../lib/scope.js';
import { destroySession, sessionCookie } from '../lib/session.js';
import { HttpError } from './errors.js';

/** What a person may do, as one string: it changes when their roles or company do. */
export function privilegeKey(identity) {
  const roles = identity.roles.map((r) => `${r.role}@${r.scopeCompanyId ?? '*'}`).sort();
  return `${identity.companyId}|${roles.join(',')}`;
}

/**
 * @param {{ getSessionUser: (id: string) => Promise<object | null> }} repo
 * @param {{ NODE_ENV: string }} [config]  to clear the cookie it was set with
 */
export function loadUser(repo, config = { NODE_ENV: 'development' }) {
  const cookie = sessionCookie(config);
  return async (req, res, next) => {
    const userId = req.session?.userId;
    if (!userId) return next();

    const account = await repo.getSessionUser(userId);
    if (!account?.isActive || !account.company?.isActive) {
      // Removed or deactivated since they signed in.
      await destroySession(req);
      return next();
    }

    const identity = {
      id: account.id,
      companyId: account.companyId,
      // A role name this code does not know grants nothing.
      roles: account.roles
        .filter((r) => roleSchema.safeParse(r.role).success)
        .map((r) => ({ role: r.role, scopeCompanyId: r.scopeCompanyId ?? null })),
    };

    // A change of privilege ends the session (OWASP: renew the session id on
    // any privilege change). The new roles already apply on this request
    // because they are read fresh; what must not survive is the old id. The
    // person signs in again, which with Entra is one redirect.
    const key = privilegeKey(identity);
    if (req.session.privilegeKey === undefined) {
      req.session.privilegeKey = key;
    } else if (req.session.privilegeKey !== key) {
      await destroySession(req);
      res.clearCookie(cookie.name, cookie.options);
      req.log?.info({ userId: account.id }, 'session ended: roles changed');
      return next();
    }

    req.user = Object.freeze({ ...identity, scopes: scopesOf(identity) });
    req.account = account;
    next();
  };
}

/** 401 unless someone is signed in. */
export function requireAuth(req, res, next) {
  requireUser(req);
  next();
}

/**
 * 403 unless the user holds at least one of the roles. This is the coarse
 * gate; which company an admin may act on is still lib/scope.js's question
 * (assertCompanyAdmin), asked inside the route.
 *
 *   router.post('/', requireRole(ROLES.HOLDING_ADMIN, ROLES.COMPANY_ADMIN), handler)
 *
 * @param {...string} roles
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    const user = requireUser(req);
    if (!roles.some((role) => hasRole(user, role))) throw new HttpError(403, 'forbidden');
    next();
  };
}
