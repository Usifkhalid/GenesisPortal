/**
 * pages/admin/helpdesk.js — the IT helpdesk's configuration in the Admin
 * area (HoldingAdmin): team members and leads, categories, locations, SLA
 * targets and working hours, holidays and canned replies. The screens are
 * shared with a Lead's #tickets/settings (tickets/config.js).
 */

import { renderConfig } from '../tickets/config.js';

/**
 * @param {HTMLElement} root
 * @param {{ scope: { holdingAdmin: boolean } }} context
 */
export function render(root, { scope }) {
  return renderConfig(root, { holding: scope.holdingAdmin });
}
