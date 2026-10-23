/**
 * a11y.spec.js — axe-core over every page of the IT Helpdesk, in English and
 * Arabic, on both screens: no serious or critical finding (WCAG 2.2 AA), and
 * nothing wider than the screen. The checks are the portal's
 * (packages/shared/e2e/a11y.js).
 */

import AxeBuilder from '@axe-core/playwright';

import { STANDARDS, describe, isSerious, settled } from '@mg/shared/e2e/a11y.js';
import {
  LANGUAGES,
  csrfHeaders,
  expect,
  expectLanguage,
  expectNoSidewaysScroll,
  signIn,
  test,
} from './helpers.js';

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

/** Who sees which pages: everyone, the IT lead, the administrator. */
const VISITS = [
  {
    who: { company: 'GEN', role: 'User' },
    routes: ['#tickets', '#tickets/new', '#notifications'],
  },
  {
    who: { company: 'HLD', name: 'Omar Fahmy' },
    routes: ['#queue', '#assigned', '#reports', '#settings', '#tickets'],
  },
  {
    who: { company: 'HLD', role: 'HoldingAdmin' },
    routes: ['#admin/companies', '#admin/it-team'],
  },
];

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    for (const { who, routes } of VISITS) {
      test(`axe finds nothing serious for ${who.name ?? `${who.company} ${who.role}`}`, async ({
        page,
      }) => {
        test.setTimeout(180_000);
        await signIn(page, { ...who, lang });
        await expectLanguage(page, lang);
        const failures = [];
        for (const hash of routes) {
          await page.goto(`/${hash}`);
          await settled(page);
          const { violations } = await new AxeBuilder({ page }).withTags(STANDARDS).analyze();
          failures.push(...violations.filter(isSerious).map((v) => `${hash}: ${describe(v)}`));
          await expectNoSidewaysScroll(page);
        }
        expect(failures, 'serious or critical accessibility findings').toEqual([]);
      });
    }

    test('a ticket is raised and answered with the keyboard alone', async ({ page }) => {
      await signIn(page, { company: 'GEN', role: 'User', name: 'Salma Ibrahim', lang });
      const subject = `Keyboard ticket ${lang} ${page.viewportSize().width} ${Date.now()}`;

      await page.goto('/#tickets/new');
      await expect(page.locator('#tkNew')).toBeVisible();

      await tabTo(page, '.tk-tile__input');
      await page.keyboard.press('Space');
      await expect(page.locator('.tk-tile__input:checked')).toHaveCount(1);

      await tabTo(page, '#tkSubject');
      await page.keyboard.type(subject);
      await tabTo(page, '#tkDescription');
      await page.keyboard.type('Typed without a mouse.');
      // No urgency question since D142: the category sets the priority.

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

    test('axe finds nothing serious on the ticket handling panel', async ({ page }) => {
      await signIn(page, { company: 'HLD', name: 'Omar Fahmy', lang });
      const options = await (await page.request.get('/api/tickets/options')).json();
      const created = await page.request.post('/api/tickets', {
        headers: await csrfHeaders(page),
        data: {
          subject: `Overlay ticket ${lang} ${page.viewportSize().width} ${Date.now()}`,
          description: 'Opened to look at the handling panel.',
          categoryId: options.categories[0].id,
        },
      });
      expect(created.ok(), 'a ticket to handle').toBeTruthy();
      const { ticket } = await created.json();
      await page.goto(`/#tickets/${ticket.id}`);
      await expect(page.locator('#tkHandle')).toBeVisible();
      await settled(page);
      const { violations } = await new AxeBuilder({ page }).withTags(STANDARDS).analyze();
      expect(violations.filter(isSerious).map(describe)).toEqual([]);
    });

    test('axe finds nothing serious on the sign-in page', async ({ page }) => {
      await page.goto('/login.html');
      await page.locator(`.login__bar [data-lang="${lang}"]`).click();
      await expectLanguage(page, lang);
      await expect(page.locator('#main')).toHaveAttribute('data-mode', 'mock');
      const { violations } = await new AxeBuilder({ page }).withTags(STANDARDS).analyze();
      expect(violations.filter(isSerious).map(describe)).toEqual([]);
    });
  });
}
