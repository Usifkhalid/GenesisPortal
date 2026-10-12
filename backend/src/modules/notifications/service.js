/**
 * service.js — a person's own notifications and channel preferences.
 *
 * Everything here is "mine": the person comes from `req.user` and every query
 * carries their id, so one person's notifications cannot be listed, counted or
 * marked read by another, whatever ids are sent. Ids that are not theirs are
 * ignored, not reported (the answer is how many were marked).
 *
 * Preferences are one switch per category and channel. A switch never saved is
 * on; the screen shows it on and saving writes only what was changed.
 */

import { CATEGORIES, CHANNELS } from '../../../../frontend/assets/js/notification-text.js';
import { requireUser } from '../../lib/scope.js';

/** A row as the bell and the centre need it. */
function view(row) {
  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = { link: null, vars: {} };
  }
  return {
    id: row.id,
    templateKey: row.templateKey,
    link: payload.link ?? null,
    vars: payload.vars ?? {},
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/**
 * @param {object} deps
 * @param {object} deps.store  see store-prisma.js
 * @param {() => Date} [deps.now]
 */
export function createNotificationService({ store, now = () => new Date() }) {
  async function list(req, { unread, page, pageSize }) {
    const user = requireUser(req);
    const { total, items } = await store.list({
      userId: user.id,
      unread,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      total,
      page,
      pageSize,
      unread: await store.countUnread(user.id),
      items: items.map(view),
    };
  }

  async function unreadCount(req) {
    const user = requireUser(req);
    return { unread: await store.countUnread(user.id) };
  }

  async function markRead(req, ids) {
    const user = requireUser(req);
    const marked = await store.markRead(user.id, ids, now());
    return { marked, unread: await store.countUnread(user.id) };
  }

  async function markAllRead(req) {
    const user = requireUser(req);
    const marked = await store.markAllRead(user.id, now());
    return { marked, unread: 0 };
  }

  /** Every category × channel, with what is saved laid over "on". */
  async function preferences(req) {
    const user = requireUser(req);
    const saved = await store.listPreferences(user.id);
    return {
      categories: CATEGORIES,
      channels: CHANNELS,
      items: CATEGORIES.flatMap((category) =>
        CHANNELS.map((channel) => ({
          category,
          channel,
          enabled:
            saved.find((p) => p.category === category && p.channel === channel)?.enabled ??
            true,
        }))
      ),
    };
  }

  async function setPreferences(req, items) {
    const user = requireUser(req);
    await store.setPreferences(user.id, user.companyId, items);
    return preferences(req);
  }

  return { list, unreadCount, markRead, markAllRead, preferences, setPreferences };
}
