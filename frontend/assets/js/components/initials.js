/**
 * components/initials.js — the letters an avatar shows for a name.
 */

import { getLocale } from '../i18n.js';

/** @param {string} name  in the language in use */
export function initials(name) {
  const parts = name.trim().split(/\s+/);
  // Arabic initials are a single letter; two joined letters read as a word.
  // An alef is shown bare: with its hamza, alone and small, it reads as '!'.
  if (getLocale() === 'ar') return (parts[0]?.[0] ?? '').replace(/[أإآ]/, 'ا');
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}
