/**
 * a11y-overlays.spec.js — axe-core over what is only on screen once it is
 * opened: the booking dialog, the announcement
 * editor, the bell, the account menu, the company menu, a person's panel,
 * the "More" sheet on a phone, and the administrator's move and cancel
 * dialogs. Both languages, both screens. Any serious or critical finding fails
 * the test; moderate and minor ones are printed.
 */

import AxeBuilder from '@axe-core/playwright';

import {
  LANGUAGES,
  bookableDay,
  cairoInstant,
  csrfHeaders,
  expect as strictExpect,
  expectLanguage,
  expectNoSidewaysScroll,
  runIndex,
  signIn,
  signOut,
  t,
  test,
} from './helpers.js';

const expect = strictExpect.configure({ timeout: 20_000 });

const STANDARDS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const isSerious = (violation) =>
  violation.impact === 'serious' || violation.impact === 'critical';

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

/** Nothing on the page is still fading in. */
async function still(page) {
  await page.waitForLoadState('networkidle');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length
      )
    )
    .toBe(0);
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('axe finds nothing serious in open dialogs, drawers and menus', async ({ page }) => {
      test.setTimeout(300_000);
      const wide = page.viewportSize().width > 600;
      const failures = [];
      const advice = [];

      const scan = async (name) => {
        await still(page);
        const { violations } = await new AxeBuilder({ page }).withTags(STANDARDS).analyze();
        for (const violation of violations) {
          (isSerious(violation) ? failures : advice).push(`${name}: ${describe(violation)}`);
        }
        await expectNoSidewaysScroll(page);
      };

      /* --------------------------- the shell's menus, as an ordinary user */
      await signIn(page, { company: 'GEN', role: 'User', name: 'Salma Ibrahim', lang });
      await expectLanguage(page, lang);
      await expect(page.locator('#page h1').first()).toBeVisible();

      await page.locator('#notifBtn').click();
      await expect(page.locator('#notifMenu')).toBeVisible();
      await scan('bell');
      await page.keyboard.press('Escape');

      await page.locator('#userMenuBtn').click();
      await expect(page.locator('#userMenu')).toBeVisible();
      await scan('account menu');
      await page.keyboard.press('Escape');

      if (!wide) {
        await page.locator('#moreBtn').click();
        await expect(page.locator('#moreSheet[open]')).toBeVisible();
        await scan('more sheet');
        await page.keyboard.press('Escape');
      }

      /* ------------------------------------------ a person's panel */
      await page.goto('/#directory');
      await expect(page.locator('.dir-card').first()).toBeVisible();
      await page.locator('.dir-card__link').first().click();
      await expect(page.locator('dialog.dir-drawer[open]')).toBeVisible();
      await scan('person panel');
      await page.keyboard.press('Escape');

      /* ------------------------------------------- the booking dialog */
      const day = bookableDay(page, lang, 8);
      await page.goto(`/#rooms?date=${day}&start=15:00&duration=60&people=2`);
      await expect(page.locator('#freeBody [data-book]').first()).toBeVisible();
      await page.locator('#freeBody [data-book]').first().click();
      await expect(page.locator('dialog.booking-dialog[open]')).toBeVisible();
      await scan('booking dialog');
      await page.keyboard.press('Escape');

      /* ------------------- a booking, for the administrator's dialogs */
      const subject = `Overlay ${lang} ${runIndex(page, lang)} ${Date.now()}`;
      const rooms = (await (await page.request.get('/api/rooms')).json()).items;
      const booked = await page.request.post('/api/bookings', {
        headers: await csrfHeaders(page),
        data: {
          roomId: rooms.find((r) => r.nameEn === 'Meeting Room 2').id,
          subject,
          start: await cairoInstant(page, day, '09:00'),
          end: await cairoInstant(page, day, '10:00'),
        },
      });
      expect(booked.ok(), 'the user’s booking').toBeTruthy();

      /* -------------------- the administrator's dialogs and the editor */
      await signOut(page);
      await signIn(page, { company: 'HLD', role: 'HoldingAdmin', lang });
      const companyButton = page.locator(wide ? '#companyBtn' : '#companyBtnTop');
      if (await companyButton.isEnabled()) {
        await companyButton.click();
        await scan('company menu');
        await page.keyboard.press('Escape');
      }

      await page.goto(`/#admin/bookings?from=${day}&to=${day}`);
      const row = page.locator('#abBody tbody tr', { hasText: subject });
      await expect(row).toHaveCount(1);
      await row.locator('[data-move]').click();
      await expect(page.locator('dialog[open] #mvForm')).toBeVisible();
      await scan('move dialog');
      await page.keyboard.press('Escape');
      await row.locator('[data-cancel]').click();
      await expect(page.locator('dialog[open] #abkForm')).toBeVisible();
      await scan('cancel dialog');
      await page.keyboard.press('Escape');

      await page.goto('/#announcements/new');
      await expect(page.locator('#page h1').first()).toBeVisible();
      await scan('announcement editor');

      if (advice.length) console.log(`axe advice (${lang}):\n  ${advice.join('\n  ')}`);
      expect(failures, 'serious or critical accessibility findings').toEqual([]);
      expect(t(lang, 'nav.help')).toBeTruthy();
    });
  });
}
