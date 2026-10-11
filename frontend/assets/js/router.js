/**
 * router.js — which page the address asks for, and putting it on screen.
 *
 * Addresses are hashes (#tickets/GEN-2026-00042?tab=mine), so the server only
 * ever serves index.html and a reload on site costs nothing extra. The first
 * segment names the route; the rest are the page's own parameters.
 *
 * A page is a module in assets/js/pages/ that exports
 *
 *   render(root, ctx)  →  optionally a function that tidies up when it leaves
 *
 * and is fetched the first time it is asked for, so the shell paints first on
 * a weak connection. Three addresses never reach their own module:
 *
 *   - no such route                         → "page not found"
 *   - a route this person's nav leaves out  → "no access"
 *   - a route whose module is not built yet → "not open yet"
 *
 * "No access" is courtesy, not security: the nav comes from GET /api/me, and
 * every API route behind a page checks the session for itself.
 */

import { loadFailedNotice } from './components/notice.js';
import { homeSkeleton, pageSkeleton } from './components/skeleton.js';

const PAGES = new URL('./pages/', import.meta.url);
const DEFAULT_ROUTE = 'home';

/**
 * Every address the portal has. `nav` is the key GET /api/me lists when the
 * person may open it (null: open to anyone signed in). `page` is the module
 * in pages/; null until that module's session builds it.
 */
const ROUTES = {
  home: { nav: 'home', title: 'nav.home', page: 'home', skeleton: homeSkeleton },
  announcements: { nav: 'announcements', title: 'nav.announcements', page: 'announcements' },
  rooms: { nav: 'rooms', title: 'nav.rooms', page: null },
  tickets: { nav: 'tickets', title: 'nav.tickets', page: null },
  directory: { nav: 'directory', title: 'nav.directory', page: 'directory' },
  admin: { nav: 'admin', title: 'nav.admin', page: 'admin' },
  'audit-log': { nav: 'auditLog', title: 'nav.auditLog', page: 'audit-log' },
  notifications: { nav: null, title: 'nav.notifications', page: null },
};

function decode(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    // A stray "%" typed by hand: take it as written.
    return part;
  }
}

/** "#tickets/new?team=it" → { name: 'tickets', params: ['new'], query } */
function parseHash(hash) {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const [name = DEFAULT_ROUTE, ...params] = path.split('/').filter(Boolean).map(decode);
  return { name, params, query: new URLSearchParams(search) };
}

/**
 * @typedef {object} Match
 * @property {string} name  the route asked for
 * @property {string[]} params
 * @property {URLSearchParams} query
 * @property {'ok'|'notFound'|'noAccess'|'pending'} status
 * @property {string} page  the module that will draw it
 * @property {string} title  an i18n key
 * @property {string|null} nav  the nav item to mark as current
 * @property {() => string} skeleton
 */

/**
 * @param {object} options
 * @param {HTMLElement} options.root  where pages render
 * @param {(navKey: string) => boolean} options.canAccess
 * @param {() => object} options.context  what every page is handed, read fresh on each render
 * @param {(match: Match) => void} [options.onNavigate]  the shell's chance to mark where we are
 */
export function createRouter({ root, canAccess, context, onNavigate }) {
  /** Counts renders, so a slow page that lands late cannot overwrite a newer one. */
  let turn = 0;
  let cleanup = null;

  /** @returns {Match} */
  function resolve() {
    const asked = parseHash(location.hash);
    const route = Object.hasOwn(ROUTES, asked.name) ? ROUTES[asked.name] : null;
    const status = !route
      ? 'notFound'
      : route.nav && !canAccess(route.nav)
        ? 'noAccess'
        : route.page
          ? 'ok'
          : 'pending';

    return {
      ...asked,
      status,
      page: status === 'ok' ? route.page : 'status',
      title: status === 'ok' || status === 'pending' ? route.title : `page.${status}.title`,
      // A page they may not open is not "where they are" in the nav.
      nav: status === 'ok' || status === 'pending' ? route.nav : null,
      skeleton: (status === 'ok' && route.skeleton) || pageSkeleton,
    };
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.keep]  redraw over what is showing, without a
   *   skeleton in between: the same page in another language or company
   * @param {number} [options.attempt]  set by "Try again"
   */
  async function render({ keep = false, attempt = 0 } = {}) {
    const match = resolve();
    const mine = ++turn;

    cleanup?.();
    cleanup = null;
    onNavigate?.(match);
    if (!keep || !root.firstElementChild) root.innerHTML = match.skeleton();

    try {
      const url = new URL(`${match.page}.js`, PAGES);
      // A module that failed to load may stay failed under the same address.
      if (attempt) url.searchParams.set('retry', String(attempt));
      const page = await import(url.href);
      if (mine !== turn) return;

      const leave = await page.render(root, { ...context(), route: match });
      if (typeof leave !== 'function') return;
      if (mine === turn) cleanup = leave;
      else leave();
    } catch {
      if (mine !== turn) return;
      root.innerHTML = loadFailedNotice();
      root
        .querySelector('[data-retry]')
        .addEventListener('click', () => render({ attempt: attempt + 1 }));
    }
  }

  window.addEventListener('hashchange', async () => {
    window.scrollTo(0, 0);
    await render();
    // A new page starts at its top for a keyboard and a screen reader too.
    root.closest('main')?.focus({ preventScroll: true });
  });

  return {
    /** Draws the page the address names now. */
    start: () => render(),
    /** Draws the current page again: the language or the company changed. */
    refresh: () => render({ keep: true }),
  };
}
