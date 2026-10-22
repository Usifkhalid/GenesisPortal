/**
 * strings.js — what an app's strings must hold (CLAUDE.md rule 2): every
 * bundle has the same keys in English and Arabic, and every key a page names
 * literally (t('…'), data-i18n, titleKey, …) is in the bundles that app loads.
 * Keys built at run time (t(`tk.status.${s}`)) are not checked here.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const LANGS = ['en', 'ar'];

const leaves = (node, prefix = []) =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? leaves(value, [...prefix, key])
      : [[...prefix, key].join('.')]
  );

const merge = (a, b) => {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) {
    out[key] = value && typeof value === 'object' && out[key] ? merge(out[key], value) : value;
  }
  return out;
};

/** The first of `dirs` that has assets/i18n/<bundle>.<lang>.json. */
const bundleFile = (dirs, bundle, lang) =>
  dirs
    .map((dir) => path.join(dir, 'assets', 'i18n', `${bundle}.${lang}.json`))
    .find(existsSync);

/**
 * @param {{ bundles: string[], dirs: string[] }} app  its bundles in load order and its
 *   static folders, its own first
 * @returns {{ unpaired: string[], missing: string[] }}
 */
export function checkStrings({ bundles, dirs }) {
  const unpaired = [];
  const merged = {};
  for (const bundle of bundles) {
    const read = (lang) => JSON.parse(readFileSync(bundleFile(dirs, bundle, lang), 'utf8'));
    const [en, ar] = LANGS.map(read);
    const enKeys = new Set(leaves(en));
    const arKeys = new Set(leaves(ar));
    for (const key of enKeys)
      if (!arKeys.has(key)) unpaired.push(`${bundle}: ${key} (no Arabic)`);
    for (const key of arKeys)
      if (!enKeys.has(key)) unpaired.push(`${bundle}: ${key} (no English)`);
    merged.en = merge(merged.en ?? {}, en);
    merged.ar = merge(merged.ar ?? {}, ar);
  }

  const has = (lang, key) =>
    typeof key.split('.').reduce((node, part) => node?.[part], merged[lang]) === 'string';
  const named =
    /(?:\bt\(\s*|data-i18n(?:-html)?=|titleKey:\s*|textKey:\s*)['"]([a-zA-Z]+(?:\.[a-zA-Z0-9_]+)+)['"]/g;
  const missing = new Set();
  for (const dir of dirs) {
    for (const name of readdirSync(dir, { recursive: true })) {
      const file = path.join(dir, name);
      if (!/\.(js|html)$/.test(name) || !statSync(file).isFile()) continue;
      const text = readFileSync(file, 'utf8')
        // Doc comments show how to use t(); they name no real key.
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const keys = [...text.matchAll(named)].map((m) => m[1]);
      for (const m of text.matchAll(/data-i18n-attr="([^"]+)"/g)) {
        for (const pair of m[1].split(',')) keys.push(pair.split(':')[1]?.trim());
      }
      for (const key of keys.filter(Boolean)) {
        for (const lang of LANGS) if (!has(lang, key)) missing.add(`${key} (${lang}, ${name})`);
      }
    }
  }
  return { unpaired, missing: [...missing] };
}
