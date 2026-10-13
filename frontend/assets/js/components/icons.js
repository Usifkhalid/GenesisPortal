/**
 * icons.js — the portal's icon set.
 *
 * Drawn geometry, not a font and not emoji. Every glyph sits on the same 24px
 * grid and inherits its stroke weight, caps and joins from base.css, so the
 * whole set stays one family at any size.
 *
 * Usage:
 *   import { injectSprite, icon } from './components/icons.js';
 *   injectSprite();                       // once per page
 *   el.innerHTML = icon('check', 'btn__icon');
 *   // or in markup: <svg class="btn__icon"><use href="#i-check"/></svg>
 *
 * Icons that point somewhere must be marked .icon--dir in the markup so they
 * mirror in Arabic. Symmetrical icons must not carry it.
 */

/** @type {Record<string, string>} name -> inner SVG markup on a 24x24 grid */
const PATHS = {
  // --- Navigation ---------------------------------------------------------
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z"/>',
  announcements:
    '<path d="M4 9v6h3l6 4V5L7 9H4Z"/><path d="M17 9.5a4 4 0 0 1 0 5"/><path d="M19.5 7a7.5 7.5 0 0 1 0 10"/>',
  directory:
    '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5"/><path d="M17.5 14.5a5.5 5.5 0 0 1 3 4"/>',
  rooms:
    '<path d="M4 20V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15"/><path d="M15 9h4a1 1 0 0 1 1 1v10"/><path d="M3 20h18"/><circle cx="11.5" cy="12" r="1"/>',
  tickets:
    '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h15A1.5 1.5 0 0 1 21 8.5v2a2.5 2.5 0 0 0 0 5v2A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-2a2.5 2.5 0 0 0 0-5Z"/><path d="M12 9v1.5M12 13.5V15"/>',
  admin:
    '<path d="M12 3.5 5 6v5.5c0 4 2.9 7.4 7 8.5 4.1-1.1 7-4.5 7-8.5V6Z"/><path d="M9.5 12l1.8 1.8L15 10"/>',
  auditLog:
    '<path d="M6 3.5h8.5L19 8v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h5"/><path d="M8.5 12.5h7M8.5 16h4.5"/>',
  notifications:
    '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3.5.9 5 2 6H4.5c1.1-1 2-2.5 2-6Z"/><path d="M10 19a2.2 2.2 0 0 0 4 0"/>',

  // --- Controls -----------------------------------------------------------
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M4.5 12.5 9 17 19.5 6.5"/>',
  chevronDown: '<path d="M6 9.5 12 15.5 18 9.5"/>',
  chevronEnd: '<path d="M9.5 5 16.5 12 9.5 19"/>',
  // The mirror of chevronEnd: "back". Directional too, so it flips in Arabic.
  chevronStart: '<path d="M14.5 5 7.5 12 14.5 19"/>',
  arrowUp: '<path d="M12 19V5"/><path d="M6.5 10.5 12 5l5.5 5.5"/>',
  // Up and towards the end of the line: "open this". Directional, so mark it .icon--dir.
  arrowUpEnd: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
  // The picker's chevron pair: this control switches between a set of things.
  chevronsUpDown: '<path d="M8 9.5 12 5.5l4 4"/><path d="M8 14.5l4 4 4-4"/>',
  image:
    '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M4 16.5l4.5-4 3.5 3 3-2.5 5 4.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  copy:
    '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M15.5 9V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5v8.5A1.5 1.5 0 0 0 5.5 15.5H9"/>',
  upload: '<path d="M12 16V5"/><path d="M7.5 9.5 12 5l4.5 4.5"/><path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  signOut:
    '<path d="M10 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h4"/><path d="M14 8.5 17.5 12 14 15.5"/><path d="M17.5 12h-8"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',

  // --- Status. Each state has its own shape as well as its own colour. ----
  statusOpen: '<circle cx="12" cy="12" r="7.5"/>',
  statusProgress: '<circle cx="12" cy="12" r="7.5"/><path d="M12 7.5v4.5l3 2"/>',
  statusResolved: '<circle cx="12" cy="12" r="7.5"/><path d="M8.5 12.2 11 14.5l4.5-4.5"/>',
  statusWaiting: '<circle cx="12" cy="12" r="7.5"/><path d="M9 12h6"/>',
  statusOverdue:
    '<path d="M10.7 4.6a1.5 1.5 0 0 1 2.6 0l7 12.2a1.5 1.5 0 0 1-1.3 2.2H5a1.5 1.5 0 0 1-1.3-2.2Z"/><path d="M12 9.5v4"/><circle cx="12" cy="16.3" r="0.9"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5.5"/><circle cx="12" cy="8.2" r="0.9"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3.2 2"/>',
  calendar:
    '<rect x="4" y="6" width="16" height="14" rx="1.5"/><path d="M4 10.5h16"/><path d="M8.5 4v4M15.5 4v4"/>',

  /**
   * The empty-state mark: a specimen label with nothing written on it. Drawn
   * geometry from the design's own idea, not an illustration.
   */
  mail: '<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/>',
  phone:
    '<path d="M6.5 4.5h3l1.5 4-2 1.2a10 10 0 0 0 5.3 5.3l1.2-2 4 1.5v3a1.5 1.5 0 0 1-1.5 1.5A14.5 14.5 0 0 1 5 6a1.5 1.5 0 0 1 1.5-1.5Z"/>',
  chat: '<path d="M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5v-3.5H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"/>',
  download:
    '<path d="M12 5v10"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M5 19h14"/>',
  refresh:
    '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 5v4.5h-4.5"/>',
  // --- Ticket categories and the helpdesk ---------------------------------
  laptop:
    '<rect x="5" y="5.5" width="14" height="9.5" rx="1.2"/><path d="M3 18.5h18l-1.2-3.5H4.2Z"/>',
  printer:
    '<path d="M7.5 9V4.5h9V9"/><rect x="4" y="9" width="16" height="7.5" rx="1.5"/><path d="M7.5 14h9v5.5h-9Z"/>',
  wifi:
    '<path d="M3.5 9.5a12.5 12.5 0 0 1 17 0"/><path d="M6.5 13a8 8 0 0 1 11 0"/><path d="M9.5 16.3a3.5 3.5 0 0 1 5 0"/><circle cx="12" cy="19" r="0.9"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5 19 4"/><path d="M16 7l2.5 2.5"/><path d="M13.5 9.5 15.5 11.5"/>',
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><path d="M16.7 13.5v6.5M13.5 16.7H20"/>',
  box: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z"/><path d="M4 8.5 12 13l8-4.5M12 13v7"/>',
  help: '<circle cx="12" cy="12" r="8"/><path d="M9.7 9.7a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.9-1.1 1.7"/><circle cx="12" cy="16.6" r="0.9"/>',
  paperclip:
    '<path d="M18.5 11.5 11 19a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.2 4.2l-8 8a1.5 1.5 0 0 1-2.1-2.1l7.3-7.3"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  send: '<path d="M4 12 20 4l-4.5 16-3.5-6.5Z"/><path d="M12 13.5 20 4"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
  blankLabel:
    '<path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v11A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5Z"/><path d="M5 10.5h14"/><path d="M8 14h3"/>',
};

export const ICON_NAMES = Object.freeze(Object.keys(PATHS));

/** The sprite, as one hidden <svg> holding a <symbol> per icon. */
export const ICON_SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false" class="icon-sprite">${Object.entries(
  PATHS
)
  .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
  .join('')}</svg>`;

/** Adds the sprite to the document once. Safe to call repeatedly. */
export function injectSprite(doc = document) {
  if (doc.getElementById('icon-sprite')) return;
  const holder = doc.createElement('div');
  holder.id = 'icon-sprite';
  holder.hidden = true;
  holder.innerHTML = ICON_SPRITE;
  doc.body.prepend(holder);
}

/**
 * Markup for one icon. Icons are decorative by default: the control around
 * them carries the accessible name, so a duplicate label is noise.
 *
 * @param {string} name   a key from ICON_NAMES
 * @param {string} [className]
 * @param {{ directional?: boolean }} [options] directional icons mirror in RTL
 */
export function icon(name, className = '', options = {}) {
  const classes = [className, options.directional ? 'icon--dir' : '']
    .filter(Boolean)
    .join(' ');
  return `<svg${classes ? ` class="${classes}"` : ''} aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}
