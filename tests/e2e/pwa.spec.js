/**
 * pwa.spec.js — installable and usable with no signal.
 *
 * The development server serves the worker only to a browser that sends the
 * cookie portal_sw=on, so these tests turn it on for themselves and every
 * other spec runs where a worker cannot hide a file edit. One test per promise the worker makes:
 *
 *   - the manifest names the portal in both languages and its icons exist;
 *   - the shell is saved on first visit;
 *   - with the network gone the shell still opens, says so, and shows the last
 *     saved answers; coming back clears the notice;
 *   - an address that was never saved gets the friendly offline page;
 *   - signing out deletes what the worker saved for that person.
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

// The development server serves the worker only to a browser that asks for it.
test.use({ serviceWorkers: 'allow' });

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'portal_sw', value: 'on', url: baseURL }]);
});

/** Waits until a worker controls the page, which is when it is saved. */
async function controlled(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
      );
    }
  });
}

const cacheKeys = (page) => page.evaluate(() => caches.keys());

const savedUrls = (page, prefix) =>
  page.evaluate(async (wanted) => {
    const urls = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith(wanted)) continue;
      for (const request of await (await caches.open(name)).keys()) {
        urls.push(new URL(request.url).pathname);
      }
    }
    return urls;
  }, prefix);

test('the manifest names the portal in both languages and its icons exist', async ({
  page,
  request,
}) => {
  await page.goto('/login.html');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(`/${href}`)).json();

  expect(manifest.name).toContain('MG Holding');
  expect(manifest.name).toMatch(/[؀-ۿ]/);
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);

  for (const icon of manifest.icons) {
    const response = await request.get(`/${icon.src}`);
    expect(response.ok(), icon.src).toBe(true);
    expect(response.headers()['content-type']).toBe('image/png');
  }
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
    'content',
    /^#[0-9a-f]{6}$/i
  );
});

test('the worker is versioned and saves the shell', async ({ page, context }) => {
  const worker = await (await context.request.get('/sw.js')).text();
  expect(worker).not.toContain('__VERSION__');
  expect(worker).not.toContain('/*__PRECACHE__*/ []');
  expect(worker).toMatch(/const VERSION = "[0-9a-f]{12}"/);

  await page.goto('/login.html');
  await controlled(page);

  const saved = await savedUrls(page, 'portal-static-');
  for (const url of [
    '/',
    '/login.html',
    '/offline.html',
    '/manifest.webmanifest',
    '/assets/css/tokens.css',
    '/assets/js/app.js',
    '/assets/i18n/en.json',
    '/assets/i18n/ar.json',
  ]) {
    expect(saved, `${url} is saved`).toContain(url);
  }
  // Page modules are fetched when asked for, not up front.
  expect(saved).not.toContain('/assets/js/pages/tickets.js');

  const names = await cacheKeys(page);
  expect(names.filter((n) => n.startsWith('portal-static-'))).toHaveLength(1);
});

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('with no signal the shell opens, says so, and shows what was saved', async ({
      page,
      context,
    }) => {
      await signIn(page, { company: 'GEN', role: 'User', lang });
      await controlled(page);
      // Visit a page so its module and answers are saved on the way.
      await page.goto('/#tickets');
      await expect(page.locator('#page h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.goto('/');
      await expect(page.locator('#menuUserName')).not.toBeEmpty();
      const name = await page.locator('#menuUserName').textContent();

      await context.setOffline(true);
      await page.reload();

      // The shell drew from the device and knows who is using it.
      await expect(page.locator('#menuUserName')).toHaveText(name);
      await expectLanguage(page, lang);
      const banner = page.locator('#statusBanner');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(t(lang, 'pwa.offline.title'));
      await expectNoSidewaysScroll(page);

      // A page that was visited still opens, from what was saved.
      await page.evaluate(() => {
        location.hash = '#tickets';
      });
      await expect(page.locator('#page h1').first()).toBeVisible();

      // Back online: the notice goes away and "Try again" is not needed.
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(banner).toBeHidden();
    });

    test('an address that was never saved gets the offline page', async ({ page, context }) => {
      await openLogin(page, lang);
      await controlled(page);
      // The type the page is set in is saved a moment after the worker takes over.
      const fonts =
        lang === 'ar'
          ? ['plex-sans-latin', 'plex-arabic-arabic-400', 'plex-arabic-arabic-600']
          : ['plex-sans-latin'];
      await expect
        .poll(
          async () =>
            (await savedUrls(page, 'portal-static-')).filter((u) => u.includes('/fonts/plex'))
              .length
        )
        .toBe(fonts.length);

      await context.setOffline(true);
      await page.goto('/styleguide.html');

      await expect(page).toHaveURL(/styleguide\.html$/);
      await expect(page.locator('h1')).toHaveText(t(lang, 'offline.title'));
      await expectLanguage(page, lang);
      await expect(page.locator('#offlineRetry')).toBeVisible();
      await expectNoSidewaysScroll(page);

      await context.setOffline(false);
    });

    test('signing out deletes what the worker saved', async ({ page }) => {
      await signIn(page, { company: 'GEN', role: 'User', lang });
      await controlled(page);
      await page.goto('/');
      await expect(page.locator('#menuUserName')).not.toBeEmpty();
      await page.waitForLoadState('networkidle');

      expect(await savedUrls(page, 'portal-api-'), 'answers were saved').toContain('/api/me');

      await signOut(page);
      expect(await savedUrls(page, 'portal-api-'), 'nothing of the person is left').toEqual([]);
    });
  });
}
