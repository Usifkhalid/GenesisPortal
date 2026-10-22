/**
 * messages.js — the interface strings for the places the backend writes words
 * itself (email). It reads the same assets/i18n files the pages do, so a
 * notification says the same thing on screen and in the inbox, and no sentence
 * lives in two files (CLAUDE.md rule 2).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runtime } from '../config/runtime.js';

const cache = new Map();

/** b's keys laid over a's, at every depth. */
export function mergeStrings(a, b) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const both = value && typeof value === 'object' && out[key] && typeof out[key] === 'object';
    out[key] = both ? mergeStrings(out[key], value) : value;
  }
  return out;
}

/**
 * The running app's strings in one language: its bundles
 * (assets/i18n/<bundle>.<lang>.json, runtime.js) merged in order, each read
 * from the first of the app's static folders that has it, as the pages do.
 */
function strings(lang) {
  const name = lang === 'ar' ? 'ar' : 'en';
  if (!cache.has(name)) {
    const { frontendDirs, i18nBundles } = runtime();
    let merged = {};
    for (const bundle of i18nBundles) {
      const file = frontendDirs
        .map((dir) => join(dir, 'assets', 'i18n', `${bundle}.${name}.json`))
        .find((path) => existsSync(path));
      if (!file) throw new Error(`No strings file for "${bundle}.${name}".`);
      merged = mergeStrings(merged, JSON.parse(readFileSync(file, 'utf8')));
    }
    cache.set(name, merged);
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
