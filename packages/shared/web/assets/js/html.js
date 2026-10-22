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
 * The Content-Security-Policy allows no inline styles, so markup never carries
 * a style attribute. A template that needs a per-element value (a position, a
 * swatch colour) writes it as data-css="--at:25%;--size:10%" and the page
 * calls applyCss on the container once the markup is in the document: the
 * values are then set through the CSS object model, which the policy permits.
 * @param {ParentNode} root
 */
export function applyCss(root) {
  for (const el of root.querySelectorAll('[data-css]')) {
    for (const declaration of el.dataset.css.split(';')) {
      const at = declaration.indexOf(':');
      if (at > 0) {
        el.style.setProperty(declaration.slice(0, at).trim(), declaration.slice(at + 1).trim());
      }
    }
    el.removeAttribute('data-css');
  }
}

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
