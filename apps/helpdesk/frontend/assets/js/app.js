/**
 * app.js — the IT Helpdesk's shell (index.html, D144).
 *
 * One page for everyone who signs in:
 *
 *   #tickets             my tickets          everyone
 *   #tickets/new         a new ticket        everyone
 *   #tickets/<id>        one ticket          its requester, and the IT team
 *   #queue, #assigned    the IT team's work  IT agents and leads
 *   #reports             how the team did    IT agents and leads
 *   #settings            IT settings         IT leads
 *   #admin[/<section>]   Administration      the helpdesk's HoldingAdmins
 *   #notifications       the bell's page     everyone
 *
 * Two plain links are published (docs/DEPLOY.md): /new for every employee and
 * /queue for the IT team. The server answers both with this page and
 * settleEntryAddress() turns them into the addresses above.
 *
 * Who is signed in, and which of these they may open, comes from GET /api/me;
 * every API route behind a page checks for itself. The design system, the
 * strings and the ticket pages are shared with the portal (packages/shared/
 * web), so Arabic and right-to-left work the same way here.
 */

import { DEFAULT_LOCALE, LOCALES, getLocale, localized, setLocale, t } from './i18n.js';
import { loadSession, signOut } from './auth.js';
import { startServiceWorker } from './pwa.js';
import { createRouter } from './router.js';
import { initBell, redrawBell } from './components/bell.js';
import { injectSprite } from './components/icons.js';
import { initials } from './components/initials.js';
import { loadFailedNotice } from './components/notice.js';
import { closeMenu, initPopover } from './components/popover.js';
import { pageSkeleton } from './components/skeleton.js';
import { createStatusBanner } from './components/status-banner.js';
import { initDateInputs } from './date-inputs.js';

const STORED_LOCALE_KEY = 'mgp.locale';

/**
 * The addresses (router.js). `nav` names the area a route belongs to, which
 * canAccess() checks; the dev page lists what the mocked Graph "sent".
 */
const ROUTES = {
  tickets: { nav: 'tickets', title: 'hdApp.nav.mine', page: 'requests' },
  queue: { nav: 'it', title: 'hd.nav.queue', page: 'helpdesk/queue' },
  assigned: { nav: 'it', title: 'hd.nav.assigned', page: 'helpdesk/queue' },
  reports: { nav: 'it', title: 'hd.nav.reports', page: 'helpdesk/reports' },
  settings: { nav: 'lead', title: 'hd.nav.settings', page: 'helpdesk/settings' },
  admin: { nav: 'admin', title: 'hdApp.nav.admin', page: 'administration' },
  notifications: { nav: null, title: 'nav.notifications', page: 'notifications' },
  dev: { nav: null, title: 'nav.devOutbox', page: 'dev-outbox' },
};

const state = {
  /** @type {object | null} */
  user: null,
  company: null,
  /** 'Lead' | 'Agent' | null */
  it: null,
  admin: false,
  portalUrl: null,
};

/** Background reads (the bell) share one signal, which sign-out cancels. */
const background = new AbortController();
const backgroundSignal = () => background.signal;

let router = null;
let banner = null;

/** The areas this person may open. */
function canAccess(area) {
  if (area === 'tickets') return true;
  if (area === 'it') return Boolean(state.it);
  if (area === 'lead') return state.it === 'Lead';
  if (area === 'admin') return state.admin;
  return false;
}

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice just will not stick.
  }
}

/* -------------------------------------------------------------- language */

/** The portal's rule: this device's choice, then the profile's, then the browser's. */
function preferredLocale() {
  const profile = state.user?.language;
  return (
    readStored(STORED_LOCALE_KEY) ??
    (profile in LOCALES ? profile : null) ??
    (navigator.language?.startsWith('ar') ? 'ar' : DEFAULT_LOCALE)
  );
}

async function applyLanguage(lang) {
  await setLocale(lang);
  writeStored(STORED_LOCALE_KEY, getLocale());
  renderShellData();
  for (const item of document.querySelectorAll('#userMenu [data-lang]')) {
    item.setAttribute('aria-current', String(item.dataset.lang === getLocale()));
  }
  await router?.refresh();
}

function initLanguageMenu() {
  for (const item of document.querySelectorAll('#userMenu [data-lang]')) {
    item.addEventListener('click', () => {
      applyLanguage(item.dataset.lang);
      closeMenu('userMenu');
    });
  }
}

/* ------------------------------------------------------------- shell data */

/** What the account menu says the person is here. */
function roleLabel() {
  if (state.it) return t(`tk.cfg.role.${state.it}`);
  return t(state.admin ? 'hdApp.role.admin' : 'hdApp.role.user');
}

function renderShellData() {
  const name = localized(state.user, 'displayName');
  // The company's accent, as in the portal: every screen works with any.
  document.documentElement.style.setProperty('--brand-accent', state.company.accentColor);
  document.getElementById('userAvatar').textContent = initials(name);
  document.getElementById('userMenuName').textContent = name;
  document.getElementById('menuUserName').textContent = name;
  document.getElementById('menuUserRole').textContent = roleLabel();
  for (const link of document.querySelectorAll('[data-for]')) {
    link.hidden = !canAccess(link.dataset.for);
  }
  for (const id of ['portalLink', 'portalMenuLink']) {
    const link = document.getElementById(id);
    link.hidden = !state.portalUrl;
    if (state.portalUrl) link.href = state.portalUrl;
  }
  redrawBell();
}

/* -------------------------------------------------------------------- page */

function pageContext() {
  const name = localized(state.user, 'displayName');
  return {
    company: state.company,
    user: { id: state.user.id, name, firstName: name.trim().split(/\s+/)[0] ?? name },
    admin: state.admin,
    // The IT team's pages read their role here; null for everyone else.
    helpdesk: state.it ? { role: state.it } : null,
  };
}

/** Which link is lit: a ticket opened from a list keeps that list lit. */
function litLink(match) {
  if (match.name === 'tickets') {
    const [first] = match.params;
    if (first === 'new') return 'new';
    const from = match.query.get('from');
    if (first && (from === 'queue' || from === 'assigned')) return from;
    return 'mine';
  }
  if (match.name === 'notifications' || match.name === 'dev') return null;
  return match.name;
}

function markLocation(match) {
  const lit = match.status === 'ok' ? litLink(match) : null;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === lit) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = t('page.title', { page: t(match.title), app: t('hd.name') });
  for (const menu of document.querySelectorAll('.menu')) closeMenu(menu.id);
}

/* -------------------------------------------------------------------- boot */

/**
 * The published links and the bare address, settled before the first page is
 * drawn (replaceState, so Back does not return to the link):
 *
 *   /new                 the New ticket form, for everyone
 *   /queue               the Queue for the IT team; anyone else gets /new, quietly
 *   / with no #address   the IT team's Queue, everyone else's New ticket form
 *
 * Any other address, an old #tickets/<id> link included, is left as it is.
 */
function settleEntryAddress() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const own = state.it ? '#queue' : '#tickets/new';
  let hash = null;
  if (path === '/new') hash = '#tickets/new';
  else if (path === '/queue') hash = own;
  else if (
    (path === '/' || path === '/index.html') &&
    (location.hash === '' || location.hash === '#')
  ) {
    hash = own;
  }
  if (hash) history.replaceState(null, '', `/${hash}`);
}

function initSkipLink() {
  document.querySelector('.u-skip-link').addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('main').focus();
  });
}

function initSignOut() {
  const button = document.getElementById('signOutBtn');
  button.addEventListener('click', async () => {
    if (button.getAttribute('aria-busy') === 'true') return;
    button.setAttribute('aria-busy', 'true');
    background.abort();
    await signOut();
  });
}

/**
 * The worker (sw.js) shows a saved answer when the network is slow or gone:
 * say so, with a way to ask again, and offer a new version without forcing it.
 */
function initOfflineState(serviceWorker) {
  banner = createStatusBanner(document.getElementById('statusBanner'));
  const retry = () => {
    banner.hideOffline();
    router?.refresh();
  };
  const showOffline = () => banner.showOffline(retry);
  startServiceWorker({
    enabled: serviceWorker,
    onSavedAnswer: showOffline,
    onUpdateReady: (apply) => banner.showUpdate(apply),
  });
  window.addEventListener('offline', showOffline);
  window.addEventListener('online', () => banner.hideOffline());
  if (!navigator.onLine) showOffline();
}

function showBootError() {
  const page = document.getElementById('page');
  page.innerHTML = loadFailedNotice();
  page.querySelector('[data-retry]').addEventListener('click', () => location.reload());
}

async function init() {
  injectSprite();
  await setLocale(preferredLocale());
  document.getElementById('page').innerHTML = pageSkeleton();

  let me;
  try {
    me = await loadSession();
  } catch {
    showBootError();
    return;
  }

  state.user = me.user;
  state.company = me.company;
  state.it = me.helpdesk?.role ?? null;
  state.admin = me.admin === true;
  state.portalUrl = me.portalUrl ?? null;

  settleEntryAddress();
  router = createRouter({
    root: document.getElementById('page'),
    routes: ROUTES,
    // The IT team starts on the queue; everyone else on their own tickets.
    defaultRoute: state.it ? 'queue' : 'tickets',
    canAccess,
    context: pageContext,
    onNavigate: markLocation,
  });

  await applyLanguage(preferredLocale());
  delete document.querySelector('.app').dataset.booting;

  initLanguageMenu();
  initPopover('notifBtn', 'notifMenu');
  initBell({ signal: backgroundSignal });
  initPopover('userMenuBtn', 'userMenu');
  initSignOut();
  initSkipLink();
  initDateInputs();
  initOfflineState(me.serviceWorker === true);
}

init();
