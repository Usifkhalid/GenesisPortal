/**
 * entry-links.spec.js — the two links published to staff, /new and /queue, and
 * the bare address. Signed out, a link goes through the sign-in page and comes
 * back to itself; the IT team's link, opened by someone who is not on the IT
 * team, shows the New ticket form with no error page.
 */

import {
  LANGUAGES,
  expect as strictExpect,
  expectLanguage,
  expectNoSidewaysScroll,
  findUser,
  signOut,
  t,
  test,
} from './helpers.js';

const expect = strictExpect.configure({ timeout: 20_000 });

const REQUESTER = { company: 'GEN', role: 'User', name: 'Salma Ibrahim' };
const AGENT = { company: 'HLD', name: 'Sherif Awad' };

/** The link to `nav` in the nav this screen shows: the top one, or the bottom bar on a phone. */
const navLink = (page, nav) => page.locator(`[data-nav="${nav}"]:visible`);

/** The New ticket form is showing, and My tickets is the link beside it. */
async function expectNewTicket(page, lang) {
  await expect(page.locator('#tkNew')).toBeVisible();
  await expect(page.locator('#page h1')).toHaveText(t(lang, 'hdApp.nav.new'));
  await expect(page.locator('#page')).not.toContainText(t(lang, 'page.noAccess.title'));
  await expect(navLink(page, 'new')).toHaveAttribute('aria-current', 'page');
  await expect(navLink(page, 'mine')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#tickets/new');
}

async function expectQueue(page, lang) {
  await expect(page.locator('#page h1')).toHaveText(t(lang, 'hd.nav.queue'));
  await expect(page.locator('#page')).not.toContainText(t(lang, 'page.noAccess.title'));
  await expect(navLink(page, 'queue')).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).hash).toBe('#queue');
}

/**
 * Opens `link` signed out, which the app answers with the sign-in page, then
 * signs in there as `who` and waits to be sent back.
 */
async function openSignedOut(page, link, who, lang) {
  await page.goto(link);
  await page.waitForURL((url) => url.pathname === '/login.html');
  // The address names the link to come back to.
  expect(new URL(page.url()).searchParams.get('next')).toBe(link);
  await page.locator(`.login__bar [data-lang="${lang}"]`).click();
  await expectLanguage(page, lang);
  await expect(page.locator('#main')).toHaveAttribute('data-mode', 'mock');

  const person = await findUser(page, who);
  await page.locator(`[data-user-id="${person.id}"]`).click();
  await page.waitForURL((url) => url.pathname !== '/login.html');
  await expect(page.locator('#menuUserName')).not.toBeEmpty();
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('/new: signed out, sign in, and the New ticket form opens', async ({ page }) => {
      await openSignedOut(page, '/new', REQUESTER, lang);
      await expectNewTicket(page, lang);
      await expectNoSidewaysScroll(page);

      // My tickets sits beside it and works.
      await navLink(page, 'mine').click();
      await expect(page.locator('#tkMine')).toBeVisible();
      await expect(page.locator('#tkMineBody')).toHaveAttribute('aria-busy', 'false');
    });

    test('/queue: signed out, the IT team signs in and the Queue opens', async ({ page }) => {
      await openSignedOut(page, '/queue', AGENT, lang);
      await expectQueue(page, lang);
    });

    test('/queue is for the IT team: anyone else is sent to New ticket, with no error page', async ({
      page,
    }) => {
      await openSignedOut(page, '/queue', REQUESTER, lang);
      await expectNewTicket(page, lang);
      // Signed in already, the same link does the same.
      await page.goto('/queue');
      await expectNewTicket(page, lang);
      await expect(navLink(page, 'queue')).toHaveCount(0);
    });

    test('/new for the IT team opens the New ticket form too', async ({ page }) => {
      await openSignedOut(page, '/new', AGENT, lang);
      await expectNewTicket(page, lang);
    });

    test('the bare address: employees land on New ticket, the IT team on the Queue', async ({
      page,
    }) => {
      await openSignedOut(page, '/new', REQUESTER, lang);
      await page.goto('/');
      await expectNewTicket(page, lang);
      await signOut(page);

      await openSignedOut(page, '/new', AGENT, lang);
      await page.goto('/');
      await expectQueue(page, lang);
    });

    test('a link to a ticket is not rewritten, and an address with a #page is left alone', async ({
      page,
    }) => {
      await openSignedOut(page, '/new', REQUESTER, lang);
      await page.goto('/#tickets');
      await expect(page.locator('#tkMine')).toBeVisible();
      expect(new URL(page.url()).hash).toBe('#tickets');
    });

    test('a link to another site is not followed after sign-in', async ({ page }) => {
      await page.goto('/login.html?next=' + encodeURIComponent('//evil.example/new'));
      await page.locator(`.login__bar [data-lang="${lang}"]`).click();
      await expect(page.locator('#main')).toHaveAttribute('data-mode', 'mock');
      const person = await findUser(page, REQUESTER);
      await page.locator(`[data-user-id="${person.id}"]`).click();
      await expect(page.locator('#menuUserName')).not.toBeEmpty();
      expect(new URL(page.url()).origin).toBe(new URL(page.context()._options.baseURL).origin);
      await expectNewTicket(page, lang);
    });
  });
}
