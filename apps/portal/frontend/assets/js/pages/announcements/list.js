/**
 * pages/announcements/list.js — the board: every announcement for this
 * person, pinned first and then newest, as cards. Filters (category, unread)
 * and the page live in the address, so a view can be bookmarked.
 */

import { api } from '../../api.js';
import { loadFailedNotice } from '../../components/notice.js';
import { formatNumber } from '../../format.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';
import { CATEGORIES, announceChange, cardHtml, categoryLabel, pagerHtml } from './shared.js';

const PAGE_SIZE = 12;

const SKELETON = `<ul class="ann-grid" data-loading>
  ${Array.from(
    { length: 6 },
    () => `<li class="ann-card ann-card--skeleton" aria-hidden="true">
      <div class="ann-card__body">
        <span class="skeleton skeleton--text skeleton--line-short"></span>
        <span class="skeleton skeleton--title"></span>
        <span class="skeleton skeleton--text skeleton--line-long"></span>
      </div>
    </li>`
  ).join('')}
</ul>`;

function headerHtml(ctx) {
  return `<header class="page__header">
    <div class="page__heading">
      <h1>${esc(t('ann.title'))}</h1>
      <p class="page__lead">${esc(t('ann.lead'))}</p>
    </div>
    ${
      ctx.admin
        ? `<div class="page__actions">
             <a class="btn btn--secondary" href="#announcements/manage">
               <span class="btn__label">${esc(t('ann.manage'))}</span>
             </a>
             <a class="btn btn--primary" href="#announcements/new">
               <span class="btn__label">${esc(t('ann.new'))}</span>
             </a>
           </div>`
        : ''
    }
  </header>`;
}

function filtersHtml({ category, unread }) {
  return `<form class="ann-filters" id="annFilters" role="search" aria-label="${esc(
    t('ann.filters.label')
  )}">
    <div class="field ann-filters__show">
      <span class="field__label" id="annShowLabel">${esc(t('ann.filters.show'))}</span>
      <div class="segmented" role="group" aria-labelledby="annShowLabel">
        <button type="button" class="segmented__option" data-unread="" aria-pressed="${!unread}">
          ${esc(t('ann.filters.all'))}
        </button>
        <button type="button" class="segmented__option" data-unread="true" aria-pressed="${unread}">
          ${esc(t('ann.filters.unread'))}
        </button>
      </div>
    </div>
    <div class="field ann-filters__category">
      <label class="field__label" for="annCategory">${esc(t('ann.filters.category'))}</label>
      <select class="select" id="annCategory">
        <option value="">${esc(t('ann.filters.categoryAll'))}</option>
        ${CATEGORIES.map(
          (c) =>
            `<option value="${c}" ${c === category ? 'selected' : ''}>${esc(
              categoryLabel(c)
            )}</option>`
        ).join('')}
      </select>
    </div>
  </form>`;
}

function emptyHtml({ category, unread }) {
  const key = unread ? 'unread' : category ? 'category' : '';
  const title = key ? `ann.empty.${key}Title` : 'ann.empty.title';
  const text = key ? `ann.empty.${key}Text` : 'ann.empty.text';
  return `<div class="empty">
    <div class="empty__copy">
      <p class="empty__title">${esc(t(title))}</p>
      <p class="empty__text">${esc(t(text))}</p>
      ${
        key === 'category'
          ? `<a class="btn btn--secondary" href="#announcements">
               <span class="btn__label">${esc(t('ann.empty.showAll'))}</span>
             </a>`
          : ''
      }
    </div>
  </div>`;
}

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../../router.js').Match, admin: boolean }} ctx
 */
export async function render(root, ctx) {
  const { query } = ctx.route;
  const category = CATEGORIES.includes(query.get('category')) ? query.get('category') : '';
  const unread = query.get('unread') === 'true';
  const page = Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1);

  const addressFor = (changes) => {
    const next = new URLSearchParams();
    const values = { category, unread: unread ? 'true' : '', page: '', ...changes };
    for (const [key, value] of Object.entries(values)) {
      if (value && !(key === 'page' && Number(value) === 1)) next.set(key, value);
    }
    const qs = next.toString();
    return `#announcements${qs ? `?${qs}` : ''}`;
  };

  root.innerHTML = `<div class="stack ann">
    ${headerHtml(ctx)}
    ${filtersHtml({ category, unread })}
    <div id="annBody" aria-live="polite" aria-busy="true">
      <p class="u-visually-hidden">${esc(t('loading.label'))}</p>
      ${SKELETON}
    </div>
  </div>`;

  root.querySelector('#annCategory').addEventListener('change', (event) => {
    location.hash = addressFor({ category: event.target.value, page: '' });
  });
  for (const button of root.querySelectorAll('[data-unread]')) {
    button.addEventListener('click', () => {
      location.hash = addressFor({ unread: button.dataset.unread, page: '' });
    });
  }

  const body = root.querySelector('#annBody');
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (category) params.set('category', category);
  if (unread) params.set('unread', 'true');

  let result;
  try {
    result = await api(`/api/announcements?${params}`, { quiet: true });
  } catch {
    body.setAttribute('aria-busy', 'false');
    body.innerHTML = loadFailedNotice();
    body.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  body.setAttribute('aria-busy', 'false');

  if (result.items.length === 0 && page > 1) {
    location.hash = addressFor({ page: '' });
    return undefined;
  }

  body.innerHTML =
    result.items.length === 0
      ? emptyHtml({ category, unread })
      : `<ul class="ann-grid">${result.items.map((item) => cardHtml(item)).join('')}</ul>
         <p class="ann-count">${esc(
           t('ann.status', {
             from: formatNumber((page - 1) * result.pageSize + 1),
             to: formatNumber((page - 1) * result.pageSize + result.items.length),
             total: formatNumber(result.total),
           })
         )}</p>
         ${pagerHtml({
           page,
           pages,
           label: t('ann.pagination'),
           hrefFor: (n) => addressFor({ page: String(n) }),
         })}`;

  for (const link of body.querySelectorAll('.pagination [aria-disabled="true"]')) {
    link.addEventListener('click', (event) => event.preventDefault());
  }
  announceChange();
  return undefined;
}
