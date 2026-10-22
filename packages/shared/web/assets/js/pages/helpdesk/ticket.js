/**
 * pages/helpdesk/ticket.js — tickets in the Helpdesk that are not a list:
 *
 *   #tickets/<id>     one ticket, the IT team's view (tickets/detail.js)
 *   #tickets/new      a ticket for oneself: IT staff have no portal (D135)
 *   #tickets          the tickets one raised for oneself
 */

import { loadFailedNotice } from '../../components/notice.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';
import { loadWho } from './who.js';

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../../router.js').Match, helpdesk: { role: string } }} ctx
 */
export async function render(root, ctx) {
  const [first] = ctx.route.params;
  const view = !first ? 'mine' : first === 'new' ? 'new' : 'detail';

  let who;
  try {
    who = await loadWho(ctx);
  } catch {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  const heading =
    view === 'detail'
      ? `<h1 class="u-visually-hidden">${esc(t('nav.tickets'))}</h1>`
      : `<header class="page__header"><div class="page__heading">
          <h1>${esc(t(view === 'new' ? 'hd.newForMe' : 'hd.myRequests'))}</h1>
          <p class="page__lead">${esc(t(view === 'new' ? 'hd.lead.new' : 'hd.lead.mine'))}</p>
        </div></header>`;
  root.innerHTML = `<div class="stack tk" data-view="${view}">
    ${heading}
    <div id="tkView" class="tk__view"></div>
  </div>`;

  const module = await import(`../tickets/${view}.js`);
  return module.render(root.querySelector('#tkView'), {
    ...ctx,
    who,
    ticketId: view === 'detail' ? first : null,
  });
}
