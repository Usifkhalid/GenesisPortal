/**
 * app.js — the portal entry point.
 *
 * Placeholder for the app shell. It currently does the one thing the shell will
 * always do first: load the chosen language, which also sets <html lang> and
 * <html dir> and so decides the direction every stylesheet reads. The router,
 * navigation and page modules arrive with the app shell.
 */

import { DEFAULT_LOCALE, setLocale } from './i18n.js';

const STORED_LOCALE_KEY = 'mgp.locale';

function preferredLocale() {
  try {
    const stored = localStorage.getItem(STORED_LOCALE_KEY);
    if (stored) return stored;
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return navigator.language?.startsWith('ar') ? 'ar' : DEFAULT_LOCALE;
}

await setLocale(preferredLocale());
