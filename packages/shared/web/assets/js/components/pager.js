/**
 * components/pager.js — "previous / page n of m / next" under a paged list
 * (announcements, notifications).
 */

import { esc } from '../html.js';
import { t } from '../i18n.js';
import { icon } from './icons.js';

/** The pager the audit log uses, over `page` of `pages`. */
export function pagerHtml({ page, pages, hrefFor, label }) {
  if (pages <= 1) return '';
  return `<nav class="pagination ann-pager" aria-label="${esc(label)}">
    <a class="pagination__link pagination__step" href="${hrefFor(page - 1)}"
      ${page <= 1 ? 'aria-disabled="true" tabindex="-1"' : ''}>
      ${icon('chevronEnd', 'ann-pager__back')}
      <span>${esc(t('pagination.previous'))}</span>
    </a>
    <p class="pagination__status">${esc(t('audit.page', { page, pages }))}</p>
    <a class="pagination__link pagination__step" href="${hrefFor(page + 1)}"
      ${page >= pages ? 'aria-disabled="true" tabindex="-1"' : ''}>
      <span>${esc(t('pagination.next'))}</span>
      ${icon('chevronEnd', 'icon--dir')}
    </a>
  </nav>`;
}
