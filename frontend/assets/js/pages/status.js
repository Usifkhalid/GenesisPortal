/**
 * pages/status.js — the three pages that stand in for one that cannot be
 * shown: there is no such address, this person's role does not include it, or
 * its module is not built yet. router.js decides which; see route.status.
 *
 * "pending" is a placeholder: it goes when the last module has its own page.
 */

import { t } from '../i18n.js';
import { esc } from '../html.js';
import { icon } from '../components/icons.js';

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match }} ctx
 */
export function render(root, { route }) {
  const { status } = route;
  // A module that is on its way keeps its own name as the heading.
  const title = status === 'pending' ? t(route.title) : t(`page.${status}.title`);

  root.innerHTML = `<div class="stack">
    <header class="page__heading">
      <h1>${esc(title)}</h1>
      <p class="page__lead">${esc(t(`page.${status}.text`))}</p>
    </header>
    <div>
      <a class="btn btn--secondary" href="#home">
        ${icon('home', 'btn__icon')}
        <span class="btn__label">${esc(t('page.backHome'))}</span>
      </a>
    </div>
  </div>`;
}
