/**
 * format.js — dates as people read them. Everything is stored in UTC and
 * shown in Africa/Cairo (CLAUDE.md rule 8), whatever zone the device is in.
 * Digits stay Latin in Arabic too, so they are set by the same face and line
 * up in a column.
 */

import { getLocale } from './i18n.js';

const CAIRO = 'Africa/Cairo';

const locale = () => (getLocale() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

/** "11 Oct 2026, 14:05" */
export function formatDateTime(value) {
  return new Intl.DateTimeFormat(locale(), {
    timeZone: CAIRO,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

/** "11 Oct 2026, 14:05:09": the audit drawer's exact moment. */
export function formatDateTimeSeconds(value) {
  return new Intl.DateTimeFormat(locale(), {
    timeZone: CAIRO,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

/** Today's date in Cairo as "YYYY-MM-DD", for a date input's value. */
export function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO }).format(new Date());
}

/** A whole number in the page's digits. */
export function formatNumber(value) {
  return new Intl.NumberFormat(locale()).format(value);
}
