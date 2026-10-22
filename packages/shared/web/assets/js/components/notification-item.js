/**
 * components/notification-item.js — one notification as the bell and the
 * notification centre draw it. The words come from notification-text.js (the
 * same strings the email uses); the row is a link to what it is about, and
 * following it marks it read.
 */

import { api } from '../api.js';
import { formatDateTime } from '../format.js';
import { esc, keepTicketNumbers } from '../html.js';
import { getLocale, t } from '../i18n.js';
import { describe } from '../notification-text.js';

/** @typedef {{ id: string, templateKey: string, link: string | null, vars: object,
 *   readAt: string | null, createdAt: string }} NotificationItem */

/** The title and detail of a notification in the language in use. */
export function notificationText(item) {
  return describe(item.templateKey, { vars: item.vars }, getLocale(), t);
}

/**
 * @param {NotificationItem} item
 * @param {{ block?: string }} [options]  the class the row's parts are named from
 * @returns {string}
 */
export function notificationHtml(item, { block = 'notice-item' } = {}) {
  const { title, detail } = notificationText(item);
  const unread = !item.readAt;
  const href = item.link ?? '#notifications';
  return `<a class="${block}${unread ? ` ${block}--unread` : ''}" href="${esc(href)}"
      data-notification="${esc(item.id)}" data-notice-unread="${unread}">
    <span class="${block}__title">${
      unread ? `<span class="u-visually-hidden">${esc(t('notification.unread'))}: </span>` : ''
    }<bdi>${keepTicketNumbers(esc(title))}</bdi></span>
    ${detail ? `<span class="${block}__detail"><bdi>${keepTicketNumbers(esc(detail))}</bdi></span>` : ''}
    <span class="${block}__time">${esc(formatDateTime(item.createdAt))}</span>
  </a>`;
}

/** Marks some notifications read on the server. Quiet: a miss is only a stale dot. */
export async function markRead(ids) {
  try {
    const result = await api('/api/notifications/read', {
      method: 'POST',
      body: { ids },
      quiet: true,
    });
    document.dispatchEvent(
      new CustomEvent('notifications:changed', { detail: { unread: result.unread } })
    );
    return result;
  } catch {
    return null;
  }
}
