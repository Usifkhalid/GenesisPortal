/**
 * styleguide.js — the specimen sheet's controls and live demos.
 *
 * Language, theme and company accent are all switchable here, because the
 * design system has to hold in English and Arabic, light and dark, and under
 * any accent a company might bring. Choices persist on this device so that
 * reloading while working on a component does not reset the view.
 */

import { setLocale, apply, t, getLocale, LOCALES } from '../i18n.js';
import { injectSprite, icon } from '../components/icons.js';

const STORE = 'mgp.styleguide';

/** The four accents the system is checked against, plus the neutral default. */
const ACCENTS = {
  ironOxide: '#b4552d',
  blue: '#1e5aa8',
  green: '#1c7a4a',
  amber: '#e8a317',
  red: '#c4302b',
};

const readPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE)) ?? {};
  } catch {
    return {};
  }
};

const writePrefs = (patch) => {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* Private browsing. The sheet still works; the choice just will not stick. */
  }
};

/** Marks exactly one button in a group as pressed. */
function setPressed(group, value) {
  for (const btn of group.querySelectorAll('[data-value]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.value === value));
  }
}

/* ---------------------------------------------------------------- language */

async function applyLanguage(lang) {
  await setLocale(lang);
  const group = document.querySelector('[data-group="lang"]');
  if (group) setPressed(group, getLocale());
  writePrefs({ lang: getLocale() });
}

/* ------------------------------------------------------------------- theme */

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'system') html.removeAttribute('data-theme');
  else html.dataset.theme = theme;
  const group = document.querySelector('[data-group="theme"]');
  if (group) setPressed(group, theme);
  writePrefs({ theme });
}

/* ------------------------------------------------------------------ accent */

function applyAccent(name) {
  const value = ACCENTS[name] ?? ACCENTS.ironOxide;
  document.documentElement.style.setProperty('--brand-accent', value);
  const group = document.querySelector('[data-group="accent"]');
  if (group) setPressed(group, name);
  writePrefs({ accent: name });
}

/* -------------------------------------------------------------------- tabs */

/**
 * Tabs, keyboard behaviour included: arrows move between tabs, Home and End
 * jump to the ends, and only the selected tab is in the tab order.
 */
function initTabs(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return;

  const select = (tab, { focus = true } = {}) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    }
    if (focus) tab.focus();
  };

  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) select(tab, { focus: false });
  });

  root.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    // In Arabic the visual order is mirrored, so the arrow that moves "next"
    // is the one pointing the way the text runs.
    const rtl = document.documentElement.dir === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next = null;
    if (event.key === forward) next = tabs[(index + 1) % tabs.length];
    else if (event.key === back) next = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (event.key === 'Home') next = tabs[0];
    else if (event.key === 'End') next = tabs[tabs.length - 1];
    if (next) {
      event.preventDefault();
      select(next);
    }
  });

  select(tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0], {
    focus: false,
  });
}

/* ----------------------------------------------------------------- dialogs */

function initDialogs() {
  for (const trigger of document.querySelectorAll('[data-dialog-open]')) {
    trigger.addEventListener('click', () => {
      document.getElementById(trigger.dataset.dialogOpen)?.showModal();
    });
  }
  for (const closer of document.querySelectorAll('[data-dialog-close]')) {
    closer.addEventListener('click', () => closer.closest('dialog')?.close());
  }
  // A click on the backdrop closes the dialog. The check is on the target
  // being the dialog itself, so a click inside the panel never closes it.
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
}

/* ------------------------------------------------------------------ toasts */

const TOAST_ICON = {
  success: 'statusResolved',
  warning: 'statusOverdue',
  danger: 'statusOverdue',
  info: 'info',
};

/**
 * Adds a toast to the live region. The container carries aria-live, so the
 * message is announced without moving focus away from the visitor's task.
 */
function showToast(toaster, { tone = 'info', titleKey, textKey }) {
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.innerHTML = `
    ${icon(TOAST_ICON[tone] ?? 'info', 'toast__icon')}
    <div class="toast__content">
      <p class="toast__title">${t(titleKey)}</p>
      ${textKey ? `<p class="toast__text">${t(textKey)}</p>` : ''}
    </div>
    <button type="button" class="btn btn--ghost btn--sm btn--icon toast__close"
            aria-label="${t('a11y.dismissToast')}">
      ${icon('x', 'btn__icon')}
    </button>`;
  el.querySelector('.toast__close').addEventListener('click', () => el.remove());
  toaster.append(el);
  // Long enough to read a two-line message in either language.
  setTimeout(() => el.remove(), 6000);
}

function initToasts() {
  const toaster = document.getElementById('toaster');
  if (!toaster) return;
  for (const trigger of document.querySelectorAll('[data-toast]')) {
    trigger.addEventListener('click', () => {
      showToast(toaster, {
        tone: trigger.dataset.toast,
        titleKey: trigger.dataset.toastTitle,
        textKey: trigger.dataset.toastText,
      });
    });
  }
}

/* --------------------------------------------- label strip, the signature */

function initStripDemo() {
  for (const trigger of document.querySelectorAll('[data-register]')) {
    trigger.addEventListener('click', () => {
      const strip = document.getElementById(trigger.dataset.register);
      if (!strip) return;
      strip.classList.remove('labelstrip--registered');
      // Force a reflow so the class can be re-applied and the motion replays.
      void strip.offsetWidth;
      strip.classList.add('labelstrip--registered');
    });
  }
}

/* ------------------------------------------------------- file upload demo */

function initUpload() {
  for (const input of document.querySelectorAll('.upload__input')) {
    const list = document.getElementById(input.dataset.fileList ?? '');
    if (!list) continue;
    input.addEventListener('change', () => {
      list.replaceChildren();
      for (const file of input.files) {
        const li = document.createElement('li');
        li.className = 'upload__file';
        const name = document.createElement('span');
        name.className = 'upload__file-name';
        name.textContent = file.name;
        const size = document.createElement('span');
        size.className = 'upload__file-size';
        size.textContent = `${(file.size / 1024).toFixed(0)} kB`;
        li.append(name, size);
        list.append(li);
      }
    });
  }
}

/* ----------------------------------------------------- sortable table demo */

function initSort() {
  for (const button of document.querySelectorAll('.table__sort')) {
    button.addEventListener('click', () => {
      const th = button.closest('th');
      const row = th.closest('tr');
      const next = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : 'descending';
      for (const other of row.querySelectorAll('th[aria-sort]')) {
        other.setAttribute('aria-sort', 'none');
      }
      th.setAttribute('aria-sort', next);
      // The direction is also stated in words for screen reader users, since
      // the arrow alone is a visual signal.
      const note = th.querySelector('.u-visually-hidden');
      if (note) {
        note.textContent = t(
          next === 'ascending' ? 'table.sortedAscending' : 'table.sortedDescending'
        );
      }
    });
  }
}

/* -------------------------------------------------------------------- boot */

async function init() {
  injectSprite();

  const prefs = readPrefs();
  const lang = prefs.lang in LOCALES ? prefs.lang : 'en';
  applyTheme(prefs.theme ?? 'system');
  applyAccent(prefs.accent ?? 'ironOxide');
  await applyLanguage(lang);

  document.querySelector('[data-group="lang"]')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-value]');
    if (btn) applyLanguage(btn.dataset.value);
  });

  document.querySelector('[data-group="theme"]')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-value]');
    if (btn) applyTheme(btn.dataset.value);
  });

  document.querySelector('[data-group="accent"]')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-value]');
    if (btn) applyAccent(btn.dataset.value);
  });

  for (const tablist of document.querySelectorAll('[role="tablist"]')) {
    initTabs(tablist.closest('[data-tabs]') ?? tablist.parentElement);
  }

  initDialogs();
  initToasts();
  initStripDemo();
  initUpload();
  initSort();

  // Re-apply strings to anything created after the first render.
  apply();
}

init();
