/**
 * page-weight.spec.js — what each screen costs a phone on a weak connection.
 *
 * Counts bytes on the wire (compressed, headers included, as the browser's own
 * network panel reports them) with a cold cache:
 *
 *   - first load of the sign-in page and of the portal's shell with Home;
 *   - what each further page adds when it is opened from inside the portal
 *     (its module, its strings, its API answers).
 *
 * The numbers are printed as a table and written to test-results/page-weight.json.
 * The two first loads are held to a budget (CLAUDE.md rule 6 and the brief: under
 * 300 kB compressed); a page's own cost is held to a looser one so a regression
 * is caught before it reaches a site phone.
 *
 * Runs once per language on the phone project: weight does not depend on the
 * viewport, and the Arabic fonts make that language the heavier one.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import { LANGUAGES, expect, expectLanguage, test } from './helpers.js';

const FIRST_LOAD_BUDGET = 300_000;
const PAGE_BUDGET = 120_000;

const ROUTES = [
  '#announcements',
  '#announcements/manage',
  '#rooms',
  '#rooms/day',
  '#rooms/mine',
  '#tickets',
  '#tickets/new',
  '#tickets/queue',
  '#directory',
  '#admin/companies',
  '#admin/rooms',
  '#admin/helpdesk',
  '#audit-log',
  '#notifications',
];

/** Starts counting transferred bytes; `stop()` returns them by kind. */
async function meter(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  const requests = new Map();
  let total = 0;
  let count = 0;
  const kinds = {};
  let files = [];

  client.on('Network.requestWillBeSent', ({ requestId, request, type }) => {
    requests.set(requestId, { url: request.url, type });
  });
  client.on('Network.responseReceived', ({ requestId, type }) => {
    const known = requests.get(requestId);
    if (known) known.type = type;
  });
  client.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const known = requests.get(requestId);
    if (!known || known.url.startsWith('data:') || known.url.startsWith('blob:')) return;
    total += encodedDataLength;
    count += 1;
    files.push([new URL(known.url).pathname, encodedDataLength]);
    kinds[known.type] = (kinds[known.type] ?? 0) + encodedDataLength;
  });

  return {
    reset() {
      total = 0;
      count = 0;
      for (const key of Object.keys(kinds)) delete kinds[key];
      files = [];
    },
    read: () => ({
      bytes: total,
      requests: count,
      kinds: { ...kinds },
      largest: [...files].sort((a, b) => b[1] - a[1]).slice(0, 12),
    }),
  };
}

const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

async function settled(page) {
  await expect(page.locator('#page [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('#page .skeleton')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

for (const lang of LANGUAGES) {
  test(`page weight in ${lang}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-360', 'weight does not depend on the viewport');
    test.setTimeout(240_000);

    const report = { lang, firstLoad: {}, pages: {} };

    /* ----------------------------------------- the sign-in page, cold cache */
    await page.goto('about:blank');
    let counter = await meter(page);
    // The language is the device's, as it would be on a first visit.
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('mgp.locale', value);
      } catch {
        // Blocked storage: the page falls back to the browser's language.
      }
    }, lang);
    await page.goto('/login.html');
    await expect(page.locator('#main')).toHaveAttribute('data-mode', 'mock');
    await expect(page.locator('[data-user-id]').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    report.firstLoad.login = counter.read();

    /* ------------------------------ the shell and Home, signed in, no cache */
    const person = await page.request
      .get('/api/auth/mock-users')
      .then((r) => r.json())
      .then(({ companies }) => companies.find((c) => c.code === 'HLD'))
      .then((c) => c.users.find((u) => u.role === 'HoldingAdmin' && u.displayNameAr));
    await page.locator(`[data-user-id="${person.id}"]`).click();
    await page.waitForURL((url) => url.pathname === '/');

    // A cold cache again: the browser's own, cleared through the protocol.
    const client = await page.context().newCDPSession(page);
    await client.send('Network.clearBrowserCache');
    counter = await meter(page);
    counter.reset();
    await page.reload();
    await expect(page.locator('#menuUserName')).not.toBeEmpty();
    await expectLanguage(page, lang);
    await settled(page);
    report.firstLoad.shellAndHome = counter.read();

    /* ------------------------------------------ each page, from inside it */
    for (const hash of ROUTES) {
      counter.reset();
      await page.evaluate((h) => {
        location.hash = h;
      }, hash);
      await expect(page.locator('#page h1').first()).toBeVisible();
      await settled(page);
      report.pages[hash] = counter.read();
    }

    /* ---------------------------------------------------------- the report */
    const rows = [
      ['sign-in page (first load)', report.firstLoad.login],
      ['shell + Home (first load)', report.firstLoad.shellAndHome],
      ...Object.entries(report.pages).map(([hash, value]) => [`${hash} (added)`, value]),
    ];
    console.log(
      `\npage weight, ${lang}, compressed on the wire\n` +
        rows
          .map(
            ([name, v]) =>
              `  ${name.padEnd(34)} ${kB(v.bytes).padStart(10)}  ${String(v.requests).padStart(3)} requests`
          )
          .join('\n')
    );
    for (const [name, v] of rows.slice(0, 2)) {
      console.log(
        `  ${name}: ${v.largest.map(([p, n]) => `${p.split('/').pop()} ${kB(n)}`).join(', ')}`
      );
    }
    mkdirSync('test-results', { recursive: true });
    writeFileSync(`test-results/page-weight-${lang}.json`, JSON.stringify(report, null, 2));

    expect(report.firstLoad.login.bytes, 'sign-in page, first load').toBeLessThan(
      FIRST_LOAD_BUDGET
    );
    expect(report.firstLoad.shellAndHome.bytes, 'shell and Home, first load').toBeLessThan(
      FIRST_LOAD_BUDGET
    );
    for (const [hash, value] of Object.entries(report.pages)) {
      expect(value.bytes, `${hash} adds`).toBeLessThan(PAGE_BUDGET);
    }
  });
}
