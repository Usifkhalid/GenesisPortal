/**
 * rooms.spec.js — booking a room, end to end.
 *
 * A Genesis user finds a free room for a time, books it in two taps, sees it
 * on Home and under My bookings, and cancels it. Another books from the day
 * view as a weekly series and cancels the series. A room taken in the
 * meantime shows the conflict and offers another room. A room's name opens
 * its panel.
 *
 * Run four times in parallel on one database (two languages, two screens), so
 * each run books on days of its own, and the series test books a room of its
 * own, which keeps any two runs from ever meeting in the same calendar.
 */

import {
  LANGUAGES,
  expect as strictExpect,
  expectLanguage,
  expectNoSidewaysScroll,
  shot,
  signIn,
  t,
  test,
} from './helpers.js';

// Every wait here is on the server, and the directory spec's sync holds the
// database for seconds when the whole suite runs together.
const expect = strictExpect.configure({ timeout: 20_000 });

const ROOM_NAMES = {
  en: ['Meeting Room 2', 'Meeting Room 3', 'Meeting Room 4', 'Boardroom', 'Training Room'],
  ar: [
    'قاعة الاجتماعات 2',
    'قاعة الاجتماعات 3',
    'قاعة الاجتماعات 4',
    'قاعة مجلس الإدارة',
    'قاعة التدريب',
  ],
};

/** 0..3 for this run: language by screen. */
function runIndex(page, lang) {
  const wide = page.viewportSize().width > 600;
  return (lang === 'en' ? 0 : 2) + (wide ? 0 : 1);
}

/**
 * A working day (Sunday to Thursday) at least a week away, different for each
 * of the 4 runs and each of the tests, as "YYYY-MM-DD".
 */
function bookableDay(page, lang, testNo) {
  const days = [];
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 7);
  while (days.length < 24) {
    if (date.getUTCDay() <= 4) days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days[testNo * 4 + runIndex(page, lang)];
}

async function csrfHeaders(page) {
  const config = await (await page.request.get('/api/auth/config')).json();
  return { 'X-CSRF-Token': config.csrfToken };
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('a user books a room in two taps, sees it on Home, and cancels it', async ({
      page,
    }) => {
      await signIn(page, { company: 'GEN', role: 'User', lang });
      await expectLanguage(page, lang);

      const day = bookableDay(page, lang, 0);
      const subject = `Roomtest ${lang} ${runIndex(page, lang)}`;

      // Five people: the smallest room that seats them is Meeting Room 2.
      await page.goto(`/#rooms?date=${day}&start=10:00&duration=60&people=5`);
      await expect(page.locator('h1')).toHaveText(t(lang, 'nav.rooms'));
      const rows = page.locator('#freeBody .record');
      await expect(rows.first()).toContainText(ROOM_NAMES[lang][0]);
      await expect(page.locator('#freeSummary')).toContainText('10:00–11:00');
      await shot(page, `rooms-find-${lang}`);
      await expectNoSidewaysScroll(page);

      // Tap one: Book. The dialog opens with everything filled in.
      await rows.first().locator('[data-book]').click();
      const dialog = page.locator('dialog.booking-dialog[open]');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#bkSummary')).toContainText(ROOM_NAMES[lang][0]);
      await expect(dialog.locator('#bkSubject')).toHaveValue(
        t(lang, 'rooms.book.subjectDefault')
      );
      await dialog.locator('#bkSubject').fill(subject);
      await shot(page, `rooms-book-${lang}`);

      // Tap two: Confirm.
      await dialog.locator('#bkSubmit').click();
      await expect(dialog).toHaveCount(0);
      const done = page.locator('.find__done');
      await expect(done).toContainText(ROOM_NAMES[lang][0]);
      // The room just booked is no longer on the list of free ones.
      await expect(rows.filter({ hasText: ROOM_NAMES[lang][0] })).toHaveCount(0);

      // Home shows it among the next bookings.
      await page.goto('/#home');
      await expect(page.locator('[data-card="rooms"]')).toContainText(subject);

      // My bookings lists it, and cancelling it frees the room.
      await page.goto('/#rooms/mine');
      const mine = page.locator('#mineBody .record', { hasText: subject });
      await expect(mine).toBeVisible();
      await shot(page, `rooms-mine-${lang}`);
      await expectNoSidewaysScroll(page);

      await mine.locator('[data-cancel]').click();
      const ask = page.locator('dialog[open]');
      await expect(ask).toContainText(t(lang, 'rooms.mine.cancelTitle'));
      await ask.locator('[data-confirm]').click();
      await expect(page.locator('#mineBody .record', { hasText: subject })).toHaveCount(0);
      await expect(
        page.locator('.toast', { hasText: t(lang, 'rooms.mine.cancelled') })
      ).toBeVisible();
    });

    test('a user books a weekly series from the day view and cancels the series', async ({
      page,
    }) => {
      await signIn(page, { company: 'GEN', role: 'User', lang });
      const day = bookableDay(page, lang, 1);
      const subject = `Series ${lang} ${runIndex(page, lang)}`;
      // A room of its own for each run, so the series of two runs never meet.
      const roomName = ROOM_NAMES[lang][1 + runIndex(page, lang)];

      await page.goto(`/#rooms/day?date=${day}`);
      await expect(page.locator('#dayTitle')).not.toBeEmpty();
      await expect(page.locator('#dayBody')).toHaveAttribute('aria-busy', 'false');
      await shot(page, `rooms-day-${lang}`);
      await expectNoSidewaysScroll(page);

      // Wide: the timetable is on screen; narrow: the phone list is.
      const wide = page.viewportSize().width > 600;
      await expect(page.locator(wide ? '.day-timeline' : '.day-list')).toBeVisible();
      await expect(page.locator(wide ? '.day-list' : '.day-timeline')).toBeHidden();

      await page.locator(`[data-free]:visible[aria-label*="${roomName}"]`).first().click();

      const dialog = page.locator('dialog.booking-dialog[open]');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#bkSummary')).toContainText(roomName);
      await dialog.locator('#bkSubject').fill(subject);
      await dialog.locator('#bkRepeat').selectOption('weekly');
      await expect(dialog.locator('#bkWeekdays')).toBeVisible();
      await expect(dialog.locator('#bkUntil')).not.toHaveValue('');
      await shot(page, `rooms-series-${lang}`);
      await dialog.locator('#bkSubmit').click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.locator('.toast', { hasText: t(lang, 'rooms.book.doneSeries') })
      ).toBeVisible();

      // The timetable now shows the booking as the person's own.
      if (wide) await expect(page.locator('.day-busy--mine').first()).toBeVisible();
      await shot(page, `rooms-day-booked-${lang}`);

      await page.goto('/#rooms/mine');
      const entry = page.locator('#mineBody .record', { hasText: subject });
      await expect(entry).toBeVisible();
      await expect(entry.locator('.tag')).toHaveText(t(lang, 'rooms.mine.series'));

      await entry.locator('[data-cancel]').click();
      const ask = page.locator('dialog[open]');
      await ask.locator('input[value="series"]').check();
      await ask.locator('[data-confirm]').click();
      await expect(page.locator('#mineBody .record', { hasText: subject })).toHaveCount(0);
    });

    test('a room taken meanwhile shows the conflict and finds another room', async ({
      page,
    }) => {
      await signIn(page, { company: 'GEN', role: 'User', lang });
      const day = bookableDay(page, lang, 2);

      await page.goto(`/#rooms?date=${day}&start=14:00&duration=60&people=5`);
      const rows = page.locator('#freeBody .record');
      await expect(rows.first()).toContainText(ROOM_NAMES[lang][0]);
      const roomId = await rows.first().locator('[data-room]').getAttribute('data-room');

      await rows.first().locator('[data-book]').click();
      const dialog = page.locator('dialog.booking-dialog[open]');
      await expect(dialog).toBeVisible();

      // Someone else books the room while the dialog is open.
      const headers = await csrfHeaders(page);
      const taken = await page.request.post('/api/bookings', {
        headers,
        data: {
          roomId,
          subject: `Taken ${lang}`,
          start: await cairoInstant(page, day, '14:00'),
          end: await cairoInstant(page, day, '15:00'),
        },
      });
      expect(taken.ok(), 'the booking made behind the dialog').toBeTruthy();
      const { items } = await taken.json();

      await dialog.locator('#bkSubmit').click();
      const notice = dialog.locator('#bkNotice .notice');
      await expect(notice).toContainText(t(lang, 'rooms.book.conflictTitle'));
      await expect(dialog.locator('#bkSubmit')).toBeEnabled();
      await shot(page, `rooms-conflict-${lang}`);

      // "Find another room" closes the dialog and searches the same time again.
      await notice.locator('[data-find-another]').click();
      await expect(dialog).toHaveCount(0);
      await expect(rows.first()).toBeVisible();
      await expect(rows.filter({ hasText: ROOM_NAMES[lang][0] })).toHaveCount(0);
      await expect(page.locator('#findStart')).toHaveValue('14:00');

      const cancelled = await page.request.post(`/api/bookings/${items[0].id}/cancel`, {
        headers,
        data: { scope: 'one' },
      });
      expect(cancelled.ok()).toBeTruthy();
    });

    test('a room name opens its panel with the seats, the floor and the equipment', async ({
      page,
    }) => {
      await signIn(page, { company: 'GEN', role: 'User', lang });
      const day = bookableDay(page, lang, 3);

      await page.goto(`/#rooms?date=${day}&start=09:00&duration=30&people=1`);
      const link = page.locator('#freeBody a[data-room]', { hasText: ROOM_NAMES[lang][0] });
      await link.click();

      const panel = page.locator('dialog.dialog--drawer[open]');
      await expect(panel).toBeVisible();
      await expect(panel.locator('.dialog__title')).toHaveText(ROOM_NAMES[lang][0]);
      await expect(panel).toContainText(t(lang, 'rooms.detail.noPhoto'));
      await expect(panel.locator('.room-gear__item')).toHaveCount(2);
      await expect(page).toHaveURL(/#rooms\/[0-9a-f-]{36}$/);
      await shot(page, `rooms-panel-${lang}`);
      await expectNoSidewaysScroll(page);

      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(page).toHaveURL(/#rooms\?date=/);
    });
  });
}

/**
 * An instant for a Cairo wall time, asked of the browser (which knows the
 * zone's rules) so the spec carries no offset table of its own.
 */
async function cairoInstant(page, day, time) {
  return page.evaluate(
    async ([ymd, hhmm]) => {
      const { fromCairoInput } = await import('/assets/js/format.js');
      return fromCairoInput(`${ymd}T${hhmm}`);
    },
    [day, time]
  );
}
