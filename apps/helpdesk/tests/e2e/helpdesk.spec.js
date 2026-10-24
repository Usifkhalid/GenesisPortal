/**
 * helpdesk.spec.js — the IT Helpdesk as its own app (D144), in English and
 * Arabic, at 1440 and 360 px: an employee raises a ticket and finds it under
 * My tickets; the IT lead lands on the queue with the IT pages; the
 * administrator keeps the IT team and the companies; the header links back to
 * the portal.
 */

import {
  LANGUAGES,
  expect,
  expectLanguage,
  expectNoSidewaysScroll,
  signIn,
  signOut,
  t,
  test,
} from './helpers.js';

const EMPLOYEE = { company: 'GEN', role: 'User' };
const LEAD = { company: 'HLD', name: 'Omar Fahmy' };
const ADMIN = { company: 'HLD', role: 'HoldingAdmin' };

/** The links in the bar (desktop) or the bottom nav (phone). */
const navLinks = (page) =>
  page.locator(page.viewportSize().width >= 768 ? '.hd-nav a:visible' : '.bottomnav a:visible');

for (const lang of LANGUAGES) {
  test.describe(`IT Helpdesk (${lang})`, () => {
    test('an employee raises a ticket and follows it under My tickets', async ({ page }) => {
      const subject = `Screen flickers ${lang} ${page.viewportSize().width} ${Date.now()}`;
      await signIn(page, { ...EMPLOYEE, lang });
      await expectLanguage(page, lang);
      await expect(page).toHaveTitle(new RegExp(t(lang, 'hd.name')));

      // My tickets and New ticket, nothing of the IT team's; the bare address
      // opens New ticket for an employee.
      await expect(navLinks(page)).toHaveCount(2);
      await expect(page.locator('.page__heading h1')).toHaveText(t(lang, 'hdApp.nav.new'));
      await expect(page.locator('#portalLink')).toHaveAttribute(
        'href',
        'http://localhost:3100'
      );
      await expectNoSidewaysScroll(page);

      await page.goto('/#tickets/new');
      await expect(page.locator('#tkNew')).toBeVisible();
      await page.locator('.tk-tile').first().click();
      await page.locator('#tkSubject').fill(subject);
      await page
        .locator('#tkDescription')
        .fill('The screen flickers when the laptop is docked.');
      await expectNoSidewaysScroll(page);
      await page.locator('#tkSubmit').click();
      const done = page.locator('#tkDone');
      await expect(done).toBeVisible();
      const number = (
        await done.locator('.labelstrip__value bdi').first().textContent()
      ).trim();
      expect(number).toMatch(/^IT-\d{4}-\d{5}$/);

      await page.goto('/#tickets');
      const mine = page.locator('#tkMine .record', { hasText: subject });
      await expect(mine).toBeVisible();
      await expect(mine).toContainText(t(lang, 'ticket.status.New'));
      await mine.locator('a').click();
      await expect(page.locator('#tkSubject')).toContainText(subject);
      await expectNoSidewaysScroll(page);

      // The IT pages are not theirs.
      await page.goto('/#queue');
      await expect(page.locator('#page')).toContainText(t(lang, 'page.noAccess.title'));
      await signOut(page);
    });

    test('the IT lead starts on the queue and has reports and settings', async ({ page }) => {
      await signIn(page, { ...LEAD, lang });
      await expect(page).toHaveURL(/\/(#queue)?$/);
      await expect(page.locator('#tkView')).toBeVisible();
      await expect(page.locator('.page__heading h1')).toHaveText(t(lang, 'hd.nav.queue'));
      await expectNoSidewaysScroll(page);

      await page.goto('/#reports');
      await expect(page.locator('.page__heading h1, h1').first()).toContainText(
        t(lang, 'hd.nav.reports')
      );
      await page.goto('/#settings');
      await expect(page.locator('#page')).not.toContainText(t(lang, 'page.noAccess.title'));
      await expectNoSidewaysScroll(page);
      await signOut(page);
    });

    test('the administrator keeps the IT team and the companies', async ({ page }) => {
      await signIn(page, { ...ADMIN, lang });
      await page.goto('/#admin/companies');
      await expect(page.locator('.page__heading h1')).toHaveText(t(lang, 'hdApp.nav.admin'));
      const table = page.locator('#adminSection table');
      for (const code of ['GEN', 'HLD', 'MSR']) await expect(table).toContainText(code);
      await expectNoSidewaysScroll(page);

      await page.locator('#adminSection [data-edit]').first().click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog.locator('#cfg-domains')).not.toBeEmpty();
      await dialog.locator('[data-modal-close]').first().click();
      await expect(dialog).toHaveCount(0);

      await page.goto('/#admin/it-team');
      await expect(page.locator('#adminSection')).toContainText(
        t(lang, 'tk.cfg.section.members')
      );
      await signOut(page);
    });
  });
}
