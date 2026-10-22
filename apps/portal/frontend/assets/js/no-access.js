/**
 * no-access.js — the page the server shows with a 403 to someone who asks for
 * the IT Helpdesk and is not on the IT team (D135). It speaks the language
 * last used on this device.
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
