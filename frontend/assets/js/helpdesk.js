/**
 * helpdesk.js — the IT Helpdesk's shell (helpdesk.html, D135).
 *
 * The IT team's own workspace: a header with the Helpdesk's name, its four
 * destinations (Queue, My assigned tickets, Reports and, for IT Leads, IT
 * settings), the bell and the account menu with the language switch. There is
 * no way from here into the portal: IT team members have none.
 *
 * Who is signed in comes from GET /api/me, as in the portal. Anyone not on
 * the IT team is turned away by the server before this page loads; should
 * that change while the page is open, the API answers 403 and the page says
 * so. The design system, the language files and the page modules are the
 * portal's, so Arabic and right-to-left work the same way here.
 */

import { DEFAULT_LOCALE, LOCALES, getLocale, localized, setLocale, t } from './i18n.js';
import { loadSession, signOut } from './auth.js';
import { createRouter } from './router.js';
import { initBell, redrawBell } from './components/bell.js';
import { injectSprite } from './components/icons.js';
import { initials } from './components/initials.js';
import { loadFailedNotice, notice } from './components/notice.js';
import { closeMenu, initPopover } from './components/popover.js';
import { pageSkeleton } from './components/skeleton.js';
import { initDateInputs } from './date-inputs.js';

const STORED_LOCALE_KEY = 'mgp.locale';

/**
 * The Helpdesk's addresses (router.js). `nav` names the link that is lit;
 * `settings` is for IT Leads only. A ticket (#tickets/<id>), a new ticket
 * for oneself (#tickets/new), one's own tickets (#tickets) and the
 * notification centre have no link of their own.
 */
const ROUTES = {
  queue: { nav: 'queue', title: 'hd.nav.queue', page: 'helpdesk/queue' },
  assigned: { nav: 'assigned', title: 'hd.nav.assigned', page: 'helpdesk/queue' },
  reports: { nav: 'reports', title: 'hd.nav.reports', page: 'helpdesk/reports' },
  settings: { nav: 'settings', title: 'hd.nav.settings', page: 'helpdesk/settings' },
  tickets: { nav: null, title: 'nav.tickets', page: 'helpdesk/ticket' },
  notifications: { nav: null, title: 'nav.notifications', page: 'notifications' },
};

const state = {
  /** @type {object | null} */
  user: null,
  company: null,
  /** 'Lead' | 'Agent' */
  role: null,
};

/** Background reads (the bell) share one signal, which sign-out cancels. */
const background = new AbortController();
const backgroundSignal = () => background.signal;

let router = null;

const isLead = () => state.role === 'Lead';

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

function renderShellData() {
  const name = localized(state.user, 'displayName');
  // The company's accent, as in the portal: every screen works with any.
  document.documentElement.style.setProperty('--brand-accent', state.company.accentColor);
  document.getElementById('userAvatar').textContent = initials(name);
  document.getElementById('userMenuName').textContent = name;
  document.getElementById('menuUserName').textContent = name;
  document.getElementById('menuUserRole').textContent = t(`tk.cfg.role.${state.role}`);
  for (const link of document.querySelectorAll('[data-nav="settings"]')) {
    link.hidden = !isLead();
  }
  redrawBell();
}

/* -------------------------------------------------------------------- page */

function pageContext() {
  const name = localized(state.user, 'displayName');
  return {
    company: state.company,
    user: { id: state.user.id, name, firstName: name.trim().split(/\s+/)[0] ?? name },
    admin: false,
    helpdesk: { role: state.role },
  };
}

/** Marks where we are: a ticket opened from a list keeps that list lit. */
function markLocation(match) {
  const from = match.name === 'tickets' ? match.query.get('from') : null;
  const lit = match.nav ?? (from === 'assigned' ? 'assigned' : from ? 'queue' : null);
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === lit) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = t('page.title', { page: t(match.title), app: t('hd.name') });
  for (const menu of document.querySelectorAll('.menu')) closeMenu(menu.id);
}

/* -------------------------------------------------------------------- boot */

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

  // Not (or no longer) on the IT team: this is not their page. The server
  // normally says so before this script runs.
  if (!me.helpdesk) {
    document.getElementById('page').innerHTML = notice({
      tone: 'info',
      mark: 'lock',
      titleKey: 'hd.noAccess.title',
      textKey: 'hd.noAccess.text',
    });
    return;
  }

  state.user = me.user;
  state.company = me.company;
  state.role = me.helpdesk.role;

  router = createRouter({
    root: document.getElementById('page'),
    routes: ROUTES,
    defaultRoute: 'queue',
    canAccess: (navKey) => navKey !== 'settings' || isLead(),
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
}

init();
