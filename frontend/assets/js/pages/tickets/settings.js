/**
 * pages/tickets/settings.js — a team Lead's screens (categories and canned
 * replies of their team); a HoldingAdmin sees every section here too. The
 * screens are config.js, which the Admin area mounts as well.
 */

import { renderConfig } from './config.js';

/**
 * @param {HTMLElement} root
 * @param {{ who: { isHolding: boolean } }} ctx
 */
export function render(root, ctx) {
  return renderConfig(root, { holding: ctx.who.isHolding });
}
