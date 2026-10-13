/**
 * a11y.spec.js — axe-core over every page of the portal in both languages, and
 * the two main flows (booking a room, raising a ticket) used with the keyboard
 * alone.
 *
 * Runs on both screens (1440 and 360 px). Any serious or critical axe finding
 * fails the test; moderate and minor ones are printed so they can be read, not
 * ignored. Nothing is excluded from the scan: a finding that cannot be fixed
 * belongs in docs/DECISIONS.md, not in a rule switched off here.
 */

import AxeBuilder from '@axe-core/playwright';

import {
  LANGUAGES,
  bookableDay,
  expect as strictExpect,
  expectLanguage,
  expectNoSidewaysScroll,
  runIndex,
  signIn,
  t,
  test,
} from './helpers.js';

const expect = strictExpect.configure({ timeout: 20_000 });

/** Every address a signed-in person can reach, as a hash. */
const ROUTES = [
  '#home',
  '#announcements',
  '#announcements/manage',
  '#announcements/new',
  '#rooms',
  '#rooms/day',
  '#rooms/mine',
  '#tickets',
  '#tickets/new',
  '#tickets/queue',
  '#tickets/settings',
  '#directory',
  '#admin/companies',
  '#admin/departments',
  '#admin/admins',
  '#admin/quality',
  '#admin/sync',
  '#admin/rooms',
  '#admin/bookings',
  '#admin/helpdesk',
  '#audit-log',
  '#notifications',
  '#notifications/preferences',
  '#help',
];

const STANDARDS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const isSerious = (violation) =>
  violation.impact === 'serious' || violation.impact === 'critical';

/** What went wrong, in a line a person can act on. */
function describe(violation) {
  const where = violation.nodes
    .slice(0, 3)
    .map((node) => node.target.join(' '))
    .join(' | ');
  const data = violation.nodes[0]?.any[0]?.data;
  const detail = data?.contrastRatio
    ? ` [${data.fgColor} on ${data.bgColor}, ${data.contrastRatio}:1]`
    : '';
  return `${violation.impact} ${violation.id}: ${violation.help} (${violation.nodes.length}) -> ${where}${detail}`;
}

/** Waits until the page has drawn: no skeleton and nothing still loading. */
async function settled(page) {
  await expect(page.locator('#page [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('#page .skeleton')).toHaveCount(0);
  await expect(page.locator('#page h1').first()).toBeVisible();
  // Searches and counts that start once the page is up.
  await page.waitForLoadState('networkidle');
  // A colour still in transition or fading in is not the colour a person is
  // left with: wait until nothing on the page is animating.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length
      )
    )
    .toBe(0);
}

/** Presses Tab until `selector` has focus, as a keyboard user would. */
async function tabTo(page, selector, { max = 80 } = {}) {
  for (let i = 0; i < max; i++) {
    const focused = await page.evaluate(
      (sel) => document.activeElement?.matches(sel) ?? false,
      selector
    );
    if (focused) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${selector} in ${max} presses`);
}

/** A modal dialog keeps focus inside it; past its last control focus leaves for the browser, never for the page behind. */
const focusStaysInDialog = (page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    return active === document.body || active?.closest('dialog') != null;
  });

const focusIsInDialog = (page) =>
  page.evaluate(() => document.activeElement?.closest('dialog') != null);

/** The focus ring of whatever has focus, so a failure says what was drawn. */
const focusRing = (page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
  });

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('axe finds nothing serious on any page', async ({ page }) => {
      test.setTimeout(300_000);
      await signIn(page, { company: 'HLD', role: 'HoldingAdmin', lang });
      await expectLanguage(page, lang);

      const failures = [];
      const advice = [];

      for (const hash of ROUTES) {
        await page.goto(`/${hash}`);
        await settled(page);

        const { violations } = await new AxeBuilder({ page }).withTags(STANDARDS).analyze();
        for (const violation of violations) {
          (isSerious(violation) ? failures : advice).push(`${hash}: ${describe(violation)}`);
        }
        await expectNoSidewaysScroll(page);
      }

      if (advice.length) console.log(`axe advice (${lang}):\n  ${advice.join('\n  ')}`);
      expect(failures, 'serious or critical accessibility findings').toEqual([]);
    });

    test('axe finds nothing serious on the login page', async ({ page }) => {
      await page.goto('/login.html');
      await page.locator(`.login__bar [data-lang="${lang}"]`).click();
      await expect(page.locator('#main')).toHaveAttribute('data-mode', 'mock');
      await expect(page.locator('[data-user-id]').first()).toBeVisible();

      const { violations } = await new AxeBuilder({ page }).withTags(STANDARDS).analyze();
      expect(violations.filter(isSerious).map(describe)).toEqual([]);
    });

    test('a room is booked and cancelled with the keyboard alone', async ({ page }) => {
      await signIn(page, { company: 'GEN', role: 'User', lang });
      const day = bookableDay(page, lang, 7);
      const subject = `Keyboard ${lang} ${runIndex(page, lang)}`;

      await page.goto(`/#rooms?date=${day}&start=13:00&duration=60&people=2`);
      await settled(page);
      await expect(page.locator('#freeBody [data-book]').first()).toBeVisible();

      // Tab reaches Book, and it shows where focus is.
      await tabTo(page, '#freeBody .record:first-child [data-book]');
      const ring = await focusRing(page);
      expect(
        ring.outlineStyle !== 'none' || ring.boxShadow !== 'none',
        'focus is visible'
      ).toBe(true);
      await page.keyboard.press('Enter');

      // The dialog takes focus and Tab stays inside it.
      const dialog = page.locator('dialog.booking-dialog[open]');
      await expect(dialog).toBeVisible();
      expect(await focusIsInDialog(page), 'focus moved into the dialog').toBe(true);
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Tab');
        expect(await focusStaysInDialog(page), 'Tab never reaches the page behind').toBe(true);
      }

      await tabTo(page, '#bkSubject');
      await page.keyboard.press('Control+A');
      await page.keyboard.type(subject);
      await tabTo(page, '#bkSubmit');
      await page.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.find__done')).toBeVisible();

      // Focus was not dropped to <body> when the dialog closed.
      expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);

      // My bookings: cancel it, still with the keyboard.
      await page.goto('/#rooms/mine');
      await settled(page);
      await expect(page.locator('#mineBody .record', { hasText: subject })).toBeVisible();
      for (let i = 0; i < 80; i++) {
        const onOwnCancel = await page.evaluate(
          (text) =>
            document.activeElement?.matches('[data-cancel]') &&
            document.activeElement.closest('.record')?.textContent.includes(text),
          subject
        );
        if (onOwnCancel) break;
        await page.keyboard.press('Tab');
      }
      await page.keyboard.press('Enter');
      await expect(page.locator('dialog[open]')).toContainText(
        t(lang, 'rooms.mine.cancelTitle')
      );
      await tabTo(page, 'dialog[open] [data-confirm]');
      await page.keyboard.press('Enter');
      await expect(page.locator('#mineBody .record', { hasText: subject })).toHaveCount(0);
    });

    test('a ticket is raised and answered with the keyboard alone', async ({ page }) => {
      await signIn(page, { company: 'GEN', role: 'User', name: 'Salma Ibrahim', lang });
      const subject = `Keyboard ticket ${lang} ${runIndex(page, lang)} ${Date.now()}`;

      await page.goto('/#tickets/new');
      await expect(page.locator('#tkNew')).toBeVisible();

      await tabTo(page, '.tk-tile__input');
      await page.keyboard.press('Space');
      await expect(page.locator('.tk-tile__input:checked')).toHaveCount(1);

      await tabTo(page, '#tkSubject');
      await page.keyboard.type(subject);
      await tabTo(page, '#tkDescription');
      await page.keyboard.type('Typed without a mouse.');

      await tabTo(page, 'input[name="priority"]');
      await page.keyboard.press('Space');
      await expect(page.locator('input[name="priority"]:checked')).toHaveCount(1);

      await tabTo(page, '#tkSubmit');
      await page.keyboard.press('Enter');
      await expect(page.locator('#tkDone')).toBeVisible();

      // Open the ticket from the confirmation, add a reply, send it.
      await tabTo(page, '#tkDone a.btn--primary');
      await page.keyboard.press('Enter');
      await expect(page.locator('#tkSubject')).toContainText(subject);

      await tabTo(page, '#tkReplyText');
      await page.keyboard.type(`Another detail ${lang}`);
      await tabTo(page, '#tkReply button[type="submit"]');
      await page.keyboard.press('Enter');
      await expect(page.locator('.tk-timeline')).toContainText(`Another detail ${lang}`);
      await expectNoSidewaysScroll(page);
    });
  });
}
