/**
 * resilience.spec.js — every page under the conditions a site phone actually
 * meets: very long names in both languages, no data at all, text enlarged to
 * 200%, and requests that fail (no signal, or a server error).
 *
 * The data is bent in the browser, not in the database: each API answer is
 * rewritten on its way to the page. That reaches every screen with no seeding,
 * leaves the shared test database alone, and means a page that stops working
 * under one of these conditions is found by address, not by guesswork.
 *
 * What must hold on every page, in every condition:
 *   - it drew something: the page, or a notice that says what went wrong, with
 *     no skeleton and nothing "busy" left behind;
 *   - nothing sticks out past the sides of the screen (the page itself does
 *     not scroll sideways, and no element hangs outside it unless it sits in
 *     a region made to scroll);
 *   - the page logged no error (helpers.js fails the test on one).
 */

import {
  LANGUAGES,
  expect as strictExpect,
  expectLanguage,
  expectNoSidewaysScroll,
  signIn,
  test,
} from './helpers.js';

const expect = strictExpect.configure({ timeout: 20_000 });

// The network and the server are broken on purpose: the browser says so in its
// console, and that is not a finding.
test.use({ allowedErrors: /net::ERR_|status of (500|0)|Failed to load resource/ });

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
];

/* ------------------------------------------------------- the bent answers */

const LONG = {
  en: 'Abdelrahman Mohamed Ibrahim El-Sayed El-Shafei El-Mansouri Al-Ansari Al-Qahiri Al-Iskandarani',
  ar: 'محمد عبد الرحمن إبراهيم السيد الشافعي المنصوري الأنصاري القاهري الإسكندراني الصعيدي',
};
/** A pasted link, a file name, a mailbox: no place to break. */
const UNBROKEN = 'a-very-long-unbroken-value-such-as-a-pasted-link-or-a-mailbox-name-00000000';

const TEXT_KEY =
  /(name|title|subject|summary|description|body|reason|note|label|location|floor)(en|ar)?$/i;

/** A long value in the language of the field, so Arabic fields get Arabic. */
function longValue(key, original) {
  if (/email$/i.test(key)) return `${UNBROKEN}@a-long-company-domain.example`;
  if (/subject$/i.test(key)) return `${UNBROKEN} ${LONG.en}`;
  const arabic = /ar$/i.test(key) || /[؀-ۿ]/.test(original);
  return arabic ? LONG.ar : LONG.en;
}

function withLongText(node, key = '') {
  if (Array.isArray(node)) return node.map((item) => withLongText(item, key));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, withLongText(v, k)]));
  }
  if (typeof node === 'string' && node && (TEXT_KEY.test(key) || /email$/i.test(key))) {
    // Leave identifiers, colours, dates and URLs alone.
    if (/^(#|https?:|\/|\d{4}-\d\d)/.test(node) || /(id|code|url|key)$/i.test(key)) return node;
    return longValue(key, node);
  }
  return node;
}

function withoutData(node) {
  if (Array.isArray(node)) return [];
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, withoutData(v)]));
  }
  if (typeof node === 'number') return 0;
  return node;
}

/** Answers that must stay true for the shell to know who is using it. */
const KEEP = [/\/api\/auth\//, /\/api\/health/];

const SCENARIOS = [
  {
    name: 'long names and text at 200%',
    largeText: true,
    install: (page) =>
      page.route('**/api/**', async (route) => {
        const { url, method } = {
          url: route.request().url(),
          method: route.request().method(),
        };
        if (method !== 'GET' || KEEP.some((p) => p.test(url))) return route.continue();
        const response = await route.fetch();
        const type = response.headers()['content-type'] ?? '';
        if (!type.includes('json')) return route.fulfill({ response });
        return route.fulfill({ response, json: withLongText(await response.json()) });
      }),
  },
  {
    name: 'no data at all',
    largeText: false,
    install: (page) =>
      page.route('**/api/**', async (route) => {
        const url = route.request().url();
        if (
          route.request().method() !== 'GET' ||
          KEEP.some((p) => p.test(url)) ||
          /\/api\/me\b/.test(url)
        ) {
          return route.continue();
        }
        const response = await route.fetch();
        const type = response.headers()['content-type'] ?? '';
        if (!type.includes('json')) return route.fulfill({ response });
        return route.fulfill({ response, json: withoutData(await response.json()) });
      }),
  },
  {
    name: 'no signal',
    largeText: false,
    failing: true,
    install: (page) =>
      page.route('**/api/**', (route) => {
        const url = route.request().url();
        if (KEEP.some((p) => p.test(url)) || /\/api\/me\b/.test(url)) return route.continue();
        return route.abort('connectionfailed');
      }),
  },
  {
    name: 'server errors',
    largeText: false,
    failing: true,
    install: (page) =>
      page.route('**/api/**', (route) => {
        const url = route.request().url();
        if (KEEP.some((p) => p.test(url)) || /\/api\/me\b/.test(url)) return route.continue();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          json: { error: { code: 'internal_error', message: 'Something went wrong.' } },
        });
      }),
  },
];

/* ------------------------------------------------------------- the checks */

/** Waits until the page is no longer drawing, whatever it ended up showing. */
async function settled(page) {
  await expect(page.locator('#page [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('#page .skeleton')).toHaveCount(0);
  await expect(page.locator('#page')).toBeVisible();
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null)))
  );
}

/**
 * Elements that hang outside the screen, other than in a region made to
 * scroll sideways, or off-screen on purpose (skip link, visually hidden text).
 */
function overhanging(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const found = [];

    const scrolls = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const { overflowX } = getComputedStyle(node);
        if (
          ['auto', 'scroll', 'hidden', 'clip'].includes(overflowX) &&
          node !== document.body
        ) {
          return true;
        }
      }
      return false;
    };

    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.u-visually-hidden, .u-skip-link, [hidden], dialog:not([open]), svg'))
        continue;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.left >= -1 && rect.right <= width + 1) continue;
      if (scrolls(el)) continue;
      const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
        typeof el.className === 'string' && el.className
          ? `.${el.className.trim().split(/\s+/)[0]}`
          : ''
      }`;
      const parent = el.parentElement;
      const within = parent
        ? `${parent.tagName.toLowerCase()}.${String(parent.className).trim().split(/s+/)[0]}`
        : '';
      found.push(
        `${name} in ${within} [${Math.round(rect.left)}..${Math.round(rect.right)} of ${width}]`
      );
      if (found.length >= 5) break;
    }
    return found;
  });
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    for (const scenario of SCENARIOS) {
      test(`every page holds up: ${scenario.name}`, async ({ page }) => {
        test.setTimeout(360_000);
        await signIn(page, { company: 'HLD', role: 'HoldingAdmin', lang });
        await expectLanguage(page, lang);

        if (scenario.largeText) {
          // Through the CSS object model: the policy allows no inline <style>.
          await page.evaluate(() =>
            document.documentElement.style.setProperty('font-size', '200%', 'important')
          );
        }
        await scenario.install(page);

        const problems = [];
        for (const hash of ROUTES) {
          // A hash change inside the app, as a person would make it: a full
          // load would put the large-text rule and the bent answers out of play.
          await page.evaluate((h) => {
            location.hash = h;
          }, hash);
          await settled(page);
          // The router draws a page asynchronously after the hash changes.
          await page.waitForTimeout(150);
          await settled(page);

          const drew = await page.locator('#page h1, #page .notice, #page .empty').count();
          if (drew === 0)
            problems.push(`${hash}: drew nothing (no heading, notice or empty state)`);

          if (scenario.failing) {
            // A failed read says so, in the page or in a toast, and offers a way
            // on. A page that retries once first takes a moment to give up.
            const said = page.locator(
              '#page .notice, #page [data-retry], #page .empty, #page .field__error, .toast'
            );
            try {
              await expect(said.first()).toBeVisible({ timeout: 10_000 });
            } catch {
              problems.push(`${hash}: failed requests were not said anywhere`);
            }
          }

          const sideways = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth
          );
          if (sideways > 0)
            problems.push(`${hash}: the page scrolls sideways by ${sideways}px`);

          const hanging = await overhanging(page);
          if (hanging.length)
            problems.push(`${hash}: hangs outside the screen: ${hanging.join('; ')}`);
        }

        expect(problems, 'pages that did not hold up').toEqual([]);
        await expectNoSidewaysScroll(page);
      });
    }
  });
}
