/**
 * pages/login.js — the sign-in page.
 *
 * Asks the server how sign-in works here (GET /api/auth/config) and draws one
 * of two things: in Entra mode a single "Sign in with Microsoft" link to
 * /auth/login; in mock mode (development only) the seeded users, grouped by
 * company, each a button that signs in as that person.
 *
 * Someone who already has a session is sent straight to the portal.
 */

import { ApiError, api, setCsrfToken } from '../api.js';
import { esc } from '../html.js';
import { companyMark } from '../components/company-mark.js';
import { icon, injectSprite } from '../components/icons.js';
import { initials } from '../components/initials.js';
import { loadFailedNotice, notice } from '../components/notice.js';
import { DEFAULT_LOCALE, getLocale, localized, setLocale, t } from '../i18n.js';
import { forgetSavedAnswers, startServiceWorker } from '../pwa.js';

const STORED_LOCALE_KEY = 'mgp.locale';

/** The reasons /auth/callback may send someone back here with. */
const CALLBACK_ERRORS = [
  'signin_failed',
  'not_provisioned',
  'too_many_attempts',
  'consent_required',
  'not_assigned',
  'app_setup',
  'cancelled',
  'company_not_set_up',
];

const state = {
  /** 'loading' | 'loadFailed' | 'mock' | 'mockOff' | 'entra' */
  view: 'loading',
  /** @type {object[]} companies with their users, in mock mode */
  companies: [],
  /** An i18n key stem under which `.title` and `.text` say what went wrong. */
  notice: null,
  /** The id of the person being signed in, while the request is out. */
  signingIn: null,
};

const el = (id) => document.getElementById(id);

/* -------------------------------------------------------------- language */

function readStoredLocale() {
  try {
    return localStorage.getItem(STORED_LOCALE_KEY);
  } catch {
    // Private mode or blocked storage: fall through to the browser's language.
    return null;
  }
}

async function applyLanguage(lang) {
  await setLocale(lang);
  for (const option of document.querySelectorAll('[data-lang]')) {
    option.setAttribute('aria-pressed', String(option.dataset.lang === getLocale()));
  }
  render();
}

function initLanguageSwitch() {
  for (const option of document.querySelectorAll('[data-lang]')) {
    option.addEventListener('click', () => {
      // Only a choice made by hand is remembered: otherwise the language on
      // the person's profile decides once they are signed in.
      try {
        localStorage.setItem(STORED_LOCALE_KEY, option.dataset.lang);
      } catch {
        // The choice just will not stick.
      }
      applyLanguage(option.dataset.lang);
    });
  }
}

/* ---------------------------------------------------------------- pieces */

/** The shape of what is coming for a real user: the button and its note. */
function skeleton() {
  return `<div class="login__entra" role="status" aria-busy="true" aria-label="${esc(t('login.loading'))}">
    <span class="skeleton login__skeleton-button"></span>
    <span class="skeleton skeleton--text skeleton--line-long"></span>
  </div>`;
}

function pair(key, value) {
  return `<div class="labelstrip__pair">
    <dt class="labelstrip__key">${esc(key)}</dt>
    <dd class="labelstrip__value">${esc(value)}</dd>
  </div>`;
}

function personRow(person) {
  const name = localized(person, 'displayName');
  const busy = state.signingIn === person.id;

  return `<li class="record login__person">
    <dl class="labelstrip labelstrip--compact">
      ${pair(t('login.field.role'), t(`login.role.${person.role}`))}
      ${person.jobTitle ? pair(t('login.field.jobTitle'), person.jobTitle) : ''}
    </dl>
    <div class="record__head login__person-head">
      <span class="avatar" aria-hidden="true">${esc(initials(name))}</span>
      <h3 class="record__title">
        <button
          type="button"
          class="login__pick"
          data-user-id="${esc(person.id)}"
          aria-label="${esc(t('login.mock.signInAs', { name }))}"
          ${busy ? 'aria-busy="true"' : ''}
          ${state.signingIn ? 'disabled' : ''}
        >${esc(name)}</button>
      </h3>
      <span class="record__aside login__go" aria-hidden="true">
        ${busy ? '<span class="btn__spinner"></span>' : icon('chevronEnd', '', { directional: true })}
      </span>
    </div>
  </li>`;
}

function companyCard(company, index) {
  const titleId = `loginCompany${index}`;
  return `<section class="card login__company" aria-labelledby="${titleId}">
    <div class="card__header">
      <div class="card__titles">
        <h2 class="card__title login__company-name" id="${titleId}">
          <span data-company-mark="${index}"></span>
          <span>${esc(localized(company))}</span>
          <span class="card__count">${esc(
            t('login.mock.peopleCount', { count: company.users.length })
          )}</span>
        </h2>
      </div>
    </div>
    <ul class="record-list" data-density="compact">
      ${company.users.map(personRow).join('')}
    </ul>
  </section>`;
}

/* ---------------------------------------------------------------- render */

const LEADS = { mock: 'login.mock.lead', entra: 'login.entra.lead' };

function render() {
  const body = el('loginBody');
  el('main').dataset.mode = state.view;

  const lead = el('loginLead');
  lead.hidden = !LEADS[state.view];
  lead.textContent = LEADS[state.view] ? t(LEADS[state.view]) : '';

  const noticeBox = el('loginNotice');
  noticeBox.hidden = !state.notice;
  noticeBox.innerHTML = state.notice
    ? notice({
        tone: 'danger',
        mark: 'statusOverdue',
        titleKey: `${state.notice}.title`,
        textKey: `${state.notice}.text`,
      })
    : '';

  if (state.view === 'loading') {
    body.innerHTML = skeleton();
  } else if (state.view === 'loadFailed') {
    body.innerHTML = loadFailedNotice();
    body.querySelector('[data-retry]').addEventListener('click', load);
  } else if (state.view === 'mockOff') {
    body.innerHTML = notice({
      tone: 'warning',
      mark: 'info',
      titleKey: 'login.mock.offTitle',
      textKey: 'login.mock.offText',
    });
  } else if (state.view === 'entra') {
    body.innerHTML = `<div class="login__entra">
      <a class="btn btn--primary btn--lg btn--block" href="/auth/login">
        <span class="btn__label">${esc(t('login.entra.button'))}</span>
      </a>
      <p class="login__note">${esc(t('login.entra.note'))}</p>
    </div>`;
  } else {
    body.innerHTML = `<div class="grid login__companies">
      ${state.companies.map(companyCard).join('')}
    </div>`;
    for (const slot of body.querySelectorAll('[data-company-mark]')) {
      const company = state.companies[Number(slot.dataset.companyMark)];
      // An uploaded logo is served to signed-in people only (/api/...), so this
      // page, which nobody is signed in to, shows the company's code instead.
      const logoUrl = company.logoUrl?.startsWith('/api/') ? null : company.logoUrl;
      slot.replaceWith(companyMark({ ...company, logoUrl }, { small: true }));
    }
    for (const button of body.querySelectorAll('[data-user-id]')) {
      button.addEventListener('click', () => signInAs(button.dataset.userId));
    }
  }
}

/* --------------------------------------------------------------- actions */

async function signInAs(userId) {
  if (state.signingIn) return;

  const person = state.companies.flatMap((c) => c.users).find((u) => u.id === userId);
  state.signingIn = userId;
  state.notice = null;
  render();
  el('loginStatus').textContent = t('login.signingIn', {
    name: localized(person, 'displayName'),
  });

  try {
    const { redirectTo } = await api('/api/auth/mock-login', {
      method: 'POST',
      body: { userId },
      redirectOn401: false,
      quiet: true,
    });
    // The row stays busy: the page is leaving.
    location.assign(redirectTo);
  } catch {
    state.signingIn = null;
    state.notice = 'login.failed';
    el('loginStatus').textContent = '';
    render();
    // Back to the row that was pressed, so a keyboard user can try again.
    document.querySelector(`[data-user-id="${CSS.escape(userId)}"]`)?.focus();
  }
}

async function load() {
  state.view = 'loading';
  render();

  try {
    const config = await api('/api/auth/config', { redirectOn401: false, quiet: true });
    setCsrfToken(config.csrfToken);
    startServiceWorker({ enabled: config.serviceWorker === true });

    if (config.signedIn) {
      location.replace('./');
      return;
    }

    if (config.mode === 'entra') {
      state.view = 'entra';
    } else {
      try {
        state.companies = (
          await api('/api/auth/mock-users', { redirectOn401: false, quiet: true })
        ).companies;
        state.view = 'mock';
      } catch (err) {
        // The server is in mock mode but not in development: it says 404.
        if (!(err instanceof ApiError) || err.status !== 404) throw err;
        state.view = 'mockOff';
      }
    }
  } catch {
    state.view = 'loadFailed';
  }
  render();
}

/* -------------------------------------------------------------------- boot */

/** Reads why /auth/callback sent the browser back, then tidies the address. */
function readCallbackError() {
  const url = new URL(location.href);
  const reason = url.searchParams.get('error');
  if (reason === null) return;

  if (CALLBACK_ERRORS.includes(reason)) state.notice = `login.error.${reason}`;
  url.searchParams.delete('error');
  history.replaceState(null, '', url);
}

async function init() {
  // Arriving here means signed out: nothing of the last person stays saved.
  forgetSavedAnswers();
  injectSprite();
  readCallbackError();
  initLanguageSwitch();

  await applyLanguage(
    readStoredLocale() ?? (navigator.language?.startsWith('ar') ? 'ar' : DEFAULT_LOCALE)
  );
  await load();
}

init();
