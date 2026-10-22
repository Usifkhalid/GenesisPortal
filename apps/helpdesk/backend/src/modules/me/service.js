/**
 * service.js — the IT Helpdesk's GET /api/me: who is signed in and which of
 * the helpdesk's areas they may open. The page draws only these; every route
 * behind them checks for itself.
 *
 *   everyone        New ticket, My tickets, notifications
 *   it              'Lead' | 'Agent' on the IT team: the queue, assigned,
 *                   reports, and for leads the settings
 *   admin           HoldingAdmin of the helpdesk: Administration (the IT team,
 *                   companies and their mail domains)
 *   portalUrl       where the header's "Back to portal" leads (PORTAL_URL),
 *                   or null for no link
 */

import { ROLES } from '@mg/shared/server/lib/roles.js';
import { hasRole } from '@mg/shared/server/lib/scope.js';
import { workerEnabledFor } from '@mg/shared/server/lib/service-worker.js';
import { csrfToken } from '@mg/shared/server/middleware/csrf.js';
import { companyView, userView } from '@mg/shared/server/modules/auth/service.js';

/** The body of GET /api/me. */
export async function describeHelpdeskMe(req, repo, config) {
  const { user, account } = req;
  return {
    user: userView(account),
    company: companyView(account.company),
    roles: user.roles,
    helpdesk: user.it ? { role: user.it } : null,
    admin: hasRole(user, ROLES.HOLDING_ADMIN),
    portalUrl: config.PORTAL_URL ?? null,
    authMode: config.AUTH_MODE,
    csrfToken: csrfToken(req),
    // Whether the page should install the offline worker (sw.js).
    serviceWorker: workerEnabledFor(req, config),
  };
}
