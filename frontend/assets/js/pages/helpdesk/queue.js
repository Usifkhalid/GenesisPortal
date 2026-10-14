/**
 * pages/helpdesk/queue.js — two of the Helpdesk's destinations, one table:
 *
 *   #queue      every ticket the reader's team serves (tickets/queue.js)
 *   #assigned   the ones assigned to the reader
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
  const view = ctx.route.name === 'assigned' ? 'assigned' : 'queue';
  let who;
  try {
    who = await loadWho(ctx);
  } catch {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  root.innerHTML = `<div class="stack tk" data-view="${view}" data-density="compact">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t(`hd.nav.${view}`))}</h1>
        <p class="page__lead">${esc(t(`hd.lead.${view}`))}</p>
      </div>
    </header>
    <div id="tkView" class="tk__view"></div>
  </div>`;

  const module = await import('../tickets/queue.js');
  return module.render(root.querySelector('#tkView'), { ...ctx, who, view });
}
