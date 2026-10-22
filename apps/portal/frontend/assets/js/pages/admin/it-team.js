/**
 * pages/admin/it-team.js — who is on the IT team, and as what (HoldingAdmin).
 * Nothing else of the helpdesk is here: its settings are the IT Leads', in
 * the IT Helpdesk, and its tickets are the team's (D135). Someone added works
 * in /helpdesk from their next request and no longer in the portal; someone
 * removed comes back to the portal. The team always keeps an active lead.
 */

import { MEMBER_SECTIONS, renderConfig } from '../tickets/config.js';

/** @param {HTMLElement} root */
export function render(root) {
  return renderConfig(root, { base: '/api/admin/it-team', sections: MEMBER_SECTIONS });
}
