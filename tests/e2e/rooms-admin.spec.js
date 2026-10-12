/**
 * rooms-admin.spec.js — administering rooms and bookings.
 *
 * The holding admin adds a room from an Exchange mailbox the portal does not
 * use yet, changes it and takes it out of use, and finds each step in the
 * audit log under words a person can read. Then a Genesis user's booking is
 * cancelled by the holding admin, who has to say why; the reason shows on the
 * cancelled booking and in the audit log.
 *
 * Four runs share one database (two languages, two screens): each adds a room
 * from a mailbox of its own and books on a day of its own.
 */

import {
  LANGUAGES,
  bookableDay,
  cairoInstant,
  csrfHeaders,
  expect as strictExpect,
  expectLanguage,
  expectNoSidewaysScroll,
  runIndex,
  shot,
  signIn,
  signOut,
  t,
  test,
} from './helpers.js';

// Every wait here is on the server, which the whole suite shares.
const expect = strictExpect.configure({ timeout: 20_000 });

const SPARE = ['a', 'b', 'c', 'd'];

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('the holding admin adds a room, changes it and takes it out of use', async ({
      page,
    }) => {
      await signIn(page, { company: 'HLD', role: 'HoldingAdmin', lang });
      await expectLanguage(page, lang);
      const letter = SPARE[runIndex(page, lang)];
      const mailbox = `room-site-${letter}@mgholding.example`;
      const nameEn = `Site Meeting Room ${letter.toUpperCase()}`;
      const nameAr = `قاعة الموقع ${letter.toUpperCase()}`;

      await page.goto('/#admin/rooms');
      const table = page.locator('#adminSection table');
      await expect(table).toContainText('room-hq-5@mgholding.example');
      await shot(page, `admin-rooms-${lang}`);
      await expectNoSidewaysScroll(page);

      // Add: the mailbox fills in what Exchange already knows.
      await page.locator('a[href="#admin/rooms/new"]').click();
      const form = page.locator('#roomForm');
      await form.locator('#roomSave').click();
      await expect(form.locator('#r-mailbox-error')).toHaveText(
        t(lang, 'admin.rooms.mailboxRequired')
      );
      await form.locator('#r-mailbox').selectOption(mailbox);
      await expect(form.locator('#r-nameEn')).toHaveValue(nameEn);
      await expect(form.locator('#r-capacity')).not.toHaveValue('');
      await form.locator('#r-nameAr').fill(nameAr);
      await form.locator('input[name="equipment"][value="screen"]').check();
      await shot(page, `admin-room-form-${lang}`);
      await expectNoSidewaysScroll(page);
      await form.locator('#roomSave').click();

      const row = table.locator('tr', { hasText: mailbox });
      await expect(row).toContainText(nameAr);
      await expect(row).toContainText(t(lang, 'admin.status.active'));

      // Change it and take it out of use.
      await row.locator('a').click();
      await expect(form.locator('#r-nameAr')).toHaveValue(nameAr);
      await form.locator('#r-floor').fill('2');
      await form.locator('input[name="isActive"]').uncheck();
      await form.locator('#roomSave').click();
      await expect(row).toContainText(t(lang, 'admin.status.inactive'));

      // Both steps are in the audit log, in words.
      await page.goto('/#audit-log?entity=Room');
      const log = page.locator('#page');
      await expect(log).toContainText(t(lang, 'audit.action.room.create'));
      await expect(log).toContainText(t(lang, 'audit.action.room.update'));
      await expectNoSidewaysScroll(page);
    });

    test('an admin cancels someone’s booking, with a reason, and it is audited', async ({
      page,
    }) => {
      const day = bookableDay(page, lang, 4);
      const subject = `Admin cancel ${lang} ${runIndex(page, lang)}`;
      const reason = `Room closed ${lang} ${runIndex(page, lang)}`;

      // A Genesis user books Meeting Room 1.
      await signIn(page, { company: 'GEN', role: 'User', lang });
      const rooms = (await (await page.request.get('/api/rooms')).json()).items;
      const room = rooms.find((r) => r.nameEn === 'Meeting Room 1');
      const booked = await page.request.post('/api/bookings', {
        headers: await csrfHeaders(page),
        data: {
          roomId: room.id,
          subject,
          start: await cairoInstant(page, day, '09:00'),
          end: await cairoInstant(page, day, '10:00'),
        },
      });
      expect(booked.ok(), 'the user’s booking').toBeTruthy();
      await signOut(page);

      // The holding admin finds it among all bookings.
      await signIn(page, { company: 'HLD', role: 'HoldingAdmin', lang });
      await page.goto(`/#admin/bookings?from=${day}&to=${day}`);
      const row = page.locator('#abBody tr', { hasText: subject });
      await expect(row).toBeVisible();
      await shot(page, `admin-bookings-${lang}`);
      await expectNoSidewaysScroll(page);

      // No reason, no cancelling.
      await row.locator('[data-cancel]').click();
      const dialog = page.locator('dialog[open]');
      await dialog.locator('button[type="submit"]').click();
      await expect(dialog.locator('#abkReason-error')).toHaveText(
        t(lang, 'admin.bookings.reasonRequired')
      );
      await dialog.locator('#abkReason').fill(reason);
      await shot(page, `admin-booking-cancel-${lang}`);
      await dialog.locator('button[type="submit"]').click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.locator('.toast', { hasText: t(lang, 'rooms.mine.cancelled') })
      ).toBeVisible();
      await expect(page.locator('#abBody tr', { hasText: subject })).toHaveCount(0);

      // Under "Cancelled" it carries the reason.
      await page.locator('#abStatus').selectOption('cancelled');
      await expect(page.locator('#abBody tr', { hasText: subject })).toContainText(reason);

      // And the audit log says who did what, in words.
      await page.goto('/#audit-log?entity=Booking');
      await expect(page.locator('#page')).toContainText(
        t(lang, 'audit.action.booking.admin.cancel')
      );
    });
  });
}
