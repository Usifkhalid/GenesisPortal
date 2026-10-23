/**
 * smoke.spec.js — the portal's front door, in both languages on both screens:
 * the login page, signing in, Home, signing out.
 *
 * Run with `npm run test:e2e` after any change to the frontend or to sign-in.
 * New flows get a spec of their own beside this one, built on helpers.js.
 */

import {
  LANGUAGES,
  expect,
  expectLanguage,
  expectNoSidewaysScroll,
  openLogin,
  signIn,
  signOut,
  t,
  test,
} from './helpers.js';

const PEOPLE = [
  { label: 'a GEN user', company: 'GEN', role: 'User', admin: false },
  { label: 'the holding admin', company: 'HLD', role: 'HoldingAdmin', admin: true },
];

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('the login page lists the seeded users', async ({ page }) => {
      await openLogin(page, lang);

      await expect(page).toHaveTitle(t(lang, 'login.pageTitle'));
      await expect(page.locator('.login__title')).toHaveText(t(lang, 'login.title'));
      await expect(page.locator('.login__company')).toHaveCount(3);
      // The twelve seeded people, and more once a directory sync has run.
      await expect(page.locator('[data-user-id]').first()).toBeVisible();
      expect(await page.locator('[data-user-id]').count()).toBeGreaterThanOrEqual(12);
      await expectNoSidewaysScroll(page);
    });

    for (const who of PEOPLE) {
      test(`${who.label} signs in, sees Home and signs out`, async ({ page }) => {
        const person = await signIn(page, { ...who, lang });
        const name = lang === 'ar' ? person.displayNameAr : person.displayNameEn;
        const companyName = lang === 'ar' ? person.company.nameAr : person.company.nameEn;

        // The shell: the language carried over, and it knows who this is.
        await expectLanguage(page, lang);
        await expect(page.locator('#menuUserName')).toHaveText(name);
        await expect(page.locator('#menuUserCompany')).toContainText(companyName);

        // Home: greeted by first name, every card drawn and none left loading.
        await expect(page.locator('#homeGreeting')).toContainText(name.split(' ')[0]);
        // The four cards: bookings, IT Support (a link to the helpdesk app,
        // D146), the directory and the news.
        await expect(page.locator('[data-card]')).toHaveCount(4);
        await expect(page.locator('#page [aria-busy="true"]')).toHaveCount(0);
        await expectNoSidewaysScroll(page);

        // Only an admin is told about administration.
        const me = await (await page.request.get('/api/me')).json();
        expect(me.nav.some((item) => item.group === 'admin')).toBe(who.admin);

        // The session survives a reload.
        await page.reload();
        await expect(page.locator('#homeGreeting')).toBeVisible();

        await page.locator('#userMenuBtn').click();
        await expect(page.locator('#signOutBtn')).toHaveText(t(lang, 'nav.signOut'));
        await page.keyboard.press('Escape');

        await signOut(page);
        await expectLanguage(page, lang);
        await expect(page.locator('[data-user-id]').first()).toBeVisible();
        expect(await page.locator('[data-user-id]').count()).toBeGreaterThanOrEqual(12);

        // The session is gone: the API says so and the portal sends you back.
        expect((await page.request.get('/api/me')).status()).toBe(401);
        await page.goto('/');
        await page.waitForURL('**/login.html');
      });
    }
  });
}
