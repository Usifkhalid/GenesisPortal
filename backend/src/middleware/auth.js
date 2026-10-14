/**
 * auth.js — who is asking.
 *
 * loadUser turns the session's user id into req.user, read fresh from
 * UserProfile and RoleAssignment on every request, so a role that is revoked
 * or a person who is deactivated loses access at once rather than when their
 * session runs out.
 *
 *   req.user = { id, companyId, roles: [{ role, scopeCompanyId }], it, scopes }
 *
 * is everything lib/scope.js needs. `it` is 'Lead', 'Agent' or null: the
 * person's place on an active support team. IT team members work in the
 * IT Helpdesk (/helpdesk) and nowhere else (docs/DECISIONS.md D135):
 * `helpdeskOnly` turns them away from every other API, and `requireIt` turns
 * everyone else away from the IT side. The fuller record (names, company
 * branding) is on req.account for GET /api/me.
 */

import { roleSchema } from '../lib/roles.js';
import { hasRole, requireUser, scopesOf } from '../lib/scope.js';
import { destroySession, sessionCookie } from '../lib/session.js';
import { HttpError } from './errors.js';

/**
 * What a person may do, as one string: it changes when their roles, their
 * company or their place on the IT team do. Joining or leaving the IT team
 * moves a person between the portal and the Helpdesk, so it ends the session
 * like any other change of privilege.
 */
export function privilegeKey(identity) {
  const roles = identity.roles.map((r) => `${r.role}@${r.scopeCompanyId ?? '*'}`).sort();
  return `${identity.companyId}|${roles.join(',')}|it:${identity.it ?? '-'}`;
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
      it: account.itRole ?? null,
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

/**
 * The API an IT team member may call: about themselves, their notifications,
 * tickets (their own and the team's, which the ticket service decides) and
 * the Helpdesk's own routes. Everything else is the main portal, which is not
 * theirs (D135). Paths are relative to /api.
 */
const HELPDESK_API = ['/me', '/notifications', '/tickets', '/helpdesk'];
// Development only (never mounted in production): the mocked mail.
const DEV_API = '/dev';

const within = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

/** 403 `helpdesk_only` for an IT team member anywhere outside HELPDESK_API. */
export function helpdeskOnly(req, res, next) {
  if (!req.user?.it) return next();
  if ([...HELPDESK_API, DEV_API].some((prefix) => within(req.path, prefix))) return next();
  throw new HttpError(403, 'helpdesk_only', 'IT team members work in the IT Helpdesk.');
}

/**
 * 403 unless the person is on an IT team (an agent or a lead; with `lead`,
 * only a lead). A HoldingAdmin or CompanyAdmin who is not on the team is
 * refused like anyone else.
 * @param {{ lead?: boolean }} [options]
 */
export function requireIt({ lead = false } = {}) {
  return (req, res, next) => {
    const user = requireUser(req);
    if (!user.it || (lead && user.it !== 'Lead')) throw new HttpError(403, 'forbidden');
    next();
  };
}
