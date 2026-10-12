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
  bookableDay,
  cairoInstant,
  csrfHeaders,
  runIndex,
  expect as strictExpect,
  expectLanguage,
  expectNoSidewaysScroll,
  shot,
  signIn,
  signOut,
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

/**
 * A time range is drawn start first from the left ("10:30–10:45") in Arabic
 * exactly as in English, and from the top when it stands on its side. Read off
 * the screen: where the first and the second time of the range actually sit.
 */
async function expectStartFirst(locator) {
  const drawn = await locator.first().evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.search(/\d\d:\d\d–\d\d:\d\d/);
      if (at < 0) continue;
      const box = (from, to) => {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, to);
        return range.getBoundingClientRect();
      };
      const start = box(at, at + 5);
      const end = box(at + 6, at + 11);
      const sideways = getComputedStyle(node.parentElement).writingMode.startsWith('vertical');
      return {
        sideways,
        startFirst: sideways ? start.bottom <= end.top + 1 : start.right <= end.left + 1,
      };
    }
    return null;
  });
  expect(drawn, 'a time range in the element').not.toBeNull();
  expect(drawn.startFirst, 'the start of the range is drawn first, left to right').toBe(true);
  return drawn;
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
      await expectStartFirst(page.locator('#freeSummary'));
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

    test('a 15-minute booking says its exact time in the day view and in its panel', async ({
      page,
    }) => {
      const organiser = await signIn(page, { company: 'GEN', role: 'User', lang });
      const day = bookableDay(page, lang, 5);
      const wide = page.viewportSize().width > 600;
      const subject = `Quarter ${lang} ${runIndex(page, lang)}`;
      const RANGE = '10:30–10:45';
      const fill = (key, vars) =>
        Object.entries(vars).reduce((text, [k, v]) => text.replace(`{${k}}`, v), t(lang, key));

      const rooms = (await (await page.request.get('/api/rooms')).json()).items;
      const room = rooms.find((r) => r.nameEn === 'Meeting Room 1');
      const roomLabel = lang === 'ar' ? room.nameAr : room.nameEn;
      const booked = await page.request.post('/api/bookings', {
        headers: await csrfHeaders(page),
        data: {
          roomId: room.id,
          subject,
          start: await cairoInstant(page, day, '10:30'),
          end: await cairoInstant(page, day, '10:45'),
        },
      });
      expect(booked.ok(), 'the 15-minute booking').toBeTruthy();
      const bookingId = (await booked.json()).items[0].id;

      await page.goto(`/#rooms/day?date=${day}&room=${room.id}`);
      await expect(page.locator('#dayBody')).toHaveAttribute('aria-busy', 'false');

      // The block itself says the range, however narrow it is, and so does its name.
      const block = page.locator(`${wide ? '.day-timeline' : '.day-list'} [data-pop]`);
      await expect(block).toHaveCount(1);
      await expect(block).toContainText(RANGE);
      // Drawn 10:30 then 10:45 in Arabic too; on a desktop the quarter-hour
      // block is too narrow for a line, so the range stands on its side.
      const drawn = await expectStartFirst(block);
      expect(drawn.sideways).toBe(wide);
      await expect(block).toHaveAttribute(
        'aria-label',
        fill('rooms.day.mineNamed', { name: roomLabel, from: '10:30', to: '10:45', subject })
      );

      // The panel: hover on a desktop, a tap on a phone.
      const pop = page.locator('#dayPop');
      await expect(pop).toBeHidden();
      if (wide) await block.hover();
      else await block.tap();
      await expect(pop).toBeVisible();
      await expect(pop).toContainText(RANGE);
      await expectStartFirst(pop);
      await expect(pop).toContainText(fill('rooms.time.minutes', { count: '15' }));
      await expect(pop).toContainText(subject);
      await expect(pop).toContainText(roomLabel);
      await shot(page, `rooms-day-quarter-${lang}`);
      await expectNoSidewaysScroll(page);

      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();

      if (wide) {
        // Keyboard focus opens it too.
        await block.focus();
        await expect(pop).toContainText(RANGE);
        await page.keyboard.press('Escape');

        // An hour label every hour, a lighter line every quarter between.
        await expect(page.locator('.day-axis__label')).toHaveCount(11);
        await expect(
          page.locator('.day-track').first().locator('.day-tick--quarter')
        ).toHaveCount(30);

        // A free stretch says the quarter hour under the pointer before it is booked.
        await page.locator('.day-free').first().hover();
        await expect(pop).toContainText(/09:(00|15)–09:(15|30)/);
        await expectStartFirst(pop);
        await expectStartFirst(page.locator('.day-free__text'));
      } else {
        // The phone list gives each free stretch its exact times as well.
        await expect(page.locator('.day-slot__time').first()).toHaveText('08:00–10:30');
        await expectStartFirst(page.locator('.day-slot__time'));
      }

      // Someone else sees it as busy, with the range and who booked it.
      await signOut(page);
      await signIn(page, { company: 'GEN', role: 'CompanyAdmin', lang });
      await page.goto(`/#rooms/day?date=${day}&room=${room.id}`);
      await expect(block).toContainText(RANGE);
      const who = lang === 'ar' ? organiser.displayNameAr : organiser.displayNameEn;
      await expect(block).toHaveAttribute(
        'aria-label',
        fill('rooms.day.busyNamed', { name: roomLabel, from: '10:30', to: '10:45', who })
      );
      if (wide) await block.hover();
      else await block.tap();
      await expect(pop).toContainText(RANGE);
      await expectStartFirst(pop);
      await expect(pop).toContainText(who);
      await shot(page, `rooms-day-quarter-busy-${lang}`);

      const cancelled = await page.request.post(`/api/bookings/${bookingId}/cancel`, {
        headers: await csrfHeaders(page),
        data: { scope: 'one', reason: 'End of the test' },
      });
      expect(cancelled.ok()).toBeTruthy();
    });
  });
}
