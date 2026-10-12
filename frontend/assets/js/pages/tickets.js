/**
 * pages/tickets.js — the IT helpdesk, one page with a view per address:
 *
 *   #tickets                    my tickets (open / closed), with search
 *   #tickets/new                raise a ticket
 *   #tickets/<id>               one ticket: the requester's view, or IT's
 *   #tickets/queue              the IT queue          (support team only)
 *   #tickets/settings           categories and canned replies (Leads; HoldingAdmin)
 *
 * Whether someone is on a support team comes from the server: the queue's
 * numbers (GET /api/tickets/counts) are null for everyone else, and the
 * routes behind the queue refuse them anyway. The links are courtesy.
 *
 * Requesters read plain words; the codes and the clock (P1, SLA, breached)
 * appear in IT's views only.
 */

import { api } from '../api.js';
import { loadFailedNotice, notice } from '../components/notice.js';
import { esc } from '../html.js';
import { t } from '../i18n.js';

const VIEWS = new Set(['new', 'queue', 'settings']);

/**
 * What IT's views need to know about the reader, in one place.
 * @returns {Promise<{ staff: boolean, isLead: boolean, isHolding: boolean, queueOptions: object|null }>}
 */
async function loadStaff(ctx) {
  const counts = await api('/api/tickets/counts', { quiet: true });
  if (!counts.queue)
    return { staff: false, isLead: false, isHolding: false, queueOptions: null };

  const [queueOptions, scope] = await Promise.all([
    api('/api/tickets/queue/options', { quiet: true }),
    ctx.admin ? api('/api/admin/scope', { quiet: true }).catch(() => null) : null,
  ]);
  const isHolding = Boolean(scope?.holdingAdmin);
  const me = queueOptions.agents.find((a) => a.id === ctx.user.id);
  return {
    staff: true,
    isHolding,
    isLead: isHolding || me?.role === 'Lead',
    queueOptions,
    counts: counts.queue,
  };
}

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match, user: object, admin: boolean }} ctx
 */
export async function render(root, ctx) {
  const [first] = ctx.route.params;
  const view = !first ? 'mine' : VIEWS.has(first) ? first : 'detail';

  let who;
  try {
    who = await loadStaff(ctx);
  } catch {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  const denied =
    (view === 'queue' && !who.staff) || (view === 'settings' && !(who.staff && who.isLead));

  const links = [
    { key: 'mine', href: '#tickets', label: 'tk.nav.mine' },
    { key: 'new', href: '#tickets/new', label: 'tk.nav.new' },
    ...(who.staff ? [{ key: 'queue', href: '#tickets/queue', label: 'tk.nav.queue' }] : []),
    ...(who.staff && who.isLead
      ? [{ key: 'settings', href: '#tickets/settings', label: 'tk.nav.settings' }]
      : []),
  ];
  // A ticket opened from the queue keeps the queue lit.
  const current =
    view === 'detail' ? (ctx.route.query.get('from') === 'queue' ? 'queue' : 'mine') : view;

  root.innerHTML = `<div class="stack tk" data-view="${esc(view)}">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t('nav.tickets'))}</h1>
        <p class="page__lead">${esc(t(who.staff ? 'tk.leadStaff' : 'tk.lead'))}</p>
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
  if (denied) {
    host.innerHTML = notice({
      tone: 'info',
      mark: 'lock',
      titleKey: 'page.noAccess.title',
      textKey: 'page.noAccess.text',
    });
    return undefined;
  }

  const module = await import(`./tickets/${view}.js`);
  return module.render(host, { ...ctx, who, ticketId: view === 'detail' ? first : null });
}
