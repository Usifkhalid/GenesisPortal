/**
 * announcements.spec.js — an announcement from writing to reading.
 *
 * A Genesis company admin writes an Arabic and English announcement with a
 * cover image and publishes it. A Genesis user sees it on Home, in the list
 * (unread), opens it, and it is marked read. A Masar user never sees it. A
 * holding-wide announcement by the holding admin reaches both companies.
 *
 * Titles carry a random code, so the four projects can run side by side.
 */

import {
  LANGUAGES,
  expect,
  expectLanguage,
  expectNoSidewaysScroll,
  shot,
  signIn,
  signOut,
  t,
  test,
} from './helpers.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const randomCode = () =>
  Array.from({ length: 6 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

/** A real 1x1 PNG, so the browser can draw it. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Writes and publishes through the editor, as a person would. */
async function writeAndPublish(page, lang, fields) {
  await page.goto('/#announcements/new');
  await expect(page.locator('#annForm')).toBeVisible();
  await expectLanguage(page, lang);

  // The tab shown first follows the interface language: choose each one.
  for (const [code, text] of Object.entries({ en: fields.en, ar: fields.ar })) {
    if (!text) continue;
    const L = code === 'ar' ? 'Ar' : 'En';
    await page.locator(`#annForm [data-lang="${code}"]`).click();
    await page.locator(`#f-title${L}`).fill(text.title);
    await page.locator(`#f-body${L}`).fill(text.body);
  }

  await page.locator('#f-category').selectOption('HSE');

  if (fields.audience !== undefined) {
    await page.locator('#f-audience').selectOption(fields.audience);
  }

  if (fields.cover) {
    await page
      .locator('#f-cover')
      .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('#coverCurrent')).toBeVisible();
    await page.locator('#f-coverAltEn').fill('A site briefing');
    await page.locator('#f-coverAltAr').fill('إحاطة في الموقع');
  }

  await shot(page, `ann-editor-${lang}`);

  // The preview answers in the language of the tab, in its own direction.
  const preview = page.locator('[data-preview] [lang]').first();
  await expect(preview).toHaveAttribute('dir', /^(ltr|rtl)$/);

  await page.locator('input[name="when"][value="now"]').check();
  await page.getByRole('button', { name: t(lang, 'ann.editor.publishNow') }).click();

  await expect(page.locator('.toast--success')).toContainText(t(lang, 'ann.toast.published'));
  await page.waitForURL(/#announcements\/manage$/);
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('a company announcement is written, read and kept inside its company', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const code = randomCode();
      const title = { en: `Safety week ${code}`, ar: `أسبوع السلامة ${code}` };
      const own = title[lang];

      /* ---- a Genesis company admin publishes it */
      await signIn(page, { company: 'GEN', role: 'CompanyAdmin', lang });
      await writeAndPublish(page, lang, {
        en: { title: title.en, body: '# Helmets\n\nWear your **helmet** on site.' },
        ar: { title: title.ar, body: '# الخوذات\n\nارتدِ **الخوذة** في الموقع.' },
        cover: true,
      });

      // The admin list shows it, published, with its read stats.
      const row = page.locator('tbody tr', { hasText: own });
      await expect(row).toBeVisible();
      await expect(row).toContainText(t(lang, 'ann.admin.status.Published'));
      await expect(row).toContainText(/\d+\s/);
      await shot(page, `ann-manage-${lang}`);
      await expectNoSidewaysScroll(page);
      await signOut(page);

      /* ---- a Genesis user finds it on Home and in the list */
      await signIn(page, { company: 'GEN', role: 'User', lang });
      await expect(page.locator('#page [aria-busy="true"]')).toHaveCount(0);
      const news = page.locator('[data-card="news"]');
      // Home's card is the three newest for this person (other tests publish
      // at the same moment, so it is not always this one): it is wired to the
      // API, unread ones are marked, and each row opens its own announcement.
      const newest = await (await page.request.get('/api/announcements?pageSize=3')).json();
      await expect(news.locator('.record')).toHaveCount(Math.min(3, newest.total));
      await expect(news.locator('.record a[href^="#announcements/"]').first()).toBeVisible();
      await expect(news.locator('.tag--highlight').first()).toBeVisible();
      // Drawn in the rail on a desktop, in the More sheet on a phone.
      await expect(page.locator('[data-announcement-count]').first()).toHaveAttribute(
        'aria-label',
        /[0-9]/
      );

      await page.goto('/#announcements');
      const card = page.locator('.ann-card', { hasText: own });
      await expect(card).toBeVisible();
      await expect(card.locator('.tag--highlight')).toHaveText(t(lang, 'ann.card.unread'));
      await expect(card.locator('img')).toHaveAttribute('alt', /.+/);
      await shot(page, `ann-list-${lang}`);
      await expectNoSidewaysScroll(page);

      /* ---- opening it marks it read */
      await card.locator('.ann-card__link').click();
      await page.waitForURL(/#announcements\/[0-9a-f-]{36}$/);
      await expect(page.locator('.ann-detail__title')).toHaveText(own);
      await expect(page.locator('.ann-detail__body strong')).toBeVisible();
      await expect(page.locator('.ann-detail__body')).toHaveAttribute('lang', lang);
      await expect(page.locator('.ann-detail__cover img')).toBeVisible();
      await shot(page, `ann-detail-${lang}`);
      await expectNoSidewaysScroll(page);

      await page.goto('/#announcements');
      const same = page.locator('.ann-card', { hasText: own });
      await expect(same).toBeVisible();
      await expect(same.locator('.tag--highlight')).toHaveCount(0);
      await page.goto('/#home');
      await expect(page.locator('[data-card="news"] .record').first()).toBeVisible();
      await expect(
        page.locator('[data-card="news"] .record', { hasText: own }).locator('.tag--highlight')
      ).toHaveCount(0);
      await signOut(page);

      /* ---- a Masar user never sees it */
      // Masar's plain users are borrowed by the admin spec; its company admin is not.
      await signIn(page, { company: 'MSR', role: 'CompanyAdmin', lang });
      await page.goto('/#announcements');
      await expect(page.locator('#annBody[aria-busy="false"]')).toBeVisible();
      await expect(page.locator('.ann-card', { hasText: code })).toHaveCount(0);
      await page.goto('/#home');
      await expect(
        page.locator(
          '[data-card="news"] [aria-busy="true"], [data-card="news"][aria-busy="true"]'
        )
      ).toHaveCount(0);
      await expect(page.locator('[data-card="news"]')).not.toContainText(code);
    });

    test('a holding-wide announcement reaches every company', async ({ page }) => {
      test.setTimeout(120_000);
      const code = randomCode();
      const title = `Group notice ${code}`;

      await signIn(page, { company: 'HLD', role: 'HoldingAdmin', lang });
      await writeAndPublish(page, lang, {
        en: { title, body: 'All of MG Holding is closed on the national holiday.' },
        audience: '',
      });
      await expect(
        page.locator('tbody tr', { hasText: title }).locator('td').nth(1)
      ).toContainText(t(lang, 'ann.card.allGroup'));
      await signOut(page);

      for (const [company, role] of [
        ['GEN', 'User'],
        ['MSR', 'CompanyAdmin'],
      ]) {
        await signIn(page, { company, role, lang });
        await page.goto('/#announcements');
        const card = page.locator('.ann-card', { hasText: title });
        await expect(card).toBeVisible();
        await expect(card.locator('.labelstrip')).toContainText(t(lang, 'ann.card.allGroup'));

        // Written in English only: an Arabic reader gets it, and is told so.
        await card.locator('.ann-card__link').click();
        await expect(page.locator('.ann-detail__title')).toHaveText(title);
        if (lang === 'ar') {
          await expect(page.locator('.ann-note')).toBeVisible();
          await expect(page.locator('.ann-detail__body')).toHaveAttribute('dir', 'ltr');
        } else {
          await expect(page.locator('.ann-note')).toHaveCount(0);
        }
        await signOut(page);
      }
    });
  });
}
