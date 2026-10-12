/**
 * pages/notifications.js — the notification centre, one page with two views:
 *
 *   #notifications                  every in-app notification, newest first
 *   #notifications/preferences      what reaches me, and on which channel
 *
 * The bell in the top bar shows the latest few; this is the whole list.
 */

import { api } from '../api.js';
import { markRead, notificationHtml } from '../components/notification-item.js';
import { loadFailedNotice } from '../components/notice.js';
import { formatNumber } from '../format.js';
import { esc } from '../html.js';
import { t } from '../i18n.js';
import { pagerHtml } from './announcements/shared.js';

const PAGE_SIZE = 20;

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match }} ctx
 */
export async function render(root, ctx) {
  if (ctx.route.params[0] === 'preferences') {
    const module = await import('./notifications/preferences.js');
    return module.render(root, ctx);
  }

  const { query } = ctx.route;
  const unread = query.get('unread') === 'true';
  const page = Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1);

  const addressFor = (changes) => {
    const next = new URLSearchParams();
    const values = { unread: unread ? 'true' : '', page: '', ...changes };
    for (const [key, value] of Object.entries(values)) {
      if (value && !(key === 'page' && Number(value) === 1)) next.set(key, value);
    }
    const qs = next.toString();
    return `#notifications${qs ? `?${qs}` : ''}`;
  };

  root.innerHTML = `<div class="stack notify">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t('notification.title'))}</h1>
        <p class="page__lead">${esc(t('notification.lead'))}</p>
      </div>
      <div class="page__actions">
        <a class="btn btn--secondary" href="#notifications/preferences">
          <span class="btn__label">${esc(t('notification.settings'))}</span>
        </a>
        <button type="button" class="btn btn--secondary" id="notifyMarkAll" disabled>
          <span class="btn__label">${esc(t('notification.markAll'))}</span>
        </button>
      </div>
    </header>
    <div class="field notify__filter">
      <span class="field__label" id="notifyShowLabel">${esc(t('notification.filter.label'))}</span>
      <div class="segmented" role="group" aria-labelledby="notifyShowLabel">
        <button type="button" class="segmented__option" data-unread="" aria-pressed="${!unread}">
          ${esc(t('notification.filter.all'))}
        </button>
        <button type="button" class="segmented__option" data-unread="true" aria-pressed="${unread}">
          ${esc(t('notification.filter.unread'))}
        </button>
      </div>
    </div>
    <div id="notifyBody" aria-live="polite" aria-busy="true">
      <p class="u-visually-hidden">${esc(t('notification.loadingLabel'))}</p>
      <ul class="notify-list" aria-hidden="true">
        ${Array.from(
          { length: 5 },
          () => `<li class="notify-list__item"><span class="notice-page notice-page--skeleton">
            <span class="skeleton skeleton--text skeleton--line-long"></span>
            <span class="skeleton skeleton--text skeleton--line-short"></span>
          </span></li>`
        ).join('')}
      </ul>
    </div>
  </div>`;

  for (const button of root.querySelectorAll('[data-unread]')) {
    button.addEventListener('click', () => {
      location.hash = addressFor({ unread: button.dataset.unread, page: '' });
    });
  }

  const body = root.querySelector('#notifyBody');
  const markAll = root.querySelector('#notifyMarkAll');
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (unread) params.set('unread', 'true');

  let result;
  try {
    result = await api(`/api/notifications?${params}`, { quiet: true });
  } catch {
    body.setAttribute('aria-busy', 'false');
    body.innerHTML = loadFailedNotice();
    body.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }
  body.setAttribute('aria-busy', 'false');

  if (result.items.length === 0 && page > 1) {
    location.hash = addressFor({ page: '' });
    return undefined;
  }

  markAll.disabled = result.unread === 0;
  markAll.addEventListener('click', async () => {
    markAll.disabled = true;
    try {
      await api('/api/notifications/read-all', { method: 'POST', body: {}, quiet: true });
      document.dispatchEvent(
        new CustomEvent('notifications:changed', { detail: { unread: 0 } })
      );
      await render(root, ctx);
    } catch {
      markAll.disabled = false;
    }
  });

  if (result.items.length === 0) {
    const key = unread ? 'emptyUnread' : 'empty';
    body.innerHTML = `<div class="empty empty--inline">
      <div class="empty__copy">
        <p class="empty__title">${esc(t(`notification.${key}Title`))}</p>
        <p class="empty__text">${esc(t(`notification.${key}Text`))}</p>
      </div>
    </div>`;
    return undefined;
  }

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  body.innerHTML = `<ul class="notify-list">
      ${result.items
        .map(
          (item) =>
            `<li class="notify-list__item">${notificationHtml(item, { block: 'notice-page' })}</li>`
        )
        .join('')}
    </ul>
    <p class="notify__count">${esc(
      t('notification.status', {
        from: formatNumber((page - 1) * result.pageSize + 1),
        to: formatNumber((page - 1) * result.pageSize + result.items.length),
        total: formatNumber(result.total),
      })
    )}</p>
    ${pagerHtml({
      page,
      pages,
      label: t('notification.pagination'),
      hrefFor: (n) => addressFor({ page: String(n) }),
    })}`;

  for (const link of body.querySelectorAll('.pagination [aria-disabled="true"]')) {
    link.addEventListener('click', (event) => event.preventDefault());
  }
  // Following a notification reads it.
  for (const link of body.querySelectorAll('[data-notice-unread="true"]')) {
    link.addEventListener('click', () => markRead([link.dataset.notification]));
  }
  return undefined;
}
