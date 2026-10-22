/**
 * sign-in-errors.spec.js — what the login page says when /auth/callback sends
 * someone back: an email domain no company owns, and Microsoft refusals put as
 * what to ask the Global Administrator for (D136). The server runs in mock
 * mode, so the page is opened with the reason the callback would add.
 */

import {
  LANGUAGES,
  expect,
  expectLanguage,
  expectNoSidewaysScroll,
  t,
  test,
} from './helpers.js';

const REASONS = ['company_not_set_up', 'consent_required', 'not_assigned', 'app_setup'];

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    for (const reason of REASONS) {
      test(`the login page explains "${reason}"`, async ({ page }) => {
        await page.goto(`/login.html?error=${reason}`);
        await page.locator(`.login__bar [data-lang="${lang}"]`).click();
        await expectLanguage(page, lang);

        const box = page.locator('#loginNotice');
        await expect(box).toBeVisible();
        await expect(box).toContainText(t(lang, `login.error.${reason}.title`));
        await expect(box).toContainText(t(lang, `login.error.${reason}.text`));
        // The reason is read once and tidied out of the address.
        expect(new URL(page.url()).searchParams.has('error')).toBe(false);
        await expectNoSidewaysScroll(page);
      });
    }

    test('an unknown reason shows nothing', async ({ page }) => {
      await page.goto('/login.html?error=made_up');
      await page.locator(`.login__bar [data-lang="${lang}"]`).click();
      await expectLanguage(page, lang);
      await expect(page.locator('#main')).toHaveAttribute('data-mode', 'mock');
      await expect(page.locator('#loginNotice')).toBeHidden();
    });
  });
}
