/**
 * notification-text.js — what a notification says, in one place for both
 * sides: the bell and the notification centre draw it in the page's language,
 * and the backend writes the same words into the email (lib/notify.js reads
 * the same assets/i18n files). Like markdown.js and accent.js, it imports
 * nothing, so the backend can load it too.
 *
 * A notification row holds a template key ("ticket.assigned") and a payload:
 *
 *   { link: "#tickets/<id>", vars: { number: "IT-2026-00042", subject: "…",
 *                                    actor: { en: "Omar", ar: "عمر" } } }
 *
 * A var is a string, or an { en, ar } pair where the words differ by language
 * (names, room names). The strings are under notification.tpl.<key> in the
 * i18n files: `title` always, `detail` when there is a second line. A detail
 * whose placeholders are not all present is left out.
 */

/** Template key → the category a person switches on or off. */
export const TEMPLATES = Object.freeze({
  'ticket.created': 'tickets',
  'ticket.assigned': 'tickets',
  'ticket.comment': 'tickets',
  'ticket.status': 'tickets',
  'ticket.resolved': 'tickets',
  'ticket.confirmReminder': 'tickets',
  'ticket.confirmed': 'tickets',
  'ticket.notSolved': 'tickets',
  'ticket.slaAtRisk': 'tickets',
  'ticket.slaBreached': 'tickets',
  'booking.confirmed': 'bookings',
  'booking.cancelled': 'bookings',
  'booking.moved': 'bookings',
  'announcement.pinned': 'announcements',
  'file.infected': 'tickets',
});

export const CATEGORIES = Object.freeze(['tickets', 'bookings', 'announcements']);
export const CHANNELS = Object.freeze(['inApp', 'email']);

/** A var in one language. */
export function pick(value, lang) {
  if (value && typeof value === 'object') return String(value[lang] ?? value.en ?? '');
  return value == null ? '' : String(value);
}

/** Every var as a plain string in `lang`. */
export function resolveVars(vars = {}, lang) {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, pick(v, lang)]));
}

/**
 * The words of one notification.
 * @param {string} templateKey
 * @param {{ vars?: Record<string, unknown> }} payload
 * @param {string} lang  'en' | 'ar'
 * @param {(key: string, vars?: Record<string, string>) => string} translate
 *   i18n.js's `t`, or the server's equivalent; returns the key itself when missing
 * @returns {{ title: string, detail: string | null }}
 */
export function describe(templateKey, payload, lang, translate) {
  const vars = resolveVars(payload?.vars, lang);
  const titleKey = `notification.tpl.${templateKey}.title`;
  const detailKey = `notification.tpl.${templateKey}.detail`;

  const rawDetail = translate(detailKey);
  let detail = null;
  if (rawDetail !== detailKey) {
    const wanted = [...rawDetail.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (wanted.every((name) => vars[name])) detail = translate(detailKey, vars);
  }
  return { title: translate(titleKey, vars), detail };
}
