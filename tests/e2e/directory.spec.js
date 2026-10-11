/**
 * directory.spec.js — finding a colleague, and keeping the directory right.
 *
 * A Genesis user types a colleague's name into the top bar (in English and in
 * Arabic, with a letter variant), opens the person, and finds the Teams link.
 * The holding admin runs the user sync and reads the data-quality report with
 * the deliberate gaps in the mock Graph data.
 *
 * Run twice in parallel on one database (desktop and phone projects), so the
 * sync test waits for a run already in progress instead of assuming it is the
 * only one.
 */

import {
  LANGUAGES,
  expect,
  expectLanguage,
  expectNoSidewaysScroll,
  shot,
  signIn,
  t,
  test,
} from './helpers.js';

const SALMA = {
  en: { typed: 'Salma Ibrahim', name: 'Salma Ibrahim' },
  // سلمي with a final yeh finds سلمى with an alef maqsura.
  ar: { typed: 'سلمي', name: 'سلمى إبراهيم' },
};
const SALMA_EMAIL = 'salma.ibrahim@genesismining-eg.com';

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('a user finds a colleague from the top bar and opens their Teams chat', async ({
      page,
    }) => {
      await signIn(page, { company: 'GEN', role: 'User', lang });
      await expectLanguage(page, lang);

      // Typeahead: the first matches under the field.
      const search = page.locator('#globalSearch');
      await search.fill(SALMA[lang].typed);
      const option = page.locator('#searchResults [role="option"]').first();
      await expect(option).toContainText(SALMA[lang].name);
      await expect(search).toHaveAttribute('aria-expanded', 'true');

      // Enter with nothing highlighted opens the Directory with the query.
      await search.press('Enter');
      await expect(page).toHaveURL(/#directory\?q=/);
      await expect(page.locator('h1')).toHaveText(t(lang, 'directory.title'));
      const card = page.locator('.dir-card', { hasText: SALMA[lang].name });
      await expect(card).toBeVisible();
      await shot(page, `directory-${lang}`);
      await expectNoSidewaysScroll(page);

      // The person opens in a panel with the contact actions.
      await card.locator('.dir-card__link').click();
      const panel = page.locator('dialog.dir-drawer[open]');
      await expect(panel).toBeVisible();
      await expect(panel.locator('.dialog__title')).toHaveText(SALMA[lang].name);

      const teams = panel.getByRole('link', { name: t(lang, 'directory.panel.teamsNew') });
      await expect(teams).toHaveAttribute(
        'href',
        `https://teams.microsoft.com/l/chat/0/0?users=${SALMA_EMAIL}`
      );
      await expect(panel.locator(`a[href="mailto:${SALMA_EMAIL}"]`)).toBeVisible();
      await expect(panel.locator('a[href^="tel:"]')).toHaveCount(1);

      // The manager is a person to open in turn.
      await panel.locator('.dir-people [data-person]').first().click();
      await expect(panel.locator('.dialog__title')).not.toHaveText(SALMA[lang].name);
      await shot(page, `directory-panel-${lang}`);

      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
    });

    test('a typeahead result opens the person directly', async ({ page }) => {
      await signIn(page, { company: 'GEN', role: 'User', lang });
      const search = page.locator('#globalSearch');
      await search.fill(SALMA[lang].typed);
      const option = page.locator('#searchResults [role="option"]').first();
      await expect(option).toContainText(SALMA[lang].name);

      await search.press('ArrowDown');
      await search.press('Enter');
      await expect(page.locator('dialog.dir-drawer[open] .dialog__title')).toHaveText(
        SALMA[lang].name
      );
    });

    test('the holding admin runs the sync and sees the data-quality gaps', async ({ page }) => {
      await signIn(page, { company: 'HLD', role: 'HoldingAdmin', lang });
      await page.goto('/#admin/sync');
      await expectLanguage(page, lang);

      const run = page.locator('#syncRun');
      await expect(run).toBeVisible();
      if (await run.isEnabled()) await run.click();

      // Another worker's run may be the one that finishes; either is a success.
      const latest = page.locator('.sync-run__line .badge').first();
      await expect(latest).toHaveText(t(lang, 'admin.sync.status.success'), {
        timeout: 60_000,
      });
      await expect(run).toBeEnabled();
      await shot(page, `admin-sync-${lang}`);
      await expectNoSidewaysScroll(page);

      // The warnings name the department and the person no company could take.
      await expect(page.locator('.sync-warnings')).toContainText('Skunkworks');
      await expect(page.locator('.sync-warnings')).toContainText(
        'chris.walker@contractor-partners.example'
      );

      await page.goto('/#admin/quality');
      const gen = page.locator('.dq-company', {
        has: page.locator('.admin-code', { hasText: /^GEN$/ }),
      });
      await expect(gen).toBeVisible();

      const noDepartment = gen
        .locator('.dq-issue', { hasText: t(lang, 'admin.quality.issue.missingDepartment') })
        .first();
      await noDepartment.locator('summary').click();
      await expect(noDepartment).toContainText('Wael Ghoneim');

      const msr = page.locator('.dq-company', { hasText: 'Skunkworks' });
      await expect(msr).toBeVisible();
      await expect(page.locator('#dqUnplaced')).toBeVisible();
      await expect(page.locator('#dqBody')).toContainText('contractor-partners.example');
      await expect(page.locator('#dqExport')).toHaveAttribute(
        'href',
        /\/api\/admin\/directory\/quality\/export\.csv/
      );
      await shot(page, `admin-quality-${lang}`);
      await expectNoSidewaysScroll(page);
    });
  });
}
