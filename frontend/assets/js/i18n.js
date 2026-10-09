/**
 * i18n.js — string loading, lookup and document direction.
 *
 * English and Arabic are both first-class. There are no strings in markup or
 * in JavaScript: every one lives in assets/i18n/<lang>.json under the same key
 * in both files. Markup declares which key it wants with data-i18n, and this
 * module fills it in.
 *
 *   <h1 data-i18n="styleguide.title"></h1>
 *   <input data-i18n-attr="placeholder:field.searchPlaceholder">
 *   <button data-i18n-attr="aria-label:a11y.closeDialog"></button>
 *
 * Setting the language also sets <html lang> and <html dir>, which is what
 * drives every logical property in the stylesheets. Nothing else needs to know
 * the direction.
 */

/** Languages the portal ships. `dir` is read straight onto <html>. */
export const LOCALES = {
  en: { dir: 'ltr', label: 'English' },
  ar: { dir: 'rtl', label: 'العربية' },
};

export const DEFAULT_LOCALE = 'en';

const BASE = new URL('../i18n/', import.meta.url);

/** @type {{ lang: string, strings: Record<string, unknown> }} */
let current = { lang: DEFAULT_LOCALE, strings: {} };

const cache = new Map();

/** Walks a dotted key path. Returns undefined rather than throwing. */
function lookup(strings, key) {
  return key.split('.').reduce((node, part) => {
    if (node && typeof node === 'object' && part in node) return node[part];
    return undefined;
  }, strings);
}

/**
 * Translates a key. Interpolates {name} placeholders from `vars`.
 * A missing key returns the key itself, so a gap is obvious on screen and in
 * tests rather than rendering as empty space.
 *
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const value = lookup(current.strings, key);
  if (typeof value !== 'string') return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match
  );
}

/**
 * A record's own text in the language in use. Records carry their words in
 * both languages as a pair of fields: nameEn/nameAr, displayNameEn/displayNameAr.
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {string} [field]  the pair's stem
 * @returns {string}
 */
export function localized(record, field = 'name') {
  const own = record?.[`${field}${current.lang === 'ar' ? 'Ar' : 'En'}`];
  return String(own || record?.[`${field}En`] || '');
}

/** The language in use. */
export function getLocale() {
  return current.lang;
}

/** The direction in use: 'ltr' or 'rtl'. */
export function getDirection() {
  return LOCALES[current.lang]?.dir ?? 'ltr';
}

async function fetchStrings(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const res = await fetch(new URL(`${lang}.json`, BASE));
  if (!res.ok) throw new Error(`Could not load strings for "${lang}": ${res.status}`);
  const strings = await res.json();
  cache.set(lang, strings);
  return strings;
}

/**
 * Loads a language, points <html lang> and <html dir> at it, and fills in every
 * data-i18n hook in `root`.
 *
 * @param {string} lang
 * @param {ParentNode} [root]
 */
export async function setLocale(lang, root = document) {
  const code = lang in LOCALES ? lang : DEFAULT_LOCALE;
  current = { lang: code, strings: await fetchStrings(code) };

  const html = document.documentElement;
  html.lang = code;
  html.dir = LOCALES[code].dir;

  apply(root);
  return code;
}

/**
 * Fills in translation hooks under `root`.
 *
 * - data-i18n="key"                      sets textContent
 * - data-i18n-html="key"                 sets textContent, keeping child
 *                                        elements that carry their own hooks
 * - data-i18n-attr="attr:key, attr:key"  sets attributes
 * - data-i18n-vars='{"count": 3}'        supplies interpolation values
 *
 * @param {ParentNode} [root]
 */
export function apply(root = document) {
  const varsFor = (el) => {
    const raw = el.dataset.i18nVars;
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };

  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n, varsFor(el));
  }

  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key, varsFor(el)));
    }
  }
}
