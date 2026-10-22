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
  expect,
  expectLanguage,
  expectNoSidewaysScroll,
  signIn,
  test,
} from './helpers.js';

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
