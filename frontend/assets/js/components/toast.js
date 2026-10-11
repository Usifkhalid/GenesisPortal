/**
 * components/toast.js — a short message that does not belong to one place on
 * the page: a request failed, something was saved.
 *
 * Toasts are appended to one live region, so they are announced without taking
 * focus from what the person was doing.
 */

import { t } from '../i18n.js';
import { esc } from '../html.js';
import { icon } from './icons.js';

const ICONS = {
  success: 'statusResolved',
  warning: 'statusOverdue',
  danger: 'statusOverdue',
  info: 'info',
};

/** Long enough to read a two-line message in either language. */
const VISIBLE_MS = 6000;

/** The page's live region; made on first use where the markup has none. */
function toaster() {
  let region = document.getElementById('toaster');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toaster';
    region.className = 'toaster';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    document.body.append(region);
  }
  return region;
}

/**
 * @param {object} options
 * @param {'success'|'warning'|'danger'|'info'} [options.tone]
 * @param {string} options.titleKey  an i18n key
 * @param {string} [options.textKey]  an i18n key
 */
export function showToast({ tone = 'info', titleKey, textKey }) {
  const region = toaster();

  // Five cards failing on one dropped connection is one piece of news.
  for (const shown of region.children) {
    if (shown.dataset.toastKey === titleKey) return;
  }

  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.dataset.toastKey = titleKey;
  el.innerHTML = `
    ${icon(ICONS[tone] ?? ICONS.info, 'toast__icon')}
    <div class="toast__content">
      <p class="toast__title">${esc(t(titleKey))}</p>
      ${textKey ? `<p class="toast__text">${esc(t(textKey))}</p>` : ''}
    </div>
    <button type="button" class="btn btn--ghost btn--sm btn--icon toast__close"
            aria-label="${esc(t('a11y.dismissToast'))}">
      ${icon('x', 'btn__icon')}
    </button>`;
  el.querySelector('.toast__close').addEventListener('click', () => el.remove());
  region.append(el);
  setTimeout(() => el.remove(), VISIBLE_MS);
}
