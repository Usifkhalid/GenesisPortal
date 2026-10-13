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
  // By design: a second sync request while one runs answers 409 and the page
  // says so. Two projects share one database, so a test can meet it.
  /status of 409 .*\/api\/admin\/directory\/sync\)$/,
  // By design: a room taken while its booking dialog was open answers 409
  // room_conflict, and the dialog says so (rooms.spec.js makes it happen).
  /status of 409 .*\/api\/bookings\)$/,
  // By design: someone else's ticket is 404, so a ticket's existence is not
  // learned from its address (tickets.spec.js opens one as other people).
  /status of 404 .*\/api\/tickets\/[\w-]+\)$/,
  // By design: the development outbox draws an email in a sandboxed frame with
  // no scripts; what is "blocked" is Playwright's own injected script.
  /Blocked script execution in 'about:srcdoc'/,
];

export const test = base.extend({
  /**
   * Console errors a spec expects on purpose (resilience.spec.js breaks the
   * network and the server): `test.use({ allowedErrors: /net::ERR_/ })`. One
   * expression, because Playwright reads an array here as a [value, options] pair.
   */
  allowedErrors: [null, { option: true }],

  page: async ({ page, allowedErrors }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = `${message.text()} (${message.location().url})`;
      if (!IGNORED_ERRORS.some((known) => known.test(text)) && !allowedErrors?.test(text)) {
        errors.push(`console: ${text}`);
      }
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
 * Finds a seeded mock user. `role` is HoldingAdmin, CompanyAdmin or User;
 * `name` (the English display name) picks one person among several.
 * @returns {Promise<{ id: string, displayNameEn: string, displayNameAr: string, company: object }>}
 */
export async function findUser(page, { company, role = 'User', name = null }) {
  const response = await page.request.get('/api/auth/mock-users');
  expect(response.ok(), 'mock sign-in is on').toBeTruthy();

  const { companies } = await response.json();
  const home = companies.find((c) => c.code === company);
  // A directory sync (directory.spec) adds people with no Arabic name; the
  // seeded ones have one, so they stay the ones every other spec signs in as.
  const person = home?.users.find(
    (u) => u.role === role && u.displayNameAr && (!name || u.displayNameEn === name)
  );
  if (!person) throw new Error(`No seeded ${role} in ${company}`);
  return { ...person, company: home };
}

/**
 * Signs in through the login page and waits for the shell.
 * @param {import('@playwright/test').Page} page
 * @param {{ company: string, role?: string, name?: string, lang?: string }} who
 * @returns the person signed in, as findUser returns it
 */
export async function signIn(page, { company, role = 'User', name = null, lang = 'en' }) {
  await openLogin(page, lang);
  const person = await findUser(page, { company, role, name });

  await page.locator(`[data-user-id="${person.id}"]`).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.locator('#menuUserName')).not.toBeEmpty();
  return person;
}

/** Signs out from the account menu and waits for the login page. */
export async function signOut(page) {
  // Whatever the page is still asking for finishes first: a request that
  // meets the closed session is a 401 in the console, and that is a test
  // racing itself, not the portal failing.
  await page.waitForLoadState('networkidle');
  await page.locator('#userMenuBtn').click();
  await page.locator('#signOutBtn').click();
  // Under load the redirect can supersede a request the page still had in
  // flight, which Playwright reports as an aborted navigation: the page is
  // then on the login screen all the same.
  await page.waitForURL('**/login.html', { waitUntil: 'commit' });
  await page.waitForLoadState('load');
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

/** 0..3 for this run: language by screen. The four run in parallel on one database. */
export function runIndex(page, lang) {
  const wide = page.viewportSize().width > 600;
  return (lang === 'en' ? 0 : 2) + (wide ? 0 : 1);
}

/**
 * A working day (Sunday to Thursday) at least a week away, different for each
 * of the 4 runs and each numbered test, as "YYYY-MM-DD".
 */
export function bookableDay(page, lang, testNo) {
  const days = [];
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 7);
  while (days.length < 40) {
    if (date.getUTCDay() <= 4) days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days[testNo * 4 + runIndex(page, lang)];
}

/** The header a request that changes state needs, for the page's own session. */
export async function csrfHeaders(page) {
  const config = await (await page.request.get('/api/auth/config')).json();
  return { 'X-CSRF-Token': config.csrfToken };
}

/**
 * An instant for a Cairo wall time, asked of the browser (which knows the
 * zone's rules) so a spec carries no offset table of its own.
 */
export async function cairoInstant(page, day, time) {
  return page.evaluate(
    async ([ymd, hhmm]) => {
      const { fromCairoInput } = await import('/assets/js/format.js');
      return fromCairoInput(`${ymd}T${hhmm}`);
    },
    [day, time]
  );
}

/**
 * As the signed-in IT Lead, gives a ticket to an agent by name. An agent works
 * only the tickets assigned to them (docs/DECISIONS.md D122), so a spec that
 * has an agent reply or change a status has the Lead hand it over first.
 */
export async function assignTicket(page, ticketId, agentName) {
  const options = await (await page.request.get('/api/tickets/queue/options')).json();
  const agent = options.agents.find((a) => a.displayNameEn === agentName);
  if (!agent) throw new Error(`No IT agent called ${agentName}`);
  const res = await page.request.patch(`/api/tickets/${ticketId}`, {
    headers: await csrfHeaders(page),
    data: { assigneeId: agent.id },
  });
  expect(res.ok(), 'the Lead assigns the ticket').toBeTruthy();
}
