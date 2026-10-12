/**
 * notify.js — the one way the portal tells a person something.
 *
 *   await notify([userId], 'ticket.assigned', { link: '#tickets/<id>', number, subject })
 *
 * For each person it checks what they asked to receive (a missing preference
 * means yes), then writes an in-app Notification row and sends an email as the
 * no-reply mailbox through the Graph adapter, in the person's own language
 * with their company's branding. The Teams activity feed is the adapter's
 * `sendActivityNotification`, stubbed: nothing calls it until the Teams app
 * exists.
 *
 * `data` is the template's variables, with two reserved keys:
 *   link        "#tickets/<id>": where the notification leads
 *   dedupeKey   the same key reaches a person once per channel (SLA alerts)
 * A variable is a string or an { en, ar } pair (names differ by language).
 *
 * This never throws for a delivery problem: the business action it reports on
 * has already happened, and a failed email must not undo or fail it. Failures
 * are logged, and an email that did not go leaves no row, so a keyed alert is
 * tried again next time. An unknown template is a bug and does throw.
 *
 * Who is told is the caller's decision; the template list and categories are
 * frontend/assets/js/notification-text.js. Nothing here reads a company
 * scope: the recipients are exactly the ids it is given.
 */

import { TEMPLATES } from '../../../frontend/assets/js/notification-text.js';
import { env } from '../config/env.js';
import { renderEmail } from '../modules/notifications/email.js';
import { logger } from './logger.js';

const CONCURRENCY = 8;
const unique = (list) => [...new Set(list.filter(Boolean))];

/**
 * @param {object} deps
 * @param {object} deps.store  see modules/notifications/store-prisma.js
 * @param {() => Promise<import('../integrations/graph/index.js').GraphClient>} deps.getGraph
 * @param {{ NOREPLY_MAILBOX: string, APP_BASE_URL: string }} [deps.config]
 * @param {() => Date} [deps.now]
 * @param {{ warn: Function }} [deps.log]
 */
export function createNotifier({
  store,
  getGraph,
  config = env,
  now = () => new Date(),
  log = logger,
}) {
  /**
   * @param {string[]} userIds
   * @param {string} templateKey
   * @param {Record<string, unknown>} [data]
   * @returns {Promise<{ inApp: number, email: number }>} what was delivered
   */
  async function notify(userIds, templateKey, data = {}) {
    const category = TEMPLATES[templateKey];
    if (!category) throw new Error(`Unknown notification template: ${templateKey}`);

    const sent = { inApp: 0, email: 0 };
    const { link = null, dedupeKey = null, ...vars } = data;
    const payload = { link, vars };

    try {
      const ids = unique(userIds);
      if (ids.length === 0) return sent;

      const recipients = (await store.getRecipients(ids)).filter((r) => r.isActive);
      const [preferences, companies] = await Promise.all([
        store.getPreferences(recipients.map((r) => r.id)),
        store.getCompanies(unique(recipients.map((r) => r.companyId))),
      ]);
      const off = new Set(
        preferences
          .filter((p) => p.category === category && !p.enabled)
          .map((p) => `${p.userId}|${p.channel}`)
      );
      const companyById = new Map(companies.map((c) => [c.id, c]));

      async function tell(recipient) {
        const wants = (channel) => !off.has(`${recipient.id}|${channel}`);
        const done = dedupeKey ? await store.channelsDone(recipient.id, dedupeKey) : [];
        const at = now();
        const row = (channel) => ({
          userId: recipient.id,
          companyId: recipient.companyId,
          channel,
          templateKey,
          payload: JSON.stringify(payload),
          dedupeKey,
          sentAt: at,
          createdAt: at,
        });

        if (wants('inApp') && !done.includes('inApp')) {
          await store.insertNotification(row('inApp'));
          sent.inApp += 1;
        }

        if (wants('email') && !done.includes('email') && recipient.email) {
          const company = companyById.get(recipient.companyId);
          if (!company) return;
          const mail = renderEmail({
            templateKey,
            payload,
            language: recipient.language,
            company,
            baseUrl: config.APP_BASE_URL,
          });
          const graph = await getGraph();
          await graph.sendMail({
            from: config.NOREPLY_MAILBOX,
            to: [recipient.email],
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
          });
          await store.insertNotification(row('email'));
          sent.email += 1;
        }
      }

      // A few at a time: an announcement to a company is hundreds of mails.
      for (let i = 0; i < recipients.length; i += CONCURRENCY) {
        const batch = recipients.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(tell));
        results.forEach((result, n) => {
          if (result.status === 'rejected') {
            log.warn(
              { err: result.reason, templateKey, userId: batch[n].id },
              'notification not delivered'
            );
          }
        });
      }
    } catch (err) {
      log.warn({ err, templateKey }, 'notification not delivered');
    }
    return sent;
  }

  return notify;
}

/** A notifier that does nothing, for a service built without one. */
export const silentNotify = async () => ({ inApp: 0, email: 0 });
