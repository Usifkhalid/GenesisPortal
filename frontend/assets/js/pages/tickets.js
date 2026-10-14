/**
 * pages/tickets.js — an employee's IT tickets, one page with a view per address:
 *
 *   #tickets                    my tickets (open / closed), with search
 *   #tickets/new                raise a ticket
 *   #tickets/<id>               one of my tickets
 *
 * The IT team works tickets in the IT Helpdesk (/helpdesk), never here: IT
 * team members have no portal, and an administrator who is not on the team
 * sees only their own tickets like anyone else (D135).
 *
 * Requesters read plain words; the codes and the clock (P1, SLA, breached)
 * belong to the Helpdesk.
 */

import { esc } from '../html.js';
import { t } from '../i18n.js';

const VIEWS = new Set(['new']);

/** A requester is not on the IT team: the views read this, as the Helpdesk's do. */
const REQUESTER = { staff: false, isLead: false, queueOptions: null };

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match, user: object }} ctx
 */
export async function render(root, ctx) {
  const [first] = ctx.route.params;
  const view = !first ? 'mine' : VIEWS.has(first) ? first : 'detail';

  const links = [
    { key: 'mine', href: '#tickets', label: 'tk.nav.mine' },
    { key: 'new', href: '#tickets/new', label: 'tk.nav.new' },
  ];
  const current = view === 'detail' ? 'mine' : view;

  root.innerHTML = `<div class="stack tk" data-view="${esc(view)}">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t('nav.tickets'))}</h1>
        <p class="page__lead">${esc(t('tk.lead'))}</p>
      </div>
    </header>
    <nav class="rooms-nav" aria-label="${esc(t('tk.nav.label'))}">
      ${links
        .map(
          (link) =>
            `<a class="rooms-nav__link" href="${link.href}" ${
              link.key === current ? 'aria-current="page"' : ''
            }>${esc(t(link.label))}</a>`
        )
        .join('')}
    </nav>
    <div id="tkView" class="tk__view"></div>
  </div>`;

  const host = root.querySelector('#tkView');
  const module = await import(`./tickets/${view}.js`);
  return module.render(host, {
    ...ctx,
    who: REQUESTER,
    ticketId: view === 'detail' ? first : null,
  });
}
