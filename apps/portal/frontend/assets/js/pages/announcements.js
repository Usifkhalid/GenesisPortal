/**
 * pages/announcements.js — announcements, one page with a view per address:
 *
 *   #announcements                       the board: cards, filters, paging
 *   #announcements/<id>                  one announcement, read
 *   #announcements/manage                administrators: every status, read stats
 *   #announcements/new                   administrators: write one
 *   #announcements/<id>/edit             administrators: change one
 *
 * The views are modules in announcements/, fetched when asked for. What an
 * administrator may do is decided by the routes behind them; an ordinary
 * reader who opens an admin address is told they have no access.
 */

import { notice } from '../components/notice.js';
import { esc } from '../html.js';
import { t } from '../i18n.js';

const ADMIN_VIEWS = new Set(['manage', 'new']);

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match, admin: boolean }} ctx
 */
export async function render(root, ctx) {
  const [first, second] = ctx.route.params;

  let view = 'list';
  if (first && ADMIN_VIEWS.has(first)) view = first === 'new' ? 'editor' : 'manage';
  else if (first && second === 'edit') view = 'editor';
  else if (first) view = 'detail';

  if ((view === 'manage' || view === 'editor') && !ctx.admin) {
    root.innerHTML = `<div class="stack">${notice({
      tone: 'warning',
      mark: 'statusOverdue',
      titleKey: 'page.noAccess.title',
      textKey: 'page.noAccess.text',
    })}<p><a class="link-quiet" href="#announcements">${esc(t('ann.detail.back'))}</a></p></div>`;
    return undefined;
  }

  const module = await import(`./announcements/${view}.js`);
  return module.render(root, ctx);
}
