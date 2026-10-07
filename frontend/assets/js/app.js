/**
 * app.js — the portal's app shell.
 *
 * Wires the top bar, the rail/bottom-nav pair and the company switcher against
 * static demo data, and mounts the Home page. There is no router and no API
 * call yet: the companies and the signed-in user come from demo-data.js, and
 * are the only things a future sign-in and company-admin module need to
 * replace.
 */

import { DEFAULT_LOCALE, setLocale, getLocale, t } from './i18n.js';
import { injectSprite, icon } from './components/icons.js';
import { DEMO_COMPANIES, DEMO_USER, DEMO_TICKETS, ticketNumber } from './demo-data.js';

const STORED_LOCALE_KEY = 'mgp.locale';
const STORED_RAIL_KEY = 'mgp.railCollapsed';
const STORED_COMPANY_KEY = 'mgp.company';

const state = {
  user: DEMO_USER,
  companies: DEMO_COMPANIES,
  company: DEMO_COMPANIES[0],
};

const isAdmin = (user) => user.role === 'HoldingAdmin' || user.role === 'CompanyAdmin';

function initials(name) {
  const parts = name.trim().split(/\s+/);
  // Arabic initials are a single letter; two joined letters read as a word.
  // An alef is shown bare: with its hamza, alone and small, it reads as '!'.
  if (getLocale() === 'ar') return (parts[0]?.[0] ?? '').replace(/[أإآ]/, 'ا');
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

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

function preferredLocale() {
  return (
    readStored(STORED_LOCALE_KEY) ??
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
  updateLanguageMenu();
  await renderPage();
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
 * @param {{ name: string, shortName: string, accentColor: string, logoUrl: string|null }} company
 */
function applyCompanyBranding(company) {
  document.documentElement.style.setProperty('--brand-accent', company.accentColor);

  for (const mark of document.querySelectorAll('[data-company-mark]')) {
    mark.replaceChildren();
    if (company.logoUrl) {
      const img = document.createElement('img');
      img.src = company.logoUrl;
      img.alt = '';
      mark.append(img);
    } else {
      mark.textContent = t(company.shortName);
    }
  }

  for (const name of document.querySelectorAll('[data-company-name]')) {
    name.textContent = t(company.name);
  }

  // The switcher's name says what it holds now and what pressing it does.
  // With one company there is nothing to switch, so it is not a control.
  const single = state.companies.length < 2;
  const label = single
    ? t(company.name)
    : t('nav.companyCurrent', { company: t(company.name) });
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
 * show their code. Each row shows the company's own colour as a swatch.
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

      const swatch = document.createElement('span');
      swatch.className = 'menu__swatch';
      swatch.style.background = company.accentColor;
      swatch.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.textContent = t(company.name);

      item.append(swatch, name);
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
  renderPage();
}

/* ------------------------------------------------------------- shell data */

/** Everything in the shell that comes from data rather than from a string. */
function renderShellData() {
  const { user, company } = state;
  const userName = t(user.name);

  applyCompanyBranding(company);
  renderCompanyMenus();

  document.getElementById('userAvatar').textContent = initials(userName);
  document.getElementById('userMenuName').textContent = userName;
  document.getElementById('menuUserName').textContent = userName;
  document.getElementById('menuUserCompany').textContent = t(company.name);

  const admin = isAdmin(user);
  document.getElementById('railAdminSection').hidden = !admin;
  document.getElementById('moreAdminSection').hidden = !admin;

  const toggle = document.getElementById('railToggle');
  const collapsed = toggle.getAttribute('aria-expanded') === 'false';
  toggle.setAttribute('aria-label', t(collapsed ? 'nav.expandRail' : 'nav.collapseRail'));

  for (const count of document.querySelectorAll('[data-ticket-count]')) {
    count.textContent = String(DEMO_TICKETS.length);
  }

  document.getElementById('notifSample1').textContent = t('notification.sample1Title', {
    ticket: ticketNumber(company.code, DEMO_TICKETS[0].seq),
  });
  updateNotifA11y();
}

/* -------------------------------------------------------------------- page */

/**
 * Mounts the current page. Page modules are loaded on demand, so the shell
 * paints first on a weak connection. Home is the only page so far.
 */
async function renderPage() {
  const page = document.getElementById('page');
  // On weak 3G the module can take seconds. Say so, in the shape of what is
  // coming, rather than leaving the work area blank.
  if (!page.firstElementChild) page.innerHTML = pageSkeleton();

  try {
    const { render } = await import('./pages/home.js');
    render(page, {
      company: state.company,
      user: state.user,
      admin: isAdmin(state.user),
    });
  } catch {
    page.innerHTML = pageError();
    page.querySelector('[data-retry]').addEventListener('click', () => {
      page.replaceChildren();
      renderPage();
    });
  }
}

function pageSkeleton() {
  const card = `<div class="skeleton-card">
    <div class="skeleton-card__strip">
      <div class="skeleton-card__pair">
        <span class="skeleton skeleton--text skeleton--line-short"></span>
        <span class="skeleton skeleton--value"></span>
      </div>
      <div class="skeleton-card__pair">
        <span class="skeleton skeleton--text skeleton--line-short"></span>
        <span class="skeleton skeleton--value"></span>
      </div>
    </div>
    <span class="skeleton skeleton--title"></span>
    <span class="skeleton skeleton--text skeleton--line-long"></span>
  </div>`;
  return `<div class="stack" role="status" aria-busy="true" aria-label="${t('loading.page')}">
    ${card}${card}
  </div>`;
}

function pageError() {
  return `<div class="notice notice--danger" role="alert">
    ${icon('statusOverdue', 'notice__icon')}
    <div class="notice__content stack stack--tight">
      <p class="notice__title">${t('app.loadFailedTitle')}</p>
      <p>${t('app.loadFailedText')}</p>
      <div>
        <button type="button" class="btn btn--secondary" data-retry>
          <span class="btn__label">${t('action.retry')}</span>
        </button>
      </div>
    </div>
  </div>`;
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
  // Placeholder: no session yet to end. The real handler arrives with sign-in.
  document.getElementById('signOutBtn')?.addEventListener('click', () => closeMenu('userMenu'));
}

/* -------------------------------------------------------------------- boot */

async function init() {
  injectSprite();

  const storedCompany = readStored(STORED_COMPANY_KEY);
  state.company = state.companies.find((c) => c.code === storedCompany) ?? state.companies[0];

  await applyLanguage(preferredLocale());

  initLanguageMenu();
  initRailToggle();
  initPopover('companyBtn', 'companyMenu');
  initPopover('companyBtnTop', 'companyMenuTop');
  initPopover('notifBtn', 'notifMenu');
  initPopover('userMenuBtn', 'userMenu');
  initMoreSheet();
  initSearchShortcut();
  initSignOut();
  NARROW.addEventListener('change', updateSearchPlaceholder);
}

init();
