/**
 * service.js — sign-in's logic, apart from HTTP: the mock user list, starting
 * a session, and what GET /api/me says about the person asking.
 */

import { ROLES } from '../../lib/roles.js';
import { regenerateSession } from '../../lib/session.js';
import { workerEnabledFor } from '../../lib/service-worker.js';
import { csrfToken } from '../../middleware/csrf.js';

/** Most powerful first: the one role a person is listed under. */
const ROLE_RANK = [ROLES.HOLDING_ADMIN, ROLES.COMPANY_ADMIN, ROLES.USER];

const rank = (role) => {
  const index = ROLE_RANK.indexOf(role);
  return index === -1 ? ROLE_RANK.length : index;
};

/** The branding a client needs to draw a company: names, accent, logo. */
export function companyView(company) {
  return {
    id: company.id,
    code: company.code,
    nameEn: company.nameEn,
    nameAr: company.nameAr,
    accentColor: company.accentColor,
    logoUrl: company.logoUrl ?? null,
  };
}

/**
 * The seeded users for the mock login screen, grouped by company, each under
 * their highest role; admins first, then by name.
 */
export async function listMockUsers(repo) {
  const companies = await repo.listCompaniesWithUsers();

  return companies
    .filter((company) => company.users.length > 0)
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn))
    .map((company) => ({
      ...companyView(company),
      users: company.users
        .map((user) => ({
          id: user.id,
          displayNameEn: user.displayNameEn,
          displayNameAr: user.displayNameAr,
          jobTitle: user.jobTitle ?? null,
          role:
            user.roles.map((r) => r.role).sort((a, b) => rank(a) - rank(b))[0] ?? ROLES.USER,
        }))
        .sort(
          (a, b) =>
            rank(a.role) - rank(b.role) || a.displayNameEn.localeCompare(b.displayNameEn)
        ),
    }));
}

/**
 * Signs `userId` in. The session id is replaced first, so an id that existed
 * before sign-in (and could have been planted) never becomes an authenticated
 * one. Nothing of the old session is carried over, its CSRF token included.
 * `startedAt` starts the absolute lifetime (lib/session.js). Returns the new
 * session's CSRF token.
 */
export async function startSession(req, userId) {
  await regenerateSession(req);
  req.session.userId = userId;
  req.session.startedAt = Date.now();
  return csrfToken(req);
}

/** Where a person works after sign-in: IT team members in the Helpdesk (D135). */
export const homeOf = (user) => (user.it ? '/helpdesk' : '/');

/**
 * The navigation this person may see. The frontend draws only these; the
 * routes behind them enforce the same thing for themselves. An IT team
 * member has none of the portal's: the Helpdesk draws its own.
 */
export function navFor(user) {
  if (user.it) return [];
  const nav = ['home', 'announcements', 'rooms', 'tickets', 'directory'].map((key) => ({
    key,
    group: 'main',
  }));

  const { adminCompanyIds } = user.scopes;
  if (adminCompanyIds === null || adminCompanyIds.length > 0) {
    nav.push({ key: 'admin', group: 'admin' }, { key: 'auditLog', group: 'admin' });
  }
  return nav;
}

/** The signed-in person as GET /api/me shows them, in either app. */
export function userView(account) {
  return {
    id: account.id,
    email: account.email,
    displayNameEn: account.displayNameEn,
    displayNameAr: account.displayNameAr,
    jobTitle: account.jobTitle ?? null,
    language: account.language,
    department: account.department ?? null,
  };
}

/** The body of the portal's GET /api/me. */
export async function describeMe(req, repo, config) {
  const { user, account } = req;

  // The companies this person may work in: their own first.
  const companies = (await repo.listCompanies(user.scopes.companyIds))
    .sort(
      (a, b) =>
        (b.id === user.companyId) - (a.id === user.companyId) ||
        a.nameEn.localeCompare(b.nameEn)
    )
    .map(companyView);

  return {
    user: userView(account),
    company: companyView(account.company),
    companies,
    roles: user.roles,
    nav: navFor(user),
    // 'Lead' | 'Agent' on an IT team, null otherwise; and the page that is theirs.
    helpdesk: user.it ? { role: user.it } : null,
    home: homeOf(user),
    authMode: config.AUTH_MODE,
    csrfToken: csrfToken(req),
    // Whether the page should install the offline worker (frontend/sw.js).
    serviceWorker: workerEnabledFor(req, config),
  };
}
