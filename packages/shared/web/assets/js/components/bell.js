/**
 * bell.js — the shells' notification bell: the unread count (polled while the
 * tab is visible) and, when opened, the latest notifications from
 * GET /api/notifications. Used by the portal (app.js) and the IT Helpdesk
 * (helpdesk.js); the markup is the same in index.html and helpdesk.html
 * (#notifBtn, #notifCount, #notifMenu, #notifList, #notifMarkAll).
 */

import { api } from '../api.js';
import { esc } from '../html.js';
import { t } from '../i18n.js';
import { markRead as markNotificationRead, notificationHtml } from './notification-item.js';
import { closeMenu } from './popover.js';

/** The shell's abort signal for background reads, set by initBell. */
let backgroundSignal = () => undefined;

let notifUnread = 0;
/** The latest few, as the server listed them; null before the first answer. */
let bellItems = null;
const BELL_ITEMS = 6;
const NOTIF_POLL_MS = 60_000;

/**
 * aria-label is explicit on the bell button, so it overrides any name the
 * browser would otherwise compute from its content — the unread count has to
 * be folded into that label directly, or a screen reader never hears it.
 */
function drawNotifCount() {
  const el = document.getElementById('notifCount');
  el.hidden = notifUnread === 0;
  el.textContent = notifUnread > 99 ? '99+' : String(notifUnread);
  document
    .getElementById('notifBtn')
    .setAttribute(
      'aria-label',
      notifUnread > 0
        ? t('notification.unreadLabel', { count: notifUnread })
        : t('nav.notifications')
    );
}

/** The number on the bell: one small request, tried again every minute. */
async function refreshNotifCount() {
  try {
    const result = await api('/api/notifications/unread-count', {
      quiet: true,
      signal: backgroundSignal(),
    });
    notifUnread = result.unread;
  } catch {
    // The bell is a convenience: keep the last number rather than a wrong one.
  }
  drawNotifCount();
}

function drawBellList() {
  const list = document.getElementById('notifList');
  if (!list) return;
  const markAll = document.getElementById('notifMarkAll');
  markAll.hidden = notifUnread === 0;
  if (bellItems === null) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML =
    bellItems.length === 0
      ? `<p class="menu__empty">${esc(t('notification.empty'))}</p>`
      : bellItems.map((item) => notificationHtml(item)).join('');
}

/** The latest notifications, fetched when the bell is opened. */
async function loadBellList() {
  try {
    const result = await api(`/api/notifications?pageSize=${BELL_ITEMS}`, {
      quiet: true,
      signal: backgroundSignal(),
    });
    bellItems = result.items;
    notifUnread = result.unread;
  } catch {
    // Keep what was there; an empty bell on a weak connection is not "no news".
  }
  drawNotifCount();
  drawBellList();
}

function initNotifications() {
  const button = document.getElementById('notifBtn');
  const menu = document.getElementById('notifMenu');

  // initPopover has already toggled the menu by the time this runs.
  button.addEventListener('click', () => {
    if (!menu.hidden) loadBellList();
  });

  // Following a notification marks it read; the page it leads to is the news.
  menu.addEventListener('click', (event) => {
    const link = event.target.closest('[data-notification]');
    if (link) {
      if (link.dataset.noticeUnread === 'true')
        markNotificationRead([link.dataset.notification]);
      closeMenu('notifMenu');
    }
  });

  document.getElementById('notifMarkAll').addEventListener('click', async () => {
    try {
      await api('/api/notifications/read-all', { method: 'POST', body: {}, quiet: true });
      notifUnread = 0;
      bellItems =
        bellItems?.map((item) => ({ ...item, readAt: item.readAt ?? new Date() })) ?? null;
      drawNotifCount();
      drawBellList();
    } catch {
      // Still unread: the count stays honest.
    }
  });

  document.addEventListener('notifications:changed', (event) => {
    if (typeof event.detail?.unread === 'number') notifUnread = event.detail.unread;
    drawNotifCount();
    if (!menu.hidden) {
      loadBellList();
    } else {
      // Closed: what it showed is out of date, and it is fetched again on open.
      bellItems = null;
      drawBellList();
    }
  });

  // Not while the tab is hidden: a phone in a pocket should not be polling.
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshNotifCount();
  }, NOTIF_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshNotifCount();
  });
  refreshNotifCount();
}

/**
 * Wires the bell (its popover is the shell's to open) and starts polling.
 * @param {{ signal: () => AbortSignal }} options  the shell's background signal,
 *   which sign-out aborts
 */
export function initBell({ signal }) {
  backgroundSignal = signal;
  initNotifications();
}

/** Draws the count and the list again: the language changed. */
export function redrawBell() {
  drawNotifCount();
  drawBellList();
}
