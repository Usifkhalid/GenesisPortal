/**
 * navigation.spec.js — moving around the helpdesk without a reload.
 *
 * After sign-in the shell is still drawing its first page when a person opens
 * an address of their own; the page that arrives late must not overwrite the
 * one they asked for (router.js gives every render its own container). Each
 * test moves between addresses by changing the hash, as a click on a link
 * does, and never reloads.
 */

import { LANGUAGES, expect as strictExpect, signIn, test } from './helpers.js';

const expect = strictExpect.configure({ timeout: 20_000 });

/** Changes the address the way a link does: a hash change, no reload. */
async function go(page, hash) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
}

/** My tickets has finished loading: a list or its empty message, no skeleton. */
async function expectMineLoaded(page) {
  await expect(page.locator('#tkMine')).toBeVisible();
  await expect(page.locator('#tkMineBody')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#tkMineBody .skeleton')).toHaveCount(0);
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    const WHO = {
      requester: { company: 'GEN', role: 'User', name: 'Salma Ibrahim' },
      'IT agent': { company: 'HLD', name: 'Sherif Awad' },
    };

    for (const [kind, person] of Object.entries(WHO)) {
      test(`${kind}: My tickets loads right after sign-in and every time they come back`, async ({
        page,
      }) => {
        await signIn(page, { ...person, lang });

        // Straight after sign-in: no wait for the shell to settle, no reload.
        await go(page, '#tickets');
        await expectMineLoaded(page);

        for (let round = 0; round < 6; round += 1) {
          await go(page, '#tickets/new');
          await expect(page.locator('#tkNew')).toBeVisible();
          await go(page, '#tickets');
          await expectMineLoaded(page);
        }

        // Back-to-back changes with nothing awaited between them: only the last counts.
        await page.evaluate(() => {
          for (const hash of ['#tickets/new', '#tickets', '#tickets/new', '#tickets']) {
            location.hash = hash;
          }
        });
        await expectMineLoaded(page);
      });
    }
  });
}
