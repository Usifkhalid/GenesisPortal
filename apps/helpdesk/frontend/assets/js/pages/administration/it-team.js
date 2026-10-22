/**
 * pages/administration/it-team.js — who is on the IT team, and as what. The
 * portal's screen (tickets/config.js), searching the helpdesk's own people.
 * Someone added sees the IT team's pages from their next click; the team
 * always keeps an active lead.
 */

import { MEMBER_SECTIONS, renderConfig } from '../tickets/config.js';

/** @param {HTMLElement} root */
export function render(root) {
  return renderConfig(root, {
    base: '/api/admin/it-team',
    sections: MEMBER_SECTIONS,
    peopleSource: '/api/admin/people',
  });
}
