/**
 * offline.js — the page the worker shows when an address is not saved on the
 * device and there is no signal. It speaks the language last used here, and
 * tries again by itself the moment the connection returns.
 */

import { DEFAULT_LOCALE, LOCALES, setLocale } from './i18n.js';

function chosenLocale() {
  try {
    const stored = localStorage.getItem('mgp.locale');
    if (stored in LOCALES) return stored;
  } catch {
    // Storage blocked: the browser's language decides.
  }
  return navigator.language?.startsWith('ar') ? 'ar' : DEFAULT_LOCALE;
}

await setLocale(chosenLocale());

document.getElementById('offlineRetry').addEventListener('click', () => location.reload());
window.addEventListener('online', () => location.assign('/'));
