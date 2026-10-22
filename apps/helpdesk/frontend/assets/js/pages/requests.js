/**
 * pages/requests.js — the IT Helpdesk's tickets that are not the IT team's
 * lists (D144):
 *
 *   #tickets          the tickets I raised (tickets/mine.js)
 *   #tickets/new      raise one (tickets/new.js)
 *   #tickets/<id>     one ticket (tickets/detail.js): the requester's view, or
 *                     the IT team's when the reader is on it
 *
 * The views are the portal's (packages/shared/web/assets/js/pages/tickets);
 * `who` tells them which reader they draw for.
 */

import { loadFailedNotice } from '../components/notice.js';
import { esc } from '../html.js';
import { t } from '../i18n.js';
import { loadWho } from './helpdesk/who.js';

/** A requester is not on the IT team: the views read this, as the portal's do. */
const REQUESTER = { staff: false, isLead: false, queueOptions: null };

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match, helpdesk: { role: string } | null }} ctx
 */
export async function render(root, ctx) {
  const [first] = ctx.route.params;
  const view = !first ? 'mine' : first === 'new' ? 'new' : 'detail';

  let who = REQUESTER;
  if (ctx.helpdesk) {
    try {
      who = await loadWho(ctx);
    } catch {
      root.innerHTML = loadFailedNotice();
      root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
      return undefined;
    }
  }

  const heading =
    view === 'detail'
      ? `<h1 class="u-visually-hidden">${esc(t('nav.tickets'))}</h1>`
      : `<header class="page__header"><div class="page__heading">
          <h1>${esc(t(`hdApp.nav.${view}`))}</h1>
          <p class="page__lead">${esc(t(`hdApp.lead.${view}`))}</p>
        </div></header>`;
  root.innerHTML = `<div class="stack tk" data-view="${view}">
    ${heading}
    <div id="tkView" class="tk__view"></div>
  </div>`;

  const module = await import(`./tickets/${view}.js`);
  return module.render(root.querySelector('#tkView'), {
    ...ctx,
    who,
    ticketId: view === 'detail' ? first : null,
  });
}
