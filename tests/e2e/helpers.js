/**
 * helpers.js — what every end-to-end test needs: sign in as a seeded user, sign
 * out, read the i18n files, and the checks that hold on every screen.
 *
 * Import `test` and `expect` from here, not from @playwright/test: this `test`
 * fails any test whose page logged an error or threw.
 */

import { readFileSync } from 'node:fs';

import { test as base, expect } from '@playwright/test';

export { expect };

export const LANGUAGES = ['en', 'ar'];
const DIRECTION = { en: 'ltr', ar: 'rtl' };

const IGNORED_ERRORS = [
  // Known and open (docs/PROGRESS.md): the portal has no favicon yet.
  /favicon\.ico/,
  // By design: the shell asks who is signed in, and Chromium logs the 401 that
  // sends a signed-out visitor to the login page.
  /status of 401 .*\/api\/me\)$/,
];

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = `${message.text()} (${message.location().url})`;
      if (!IGNORED_ERRORS.some((known) => known.test(text))) errors.push(`console: ${text}`);
    });

    await use(page);

    expect(errors, 'the page logged no errors').toEqual([]);
  },
});

const messages = {};

/** The text behind an i18n key, e.g. t('ar', 'nav.signOut'). */
export function t(lang, key) {
  messages[lang] ??= JSON.parse(
    readFileSync(new URL(`../../frontend/assets/i18n/${lang}.json`, import.meta.url), 'utf8')
  );
  const text = key.split('.').reduce((node, part) => node?.[part], messages[lang]);
  if (typeof text !== 'string') throw new Error(`No i18n text for ${lang}:${key}`);
  return text;
}

/** <html lang dir> follows the language. */
export async function expectLanguage(page, lang) {
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', lang);
  await expect(html).toHaveAttribute('dir', DIRECTION[lang]);
}

/** Nothing is wider than the screen. */
export async function expectNoSidewaysScroll(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
}

/**
 * Opens the login page in `lang` and leaves it showing the mock users.
 * The language is chosen with the page's own switch, as a person would.
 */
export async function openLogin(page, lang = 'en') {
  await page.goto('/login.html');
  await page.locator(`.login__bar [data-lang="${lang}"]`).click();
  await expectLanguage(page, lang);
  await expect(page.locator('#main')).toHaveAttribute('data-mode', 'mock');
}

/**
 * Finds a seeded mock user. `role` is HoldingAdmin, CompanyAdmin or User.
 * @returns {Promise<{ id: string, displayNameEn: string, displayNameAr: string, company: object }>}
 */
export async function findUser(page, { company, role = 'User' }) {
  const response = await page.request.get('/api/auth/mock-users');
  expect(response.ok(), 'mock sign-in is on').toBeTruthy();

  const { companies } = await response.json();
  const home = companies.find((c) => c.code === company);
  const person = home?.users.find((u) => u.role === role);
  if (!person) throw new Error(`No seeded ${role} in ${company}`);
  return { ...person, company: home };
}

/**
 * Signs in through the login page and waits for the shell.
 * @param {import('@playwright/test').Page} page
 * @param {{ company: string, role?: string, lang?: string }} who
 * @returns the person signed in, as findUser returns it
 */
export async function signIn(page, { company, role = 'User', lang = 'en' }) {
  await openLogin(page, lang);
  const person = await findUser(page, { company, role });

  await page.locator(`[data-user-id="${person.id}"]`).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.locator('#menuUserName')).not.toBeEmpty();
  return person;
}

/** Signs out from the account menu and waits for the login page. */
export async function signOut(page) {
  await page.locator('#userMenuBtn').click();
  await page.locator('#signOutBtn').click();
  await page.waitForURL('**/login.html');
}

/**
 * Saves a screenshot to test-results/shots when E2E_SHOTS=1, for a design
 * review (`E2E_SHOTS=1 npm run test:e2e`). A no-op otherwise.
 */
export async function shot(page, name) {
  if (process.env.E2E_SHOTS !== '1') return;
  const project = page.context()._options?.viewport?.width ?? 'x';
  await page.screenshot({ path: `test-results/shots/${name}-${project}.png`, fullPage: true });
}
