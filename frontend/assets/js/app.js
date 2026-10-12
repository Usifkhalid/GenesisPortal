/**
 * app.js — the portal's app shell.
 *
 * Asks the server who is signed in (GET /api/me) before it draws anything of
 * theirs; with no session the browser is sent to the login page. The person,
 * their company's branding, the companies they may switch between and the
 * navigation they may see all come from that one answer. Then it wires the top
 * bar, the rail/bottom-nav pair and the company switcher, and hands the work
 * area to router.js, which draws the page the address names.
 *
 * DEMO: the two notifications in the bell are samples, until notifications
 * have an API.
 */

import { DEFAULT_LOCALE, LOCALES, setLocale, getLocale, localized, t } from './i18n.js';
import { api } from './api.js';
import { loadSession, signOut } from './auth.js';
import { createRouter } from './router.js';
import { loadFailedNotice } from './components/notice.js';
import { pageSkeleton } from './components/skeleton.js';
import { injectSprite, icon } from './components/icons.js';
import { companyMark, companyName, fillCompanyMark } from './components/company-mark.js';
import { initials } from './components/initials.js';
import { initPeopleSearch } from './components/people-search.js';

const STORED_LOCALE_KEY = 'mgp.locale';
const STORED_RAIL_KEY = 'mgp.railCollapsed';
const STORED_COMPANY_KEY = 'mgp.company';

/** Filled from GET /api/me by init(). */
const state = {
  /** @type {object | null} the signed-in person */
  user: null,
  /** The companies this person may work in. */
  companies: [],
  /** The one the shell is showing now. */
  company: null,
  /** @type {{ key: string, group: string }[]} what the server lets them see */
  nav: [],
};

/** Draws the page the address names. Made by init(), once the session is known. */
let router = null;

/** Admin navigation is the server's call: it sends the group or it does not. */
const isAdmin = () => state.nav.some((item) => item.group === 'admin');

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private mode or blocked storage: fall through to the default.
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

/**
 * A language chosen on this device wins; then the one on the person's
 * profile; then the browser's.
 */
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
  updateSearchPlaceholder();
  // Everything below holds content that data-i18n cannot reach on its own:
  // names and counts that come from data, and state such as the current
  // language or company.
  renderShellData();
  drawAnnouncementCount();
  updateLanguageMenu();
  await router?.refresh();
}

/** Marks the active language in the account menu's language rows. */
function updateLanguageMenu() {
  const current = getLocale();
  for (const item of document.querySelectorAll('#userMenu [data-lang]')) {
    item.setAttribute('aria-current', String(item.dataset.lang === current));
  }
}

function initLanguageMenu() {
  for (const item of document.querySelectorAll('#userMenu [data-lang]')) {
    item.addEventListener('click', () => {
      applyLanguage(item.dataset.lang);
      closeMenu('userMenu');
    });
  }
}

/* ------------------------------------------------------- company branding */

/**
 * Applies a company's accent colour and logo as CSS variables and content.
 * A Company record supplies exactly one colour; every other brand value in
 * tokens.css is derived from it. A missing logo falls back to the company's
 * short name on that colour, so the shell is never broken by missing evidence.
 *
 * @param {{ code: string, nameEn: string, nameAr: string, accentColor: string, logoUrl: string|null }} company
 */
function applyCompanyBranding(company) {
  document.documentElement.style.setProperty('--brand-accent', company.accentColor);

  for (const mark of document.querySelectorAll('[data-company-mark]')) {
    fillCompanyMark(mark, company);
  }

  for (const name of document.querySelectorAll('[data-company-name]')) {
    name.textContent = localized(company);
  }

  // The switcher's name says what it holds now and what pressing it does.
  // With one company there is nothing to switch, so it is not a control.
  const single = state.companies.length < 2;
  const label = single
    ? localized(company)
    : t('nav.companyCurrent', { company: localized(company) });
  for (const id of ['companyBtn', 'companyBtnTop']) {
    const button = document.getElementById(id);
    button.setAttribute('aria-label', label);
    button.disabled = single;
  }
}

/* -------------------------------------------------------- company switcher */

/**
 * Fills each company menu with the companies this person may work in. The
 * current one carries aria-current, the bold weight and a tick; the others
 * show their code. Each row leads with the company's logo; a company without
 * one shows its own colour as a swatch instead.
 */
function renderCompanyMenus() {
  for (const menu of document.querySelectorAll('[data-company-menu]')) {
    menu.replaceChildren();

    const label = document.createElement('p');
    label.className = 'u-microlabel menu__label';
    label.textContent = t('nav.switchCompany');
    menu.append(label);

    for (const company of state.companies) {
      const current = company === state.company;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'menu__item';
      item.setAttribute('aria-current', String(current));

      let lead;
      if (company.logoUrl) {
        lead = companyMark(company, { small: true });
      } else {
        lead = document.createElement('span');
        lead.className = 'menu__swatch';
        lead.style.background = company.accentColor;
        lead.setAttribute('aria-hidden', 'true');
      }

      const name = document.createElement('span');
      name.textContent = localized(company);

      item.append(lead, name);
      if (current) {
        item.insertAdjacentHTML('beforeend', icon('check', 'menu__item-meta menu__check'));
      } else {
        const code = document.createElement('span');
        code.className = 'menu__item-meta';
        code.textContent = company.code;
        item.append(code);
      }

      item.addEventListener('click', () => {
        closeMenu(menu.id, { restoreFocus: true });
        selectCompany(company);
      });
      menu.append(item);
    }
  }
}

function selectCompany(company) {
  if (company === state.company) return;
  state.company = company;
  writeStored(STORED_COMPANY_KEY, company.code);
  renderShellData();
  router.refresh();
}

/* ------------------------------------------------------------- shell data */

/** Everything in the shell that comes from data rather than from a string. */
function renderShellData() {
  const { user, company } = state;
  const userName = localized(user, 'displayName');

  applyCompanyBranding(company);
  applyNav();
  renderCompanyMenus();

  document.getElementById('userAvatar').textContent = initials(userName);
  document.getElementById('userMenuName').textContent = userName;
  document.getElementById('menuUserName').textContent = userName;
  document.getElementById('menuUserCompany').replaceChildren(companyName(company));

  const toggle = document.getElementById('railToggle');
  const collapsed = toggle.getAttribute('aria-expanded') === 'false';
  toggle.setAttribute('aria-label', t(collapsed ? 'nav.expandRail' : 'nav.collapseRail'));

  drawTicketCount();

  // DEMO: a sample notification, until notifications have an API.
  document.getElementById('notifSample1').textContent = t('notification.sample1Title', {
    ticket: 'IT-2026-00042',
  });
  updateNotifA11y();
}

/* ------------------------------------------------------ announcement count */

let unreadAnnouncements = 0;

/** Draws the unread count on the Announcements nav item, if there is one. */
function drawAnnouncementCount() {
  for (const el of document.querySelectorAll('[data-announcement-count]')) {
    el.hidden = unreadAnnouncements === 0;
    el.textContent = unreadAnnouncements > 99 ? '99+' : String(unreadAnnouncements);
    el.setAttribute('aria-label', t('ann.navCount', { count: unreadAnnouncements }));
  }
}

/** Asks the server how many announcements this person has not opened. */
async function refreshAnnouncementCount() {
  try {
    const { count } = await api('/api/announcements/unread-count', { quiet: true });
    unreadAnnouncements = count;
  } catch {
    // The nav is a convenience: no count is better than a wrong one.
    unreadAnnouncements = 0;
  }
  drawAnnouncementCount();
}

/* ------------------------------------------------------------ ticket count */

/** GET /api/tickets/counts. `queue` is null for anyone not on a support team. */
let ticketCounts = { mine: 0, queue: null };

/**
 * Draws the number beside Tickets: for the support team, the tickets nobody
 * has picked up yet; for everyone else, their own open ones.
 */
function drawTicketCount() {
  const { mine, queue } = ticketCounts;
  const count = queue ? queue.unassigned : mine;
  const label = queue
    ? t('tickets.navCountQueue', { count, soon: queue.breachingSoon })
    : t('tickets.navCount', { count });
  for (const el of document.querySelectorAll('[data-ticket-count]')) {
    el.hidden = count === 0;
    el.textContent = count > 99 ? '99+' : String(count);
    el.setAttribute('aria-label', label);
  }
}

/** Asks the server for this person's ticket numbers. */
async function refreshTicketCount() {
  try {
    ticketCounts = await api('/api/tickets/counts', { quiet: true });
  } catch {
    // The nav is a convenience: no count is better than a wrong one.
    ticketCounts = { mine: 0, queue: null };
  }
  drawTicketCount();
}

/* -------------------------------------------------------------- navigation */

/**
 * Shows only the destinations the server listed for this person. This is
 * courtesy, not security: every route behind a link checks for itself.
 */
function applyNav() {
  const allowed = new Set(state.nav.map((item) => item.key));
  for (const link of document.querySelectorAll('[data-nav]')) {
    link.hidden = !allowed.has(link.dataset.nav);
  }

  const admin = isAdmin();
  document.getElementById('railAdminSection').hidden = !admin;
  document.getElementById('moreAdminSection').hidden = !admin;
}

/* -------------------------------------------------------------------- page */

/** What every page is handed: who is asking, and for which company. */
function pageContext() {
  const name = localized(state.user, 'displayName');
  return {
    company: state.company,
    user: { name, firstName: name.trim().split(/\s+/)[0] ?? name },
    admin: isAdmin(),
  };
}

/**
 * The router has picked a page: say where we are in the nav, the top bar and
 * the tab's title, and put away anything that was open over the last page.
 *
 * @param {import('./router.js').Match} match
 */
function markLocation(match) {
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === match.nav) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const title = document.getElementById('topbarTitle');
  title.dataset.i18n = match.title;
  title.textContent = t(match.title);
  document.title = t('page.title', { page: t(match.title), app: t('app.name') });

  for (const menu of document.querySelectorAll('.menu')) closeMenu(menu.id);
  const sheet = document.getElementById('moreSheet');
  if (sheet.open) sheet.close();
}

/**
 * "Skip to main content" is a link to #main, and the address belongs to the
 * router: move focus by hand and leave the hash alone.
 */
function initSkipLink() {
  document.querySelector('.u-skip-link').addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('main').focus();
  });
}

/* ------------------------------------------------------------ rail collapse */

function setRailCollapsed(collapsed) {
  const rail = document.getElementById('rail');
  const toggle = document.getElementById('railToggle');
  rail.dataset.collapsed = String(collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', t(collapsed ? 'nav.expandRail' : 'nav.collapseRail'));

  for (const el of rail.querySelectorAll('[data-rail-text]')) {
    el.classList.toggle('u-visually-hidden', collapsed);
  }

  document.documentElement.style.setProperty(
    '--rail-width',
    collapsed ? 'var(--rail-width-collapsed)' : ''
  );

  writeStored(STORED_RAIL_KEY, String(collapsed));
}

function initRailToggle() {
  const toggle = document.getElementById('railToggle');
  toggle.addEventListener('click', () => {
    setRailCollapsed(document.getElementById('rail').dataset.collapsed !== 'true');
  });
  setRailCollapsed(readStored(STORED_RAIL_KEY) === 'true');
}

/* --------------------------------------------------------------- popovers */

/**
 * These are disclosure popovers, not the WAI-ARIA application-menu pattern:
 * they hold a mix of static text and ordinary links/buttons rather than a
 * roving-tabindex menu with arrow-key traversal, so none of this carries
 * role="menu"/"menuitem" — that role would promise keyboard behaviour this
 * code does not implement.
 */
function closeMenu(id, { restoreFocus = false } = {}) {
  const menu = document.getElementById(id);
  const trigger = document.querySelector(`[aria-controls="${id}"]`);
  if (menu) menu.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger?.focus();
}

/**
 * Wires a trigger button to a popover: click to toggle, Escape and an
 * outside click to close, and the trigger regains focus on close so keyboard
 * use never loses its place.
 */
function initPopover(triggerId, menuId) {
  const trigger = document.getElementById(triggerId);
  const menu = document.getElementById(menuId);
  if (!trigger || !menu) return;

  trigger.addEventListener('click', () => {
    const opening = menu.hidden;
    for (const other of document.querySelectorAll('.menu')) {
      if (other !== menu) closeMenu(other.id);
    }
    menu.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
  });

  document.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) {
      closeMenu(menuId);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      closeMenu(menuId, { restoreFocus: true });
    }
  });

  // Tabbing out of the popover closes it, so it never stays open behind the
  // place a keyboard user has moved on to.
  menu.parentElement.addEventListener('focusout', (event) => {
    if (
      !menu.hidden &&
      event.relatedTarget &&
      !menu.parentElement.contains(event.relatedTarget)
    ) {
      closeMenu(menuId);
    }
  });
}

/* ------------------------------------------------------------- more sheet */

function initMoreSheet() {
  const sheet = document.getElementById('moreSheet');
  document.getElementById('moreBtn')?.addEventListener('click', () => sheet.showModal());
  for (const closer of sheet.querySelectorAll('[data-dialog-close]')) {
    closer.addEventListener('click', () => sheet.close());
  }
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) sheet.close();
  });
}

/* ------------------------------------------------------------------ search */

/**
 * A phone's top bar has room for one word of placeholder, not the full
 * sentence. The accessible name keeps the full sentence either way.
 */
const NARROW = window.matchMedia('(max-width: 47.99rem)');

function updateSearchPlaceholder() {
  document
    .getElementById('globalSearch')
    .setAttribute(
      'placeholder',
      t(NARROW.matches ? 'field.searchShort' : 'field.searchPlaceholder')
    );
}

/** "/" jumps to the search field, unless the visitor is already typing. */
function initSearchShortcut() {
  const search = document.getElementById('globalSearch');
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    search.focus();
  });
}

/* -------------------------------------------------------------- notifications */

/**
 * aria-label is explicit on the bell button, so it overrides any name the
 * browser would otherwise compute from its content — the unread count has to
 * be folded into that label directly, or a screen reader never hears it.
 */
function updateNotifA11y() {
  const count = Number(document.getElementById('notifCount').textContent) || 0;
  document
    .getElementById('notifBtn')
    .setAttribute(
      'aria-label',
      count > 0 ? t('notification.unreadLabel', { count }) : t('nav.notifications')
    );
}

/* ----------------------------------------------------------------- sign out */

function initSignOut() {
  const button = document.getElementById('signOutBtn');
  const label = button.querySelector('[data-i18n]');

  button.addEventListener('click', async () => {
    if (button.getAttribute('aria-busy') === 'true') return;
    button.setAttribute('aria-busy', 'true');
    try {
      // On success the page leaves for the login screen.
      await signOut();
    } catch {
      // Still signed in, and the person must know it: the row says so and
      // stays where it is, ready to be pressed again.
      button.removeAttribute('aria-busy');
      label.dataset.i18n = 'nav.signOutFailed';
      label.textContent = t('nav.signOutFailed');
    }
  });
}

/* -------------------------------------------------------------------- boot */

/**
 * The session could not be read, and it was not a 401 (that goes to the login
 * page): most likely there is no signal. The shell stays hidden, since there
 * is nobody to draw it for, and the work area says what happened.
 */
function showBootError() {
  const page = document.getElementById('page');
  page.innerHTML = loadFailedNotice();
  page.querySelector('[data-retry]').addEventListener('click', () => location.reload());
}

async function init() {
  injectSprite();

  // Words first, in the device's language, so that waiting and failing can
  // both be said before anything is known about the person.
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
  state.nav = me.nav;
  state.companies = me.companies;
  // The company last worked in on this device, if they may still work in it.
  const storedCompany = readStored(STORED_COMPANY_KEY);
  state.company =
    state.companies.find((c) => c.code === storedCompany) ??
    state.companies.find((c) => c.id === me.company.id) ??
    me.company;

  router = createRouter({
    root: document.getElementById('page'),
    canAccess: (navKey) => state.nav.some((item) => item.key === navKey),
    context: pageContext,
    onNavigate: markLocation,
  });

  // Draws the shell's data and, through the router, the first page.
  await applyLanguage(preferredLocale());
  delete document.querySelector('.app').dataset.booting;

  initLanguageMenu();
  initRailToggle();
  initPopover('companyBtn', 'companyMenu');
  initPopover('companyBtnTop', 'companyMenuTop');
  initPopover('notifBtn', 'notifMenu');
  initPopover('userMenuBtn', 'userMenu');
  initMoreSheet();
  initSearchShortcut();
  initPeopleSearch(document.getElementById('globalSearch'));
  initSignOut();
  initSkipLink();
  document.addEventListener('announcements:changed', refreshAnnouncementCount);
  refreshAnnouncementCount();
  document.addEventListener('tickets:changed', refreshTicketCount);
  refreshTicketCount();
  NARROW.addEventListener('change', updateSearchPlaceholder);
}

init();
