/**
 * pages/helpdesk/settings.js — IT settings, for IT Leads (D135): categories,
 * SLA targets and working hours, locations, holidays and canned replies. The
 * screens are tickets/config.js; every change is audited by the API. Who is
 * on the team is not here: that is the HoldingAdmin's, in the portal.
 */

import { esc } from '../../html.js';
import { t } from '../../i18n.js';
import { LEAD_SECTIONS, renderConfig } from '../tickets/config.js';

/** @param {HTMLElement} root */
export function render(root) {
  root.innerHTML = `<div class="stack admin" data-density="compact">
    <header class="page__heading">
      <h1>${esc(t('hd.nav.settings'))}</h1>
      <p class="page__lead">${esc(t('hd.lead.settings'))}</p>
    </header>
    <div id="hdSettings"></div>
  </div>`;
  return renderConfig(root.querySelector('#hdSettings'), {
    base: '/api/helpdesk/settings',
    sections: LEAD_SECTIONS,
  });
}
