/**
 * pages/announcements/shared.js — what the announcement views have in common:
 * the card, which language to show, and what a failed request meant.
 */

import { errorKey } from '../../api.js';
import { formatDate } from '../../format.js';
import { icon } from '../../components/icons.js';
import { esc } from '../../html.js';
import { getLocale, localized, t } from '../../i18n.js';

export const CATEGORIES = ['General', 'HR', 'IT', 'HSE', 'Events', 'Policy'];

export const categoryLabel = (category) => t(`ann.category.${category}`);

const cap = (lang) => (lang === 'ar' ? 'Ar' : 'En');
const otherOf = (lang) => (lang === 'ar' ? 'en' : 'ar');

/**
 * The language a reader gets: their own when it is complete (a title and a
 * body), otherwise the other one. A post with neither complete (an admin's
 * draft) keeps the reader's language and falls back field by field.
 * @param {{ languages: { en: boolean, ar: boolean } }} item
 */
export function shownLanguage(item) {
  const own = getLocale();
  if (item.languages[own]) return own;
  if (item.languages[otherOf(own)]) return otherOf(own);
  return own;
}

/** A field in the shown language, falling back to the other when it is empty. */
export function textOf(item, field, lang = shownLanguage(item)) {
  return item[`${field}${cap(lang)}`] || item[`${field}${cap(otherOf(lang))}`] || '';
}

export const dirOf = (lang) => (lang === 'ar' ? 'rtl' : 'ltr');

/** "Genesis Mining" or "All MG Holding". */
export function audienceLabel(item) {
  return item.company ? localized(item.company) : t('ann.card.allGroup');
}

/** A sentence for a failed request, in the language in use. */
export function errorText(err) {
  if (err?.code === 'stale_record') return t('admin.error.stale');
  const own = t(`ann.error.${err?.code}`);
  if (own !== `ann.error.${err?.code}`) return own;
  const stem = errorKey(err);
  return `${t(`${stem}.title`)}. ${t(`${stem}.text`)}`;
}

/** Fires when a post is read or the board changes, so the nav count redraws. */
export function announceChange() {
  document.dispatchEvent(new CustomEvent('announcements:changed'));
}

/**
 * One announcement as a card in the board. The whole card is the title's
 * link; the text carries the language it is written in, so a post shown in
 * the other language still reads and aligns correctly.
 */
export function cardHtml(item, { preview = false, lang: forced } = {}) {
  const lang = forced ?? shownLanguage(item);
  const alt = textOf(item, 'coverAlt', lang);
  const title = textOf(item, 'title', lang);
  const summary = textOf(item, 'summary', lang);
  const unread = item.isRead === false;
  const href = preview ? '' : ` href="#announcements/${esc(item.id)}"`;
  const classes = [
    'ann-card',
    item.isPinned ? 'ann-card--pinned' : '',
    unread ? 'ann-card--unread' : '',
    item.coverUrl ? 'ann-card--cover' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<li class="${classes}">
    ${
      item.coverUrl
        ? `<div class="ann-card__media">
             <img src="${esc(item.coverUrl)}" alt="${esc(alt)}" loading="lazy" decoding="async" />
           </div>`
        : ''
    }
    <div class="ann-card__body">
      <div class="ann-card__tags">
        <span class="tag">${esc(categoryLabel(item.category))}</span>
        ${item.isPinned ? `<span class="tag">${esc(t('ann.card.pinned'))}</span>` : ''}
        ${unread ? `<span class="tag tag--highlight">${esc(t('ann.card.unread'))}</span>` : ''}
      </div>
      <h2 class="ann-card__title" lang="${lang}" dir="${dirOf(lang)}">
        <a class="ann-card__link"${href}>${esc(title || t('ann.admin.untitled'))}</a>
      </h2>
      ${
        summary
          ? `<p class="ann-card__summary" lang="${lang}" dir="${dirOf(lang)}">${esc(summary)}</p>`
          : ''
      }
      <dl class="labelstrip labelstrip--compact">
        <div class="labelstrip__pair">
          <dt class="labelstrip__key">${esc(t('ann.card.published'))}</dt>
          <dd class="labelstrip__value">${
            item.publishAt ? esc(formatDate(item.publishAt)) : '—'
          }</dd>
        </div>
        <div class="labelstrip__pair">
          <dt class="labelstrip__key">${esc(t('ann.card.from'))}</dt>
          <dd class="labelstrip__value">${esc(audienceLabel(item))}</dd>
        </div>
      </dl>
    </div>
  </li>`;
}

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
