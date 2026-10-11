/**
 * html.js — the one escape every template literal goes through.
 *
 * Pages build their markup as strings. Anything that came from data, from the
 * address bar or from a translation file passes through esc() on the way in.
 */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} value */
export const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
