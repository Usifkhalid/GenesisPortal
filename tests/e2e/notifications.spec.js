/**
 * notifications.spec.js — the bell, the notification centre and the
 * preferences, on real notifications.
 *
 * A user raises a ticket and an IT agent answers it (both through the API:
 * the screens that do that have their own specs). The user then finds both
 * events in the bell with a count, follows one and sees it read, opens the
 * centre, marks everything read, and switches a channel off and back on.
 *
 * Run four times in parallel on one database, so each run signs in as a
 * different requester and finds its own notifications by the ticket's number.
 */

import {
  LANGUAGES,
  assignTicket,
  closeTicketAsLead,
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

const expect = strictExpect.configure({ timeout: 20_000 });

/** One requester per run, so one run's "mark all read" is not another's. */
const REQUESTERS = [
  { company: 'MSR', name: 'Ahmed Shawky' },
  { company: 'MSR', name: 'Rania Farouk' },
  { company: 'GEN', name: 'Dina Khalil' },
  { company: 'GEN', name: 'Mahmoud Attia' },
];

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('a ticket and an agent’s reply reach the bell; reading, marking all and the switches work', async ({
      page,
    }) => {
      const requester = REQUESTERS[runIndex(page, lang)];
      await signIn(page, { ...requester, lang });
      await expectLanguage(page, lang);
      const subject = `Badge reader offline ${lang} ${runIndex(page, lang)} ${Date.now()}`;

      const options = await (await page.request.get('/api/tickets/options')).json();
      const created = await page.request.post('/api/tickets', {
        headers: await csrfHeaders(page),
        data: {
          subject,
          description: 'The reader at the gate shows a red light.',
          categoryId: options.categories[0].id,
        },
      });
      expect(created.ok(), 'the ticket is raised').toBeTruthy();
      const { ticket } = await created.json();

      // The Lead gives it to an agent (D122), who answers it.
      await signOut(page);
      await signIn(page, { company: 'HLD', name: 'Omar Fahmy', lang });
      await assignTicket(page, ticket.id, 'Sherif Awad');
      await signOut(page);
      await signIn(page, { company: 'HLD', name: 'Sherif Awad', lang });
      const answered = await page.request.post(`/api/tickets/${ticket.id}/comments`, {
        headers: await csrfHeaders(page),
        data: { body: 'Please power the reader off and on again.' },
      });
      expect(answered.ok(), 'the agent replies').toBeTruthy();

      // Back as the requester: the bell has a count and both events.
      await signOut(page);
      await signIn(page, { ...requester, lang });
      const bell = page.locator('#notifBtn');
      await expect(page.locator('#notifCount')).toBeVisible();
      await expect(page.locator('#notifCount')).toHaveText(/^([1-9]\d?|99\+)$/);
      await expect(bell).toHaveAttribute('aria-label', /\d/);

      await bell.click();
      const menu = page.locator('#notifMenu');
      await expect(menu).toBeVisible();
      const created_ = menu.locator('[data-notification]', { hasText: ticket.number });
      // Newest first, six at most: the reply is there, and so is the new ticket.
      await expect(created_.first()).toBeVisible();
      await expect(menu).toContainText('Please power the reader off and on again.');
      await expectNoSidewaysScroll(page);
      await shot(page, `notifications-bell-${lang}`);

      // Following one opens its ticket and reads it.
      const reply = menu.locator('[data-notification]', {
        hasText: 'Please power the reader off and on again.',
      });
      const id = await reply.first().getAttribute('data-notification');
      await reply.first().click();
      await expect(page).toHaveURL(new RegExp(`#tickets/${ticket.id}`));
      await expect(menu).toBeHidden();
      await expect
        .poll(async () => {
          const list = await (await page.request.get('/api/notifications?pageSize=100')).json();
          return list.items.find((item) => item.id === id)?.readAt ?? null;
        })
        .not.toBeNull();

      // The centre lists them, in the language in use, and marks them all read.
      await page.goto('/#notifications');
      await expect(page.locator('h1')).toHaveText(t(lang, 'notification.title'));
      const rows = page.locator('.notice-page', { hasText: ticket.number });
      await expect(rows.first()).toBeVisible();
      await expectNoSidewaysScroll(page);
      await shot(page, `notifications-centre-${lang}`);

      const markAll = page.locator('#notifyMarkAll');
      await expect(markAll).toHaveText(t(lang, 'notification.markAll'));
      if (await markAll.isEnabled()) await markAll.click();
      await expect(markAll).toBeDisabled();
      await expect(page.locator('#notifCount')).toBeHidden();
      await expect(page.locator('.notice-page[data-notice-unread="true"]')).toHaveCount(0);

      // The "unread" filter now says there is nothing.
      await page.locator('.segmented__option[data-unread="true"]').click();
      await expect(page.locator('.empty__title')).toHaveText(
        t(lang, 'notification.emptyUnreadTitle')
      );

      // Preferences: a switch is saved at once and survives a reload.
      await page.goto('/#notifications/preferences');
      await expect(page.locator('h1')).toHaveText(t(lang, 'notification.prefs.title'));
      const email = page.locator(
        '.switch__input[data-category="bookings"][data-channel="email"]'
      );
      await expect(email).toBeChecked();
      await page.locator('label.switch', { has: email }).click();
      await expect(email).not.toBeChecked();
      await expectNoSidewaysScroll(page);
      await shot(page, `notifications-prefs-${lang}`);
      await page.reload();
      await expect(email).not.toBeChecked();
      await page.locator('label.switch', { has: email }).click();
      await expect(email).toBeChecked();

      // Development only: the mail the portal would have sent is listed, drawn in a frame.
      await page.goto('/#dev');
      await expect(page.locator('h1')).toHaveText(t(lang, 'dev.outbox.title'));
      await page.locator('.outbox > summary').first().click();
      await expect(page.locator('.outbox-frame').first()).toBeVisible();
      await expectNoSidewaysScroll(page);

      // The signed-in person's own settings, and nobody else's.
      const saved = await (await page.request.get('/api/notifications/preferences')).json();
      expect(saved.items.every((item) => item.enabled)).toBeTruthy();

      // Closed again, so the next run's queue is not crowded by this one.
      await closeTicketAsLead(page, ticket.id, lang);
    });
  });
}
