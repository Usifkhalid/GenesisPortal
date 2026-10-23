/**
 * itsupport.spec.js — the portal's way into the IT Helpdesk app (D146), in
 * English and Arabic at 1440 and 360 px: "IT Support" in the menu and on Home,
 * each opening the helpdesk in a new tab with rel="noopener"; the IT team using
 * the portal like everyone else; old ticket links and the old /helpdesk
 * address leading to the helpdesk.
 *
 * The helpdesk app does not run here: its address (HELPDESK_URL in
 * playwright.config.js) is answered by the test itself.
 */

import {
  LANGUAGES,
  expect,
  expectLanguage,
  expectNoSidewaysScroll,
  signIn,
  t,
  test,
} from './helpers.js';

const HELPDESK = 'http://localhost:3101';

/** Answers anything at the helpdesk's address with a stand-in page. */
async function standIn(context) {
  await context.route(`${HELPDESK}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>IT Helpdesk</title><h1>helpdesk</h1>',
    })
  );
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('IT Support is in the menu and on Home, and opens the helpdesk in a new tab', async ({
      page,
      context,
    }) => {
      await standIn(context);
      await signIn(page, { company: 'GEN', role: 'User', lang });
      await expectLanguage(page, lang);

      // The menu entry (the rail on a desktop, the bottom bar on a phone).
      const links = page.locator('[data-helpdesk-link]:visible');
      await expect(links).toHaveCount(1);
      const link = links.first();
      await expect(link).toContainText(t(lang, 'nav.itSupport'));
      await expect(link).toHaveAttribute('href', `${HELPDESK}/`);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);

      // The Home card and the banner button say the same.
      const card = page.locator('[data-card="itsupport"]');
      await expect(card).toBeVisible();
      await expect(card).toContainText(t(lang, 'home.itSupport.title'));
      const open = card.locator('a');
      await expect(open).toHaveAttribute('href', `${HELPDESK}/`);
      await expect(open).toHaveAttribute('target', '_blank');
      await expect(open).toHaveAttribute('rel', /noopener/);
      const banner = page.locator('.banner a', { hasText: t(lang, 'action.getItSupport') });
      await expect(banner).toHaveAttribute('href', `${HELPDESK}/#tickets/new`);
      await expect(banner).toHaveAttribute('rel', /noopener/);
      await expectNoSidewaysScroll(page);

      // Following it opens a second tab at the helpdesk and leaves the portal as it was.
      const [opened] = await Promise.all([context.waitForEvent('page'), open.click()]);
      await expect(opened).toHaveURL(`${HELPDESK}/`);
      expect(await opened.evaluate(() => window.opener)).toBeNull();
      await opened.close();
      await expect(page.locator('#homeGreeting')).toBeVisible();
    });

    test('the IT team uses the portal like everyone else', async ({ page, context }) => {
      await standIn(context);
      // Omar Fahmy leads the IT team in the helpdesk app's data.
      await signIn(page, { company: 'HLD', name: 'Omar Fahmy', lang });
      await expect(page).toHaveURL((url) => url.pathname === '/');
      await expect(page.locator('#homeGreeting')).toBeVisible();
      await page.goto('/#rooms');
      await expect(page.locator('#page h1').first()).toBeVisible();
      expect((await page.request.get('/api/announcements')).status()).toBe(200);
      // The helpdesk's API is not here.
      expect((await page.request.get('/api/tickets/mine')).status()).toBe(404);
    });

    test('old ticket links and the old /helpdesk address lead to the helpdesk', async ({
      page,
      context,
    }) => {
      await standIn(context);
      await signIn(page, { company: 'GEN', role: 'User', lang });

      // A ticket in the old portal, by number or by id, keeps what follows the hash.
      await page.goto('/#tickets/IT-2026-00004');
      await expect(page).toHaveURL(`${HELPDESK}/#tickets/IT-2026-00004`);
      await page.goto('/#tickets/2d6f1f0e-7a5c-4a53-9d0a-6f0b3a8f4c11?from=queue');
      await expect(page).toHaveURL(
        `${HELPDESK}/#tickets/2d6f1f0e-7a5c-4a53-9d0a-6f0b3a8f4c11?from=queue`
      );

      // The old IT workspace: the server sends the browser on (which keeps what
      // follows the hash, as an email's link carries it).
      for (const path of ['/helpdesk', '/helpdesk.html', '/helpdesk/queue']) {
        const old = await page.request.get(path, { maxRedirects: 0 });
        expect(old.status(), path).toBe(302);
        expect(old.headers().location, path).toBe(`${HELPDESK}/`);
      }

      // The portal's own notification centre has no ticket in it.
      await page.goto('/#notifications');
      await expect(page.locator('#page h1').first()).toBeVisible();
    });
  });
}
