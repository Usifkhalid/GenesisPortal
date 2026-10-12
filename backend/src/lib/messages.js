/**
 * messages.js — the interface strings for the places the backend writes words
 * itself (email). It reads the same assets/i18n files the pages do, so a
 * notification says the same thing on screen and in the inbox, and no sentence
 * lives in two files (CLAUDE.md rule 2).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FRONTEND_DIR } from '../config/env.js';

const cache = new Map();

function strings(lang) {
  const name = lang === 'ar' ? 'ar' : 'en';
  if (!cache.has(name)) {
    cache.set(
      name,
      JSON.parse(readFileSync(join(FRONTEND_DIR, 'assets', 'i18n', `${name}.json`), 'utf8'))
    );
  }
  return cache.get(name);
}

const lookup = (tree, key) =>
  key
    .split('.')
    .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), tree);

/**
 * Same contract as the frontend's `t`: {name} placeholders filled from `vars`,
 * and a missing key answers with the key itself.
 * @param {string} lang  'en' | 'ar'
 * @returns {(key: string, vars?: Record<string, string>) => string}
 */
export function translator(lang) {
  const tree = strings(lang);
  return (key, vars) => {
    const value = lookup(tree, key);
    if (typeof value !== 'string') return key;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? vars[name] : match));
  };
}

/** One string in both languages, for a payload var that is a name or a label. */
export function bothLanguages(key, vars) {
  return { en: translator('en')(key, vars), ar: translator('ar')(key, vars) };
}
