/**
 * pages/announcements/detail.js — one announcement, read. Opening it marks it
 * read for this person (the request itself does that). The body arrives
 * already rendered and sanitised by the server (frontend/assets/js/markdown.js
 * is the one renderer), so it is placed as markup here.
 */

import { ApiError, api } from '../../api.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { formatDateTime } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import {
  announceChange,
  audienceLabel,
  categoryLabel,
  dirOf,
  shownLanguage,
  textOf,
} from './shared.js';

function goneHtml() {
  return `<div class="stack ann">
    <div class="empty">
      <div class="empty__copy">
        <p class="empty__title">${esc(t('ann.detail.goneTitle'))}</p>
        <p class="empty__text">${esc(t('ann.detail.goneText'))}</p>
        <a class="btn btn--secondary" href="#announcements">
          <span class="btn__label">${esc(t('ann.detail.back'))}</span>
        </a>
      </div>
    </div>
  </div>`;
}

const pair = (key, value) => `<div class="labelstrip__pair">
    <dt class="labelstrip__key">${esc(key)}</dt>
    <dd class="labelstrip__value">${value}</dd>
  </div>`;

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../../router.js').Match }} ctx
 */
export async function render(root, ctx) {
  const [id] = ctx.route.params;

  let item;
  try {
    item = await api(`/api/announcements/${encodeURIComponent(id)}`, { quiet: true });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      root.innerHTML = goneHtml();
      return undefined;
    }
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  const lang = shownLanguage(item);
  const own = document.documentElement.lang === 'ar' ? 'ar' : 'en';
  const fellBack = lang !== own;
  const title = textOf(item, 'title', lang);
  const alt = textOf(item, 'coverAlt', lang);
  const html =
    lang === 'ar' ? item.bodyHtmlAr || item.bodyHtmlEn : item.bodyHtmlEn || item.bodyHtmlAr;

  document.title = `${title} · ${t('ann.title')}`;

  root.innerHTML = `<article class="stack ann ann-detail">
    <nav class="breadcrumb" aria-label="${esc(t('breadcrumb.label'))}">
      <ol class="breadcrumb__list">
        <li class="breadcrumb__item">
          <a class="breadcrumb__link" href="#announcements">${esc(t('ann.detail.back'))}</a>
          ${icon('chevronEnd', 'breadcrumb__sep icon--dir')}
        </li>
        <li class="breadcrumb__item" aria-current="page" lang="${lang}" dir="${dirOf(lang)}">${esc(
          title
        )}</li>
      </ol>
    </nav>

    <header class="ann-detail__head">
      <div class="ann-card__tags">
        <span class="tag">${esc(categoryLabel(item.category))}</span>
        ${item.isPinned ? `<span class="tag">${esc(t('ann.card.pinned'))}</span>` : ''}
      </div>
      <h1 class="ann-detail__title" lang="${lang}" dir="${dirOf(lang)}">${esc(title)}</h1>
      <dl class="labelstrip labelstrip--open">
        ${pair(t('ann.detail.category'), esc(categoryLabel(item.category)))}
        ${pair(t('ann.detail.company'), esc(audienceLabel(item)))}
        ${pair(
          t('ann.detail.published'),
          item.publishAt ? esc(formatDateTime(item.publishAt)) : '—'
        )}
        ${item.author ? pair(t('ann.detail.author'), esc(localized(item.author, 'displayName'))) : ''}
        ${item.expiresAt ? pair(t('ann.detail.expires'), esc(formatDateTime(item.expiresAt))) : ''}
      </dl>
    </header>

    ${
      fellBack
        ? `<p class="ann-note" role="note">
             ${icon('info', 'ann-note__icon')}
             <span>${esc(t('ann.detail.fallback', { language: t(`ann.lang.${lang}`) }))}</span>
           </p>`
        : ''
    }

    ${
      item.coverUrl
        ? `<figure class="ann-detail__cover">
             <img src="${esc(item.coverUrl)}" alt="${esc(alt)}" decoding="async" />
           </figure>`
        : ''
    }

    <div class="prose ann-detail__body" lang="${lang}" dir="${dirOf(lang)}">${html}</div>
  </article>`;

  announceChange();
  root.closest('main')?.focus({ preventScroll: true });
  return undefined;
}
