/**
 * html.js — the one escape every template literal goes through.
 *
 * Pages build their markup as strings. Anything that came from data, from the
 * address bar or from a translation file passes through esc() on the way in.
 */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} value */
export const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);

/**
 * Ticket numbers (IT-2026-00042) in already-escaped text, each kept on one
 * line: a hyphen is otherwise a place the line may break. Left to right inside
 * right-to-left text too.
 * @param {string} escaped
 */
export const keepTicketNumbers = (escaped) =>
  escaped.replace(
    /\b[A-Z]{2,5}-\d{4}-\d{4,}\b/g,
    (number) => `<bdi dir="ltr" class="ticket-no">${number}</bdi>`
  );
