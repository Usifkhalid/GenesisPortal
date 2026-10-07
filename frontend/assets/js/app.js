/**
 * app.js — the portal's app shell.
 *
 * Wires the top bar, the rail/bottom-nav pair and the page header against
 * static demo data. There is no router and no API call yet: a company and a
 * signed-in user are hard-coded here so the shell can be seen and reviewed on
 * its own, and are the only things a future sign-in and company-admin module
 * need to replace.
 */

import { DEFAULT_LOCALE, setLocale, apply, getLocale, t } from './i18n.js';
import { injectSprite } from './components/icons.js';

const STORED_LOCALE_KEY = 'mgp.locale';
const STORED_RAIL_KEY = 'mgp.railCollapsed';

/** Stands in for the Company record a real session would carry. */
const DEMO_COMPANY = {
  name: 'app.company',
  shortName: 'app.companyShort',
  accentColor: '#1c7a4a',
  logoUrl: null,
};

/** Stands in for the signed-in user a real session would carry. */
const DEMO_USER = {
  name: 'Youssef El-Shal',
  role: 'CompanyAdmin',
};

const isAdmin = (user) => user.role === 'HoldingAdmin' || user.role === 'CompanyAdmin';

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/* -------------------------------------------------------------- language */

function preferredLocale() {
  try {
    const stored = localStorage.getItem(STORED_LOCALE_KEY);
    if (stored) return stored;
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return navigator.language?.startsWith('ar') ? 'ar' : DEFAULT_LOCALE;
}

async function applyLanguage(lang) {
  await setLocale(lang);
  try {
    localStorage.setItem(STORED_LOCALE_KEY, getLocale());
  } catch {
    // Private mode or blocked storage: the choice just will not stick.
  }
  // These three hold content that data-i18n cannot reach on its own: the
  // company mark may carry a logo <img> instead of a text hook, the
  // notification count has to stay folded into the bell's aria-label, and the
  // language menu's current-language mark is state, not a translated string.
  applyCompanyBranding(DEMO_COMPANY);
  updateNotifA11y();
  updateLanguageMenu();
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
 * initials on that colour, so the shell is never broken by missing evidence.
 *
 * @param {{ name: string, shortName: string, accentColor: string, logoUrl: string|null }} company
 */
function applyCompanyBranding(company) {
  document.documentElement.style.setProperty('--brand-accent', company.accentColor);

  for (const mark of document.querySelectorAll('#railMark, #topbarMark')) {
    if (company.logoUrl) {
      mark.removeAttribute('data-i18n');
      mark.replaceChildren();
      const img = document.createElement('img');
      img.src = company.logoUrl;
      img.alt = '';
      mark.append(img);
    } else {
      mark.setAttribute('data-i18n', company.shortName);
      mark.textContent = t(company.shortName);
    }
  }
}

/* -------------------------------------------------------------- user menu */

function populateUser(user) {
  document.getElementById('userAvatar').textContent = initials(user.name);
  document.getElementById('userMenuName').textContent = user.name;
  document.getElementById('menuUserName').textContent = user.name;
  document.getElementById('menuUserCompany').textContent = t(DEMO_COMPANY.name);

  const adminSection = document.getElementById('railAdminSection');
  const moreAdminLink = document.getElementById('moreAdminLink');
  const moreAuditLogLink = document.getElementById('moreAuditLogLink');
  const admin = isAdmin(user);
  adminSection.hidden = !admin;
  moreAdminLink.hidden = !admin;
  moreAuditLogLink.hidden = !admin;
}

/* ------------------------------------------------------------ rail collapse */

function readRailCollapsed() {
  try {
    return localStorage.getItem(STORED_RAIL_KEY) === 'true';
  } catch {
    return false;
  }
}

function setRailCollapsed(collapsed) {
  const rail = document.getElementById('rail');
  const toggle = document.getElementById('railToggle');
  rail.dataset.collapsed = String(collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', t(collapsed ? 'nav.expandRail' : 'nav.collapseRail'));

  for (const el of rail.querySelectorAll('.rail__label, .nav-link__count, .rail__company')) {
    el.classList.toggle('u-visually-hidden', collapsed);
  }

  document.documentElement.style.setProperty(
    '--rail-width',
    collapsed ? 'var(--rail-width-collapsed)' : ''
  );

  try {
    localStorage.setItem(STORED_RAIL_KEY, String(collapsed));
  } catch {
    // Private mode or blocked storage: the choice just will not stick.
  }
}

function initRailToggle() {
  const toggle = document.getElementById('railToggle');
  toggle.addEventListener('click', () => {
    setRailCollapsed(document.getElementById('rail').dataset.collapsed !== 'true');
  });
  setRailCollapsed(readRailCollapsed());
}

/* --------------------------------------------------------------- popovers */

/**
 * These are disclosure popovers, not the WAI-ARIA application-menu pattern:
 * they hold a mix of static text and ordinary links/buttons rather than a
 * roving-tabindex menu with arrow-key traversal, so none of this carries
 * role="menu"/"menuitem" — that role would promise keyboard behaviour this
 * code does not implement.
 */
function closeMenu(id) {
  const menu = document.getElementById(id);
  const trigger = document.querySelector(`[aria-controls="${id}"]`);
  if (menu) menu.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
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
      closeMenu(menuId);
      trigger.focus();
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
  // Placeholder: no session yet to end. The real handler arrives with sign-in.
  document.getElementById('signOutBtn')?.addEventListener('click', () => closeMenu('userMenu'));
}

/* -------------------------------------------------------------------- boot */

async function init() {
  injectSprite();
  await applyLanguage(preferredLocale());

  populateUser(DEMO_USER);
  initLanguageMenu();
  initRailToggle();
  initPopover('notifBtn', 'notifMenu');
  initPopover('userMenuBtn', 'userMenu');
  initMoreSheet();
  initSignOut();

  apply();
}

init();
