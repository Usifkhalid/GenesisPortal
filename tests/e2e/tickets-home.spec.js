/**
 * tickets-home.spec.js — Home and the navigation on the real helpdesk API.
 *
 * A Masar user raises a ticket (through the API: the Tickets page itself
 * comes next) and finds it on Home's "open" card with its IT number, and a
 * count beside Tickets. An IT agent, who works for another company, sees the
 * count of tickets assigned to them (a Lead: the unassigned), asks the user a question, and the
 * ticket moves to the user's "waiting on you" card.
 *
 * Run four times in parallel on one database, so every check is on this
 * run's own ticket, found by its subject.
 */

import {
  LANGUAGES,
  assignTicket,
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

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('my ticket is on Home and counted in the nav; an agent’s question moves it to "waiting on you"', async ({
      page,
    }) => {
      await signIn(page, { company: 'MSR', role: 'User', lang });
      await expectLanguage(page, lang);
      const subject = `Wi-Fi drops ${lang} ${runIndex(page, lang)} ${Date.now()}`;

      const options = await (await page.request.get('/api/tickets/options')).json();
      const created = await page.request.post('/api/tickets', {
        headers: await csrfHeaders(page),
        data: {
          subject,
          description: 'It drops every afternoon in the site office.',
          categoryId: options.categories[0].id,
        },
      });
      expect(created.ok(), 'the ticket is raised').toBeTruthy();
      const { ticket } = await created.json();
      expect(ticket.number).toMatch(/^IT-\d{4}-\d{5}$/);

      // Home: the open card lists it with its number, its status and a due time.
      await page.goto('/');
      const open = page.locator('[data-card="tickets"]');
      const row = open.locator('.record', { hasText: subject });
      await expect(row).toBeVisible();
      await expect(row).toContainText(ticket.number);
      await expect(row).toContainText(t(lang, 'ticket.status.New'));
      await expect(row).toContainText(t(lang, `ticket.priority.${ticket.priority}`));
      await expect(open.locator('.card__count')).toBeVisible();
      // Nothing is waiting on this run's ticket yet.
      const waiting = page.locator('[data-card="waiting"]');
      await expect(waiting.locator('.record', { hasText: subject })).toHaveCount(0);

      // The nav: a real count, and no demo data anywhere.
      const count = page.locator('[data-ticket-count]').first();
      await expect(count).toHaveText(/^([1-9]\d?|99\+)$/);
      await expect(page.locator('#page')).not.toContainText('Weighbridge');
      await shot(page, `tickets-home-${lang}`);
      await expectNoSidewaysScroll(page);

      // The IT Lead, in the IT Helpdesk (D135), sees it among the unassigned.
      await signOut(page);
      await signIn(page, { company: 'HLD', name: 'Omar Fahmy', lang });
      await expect(page).toHaveURL(/\/helpdesk/);
      const leadCounts = await (await page.request.get('/api/tickets/counts')).json();
      expect(leadCounts.queue.canAssign).toBe(true);
      expect(leadCounts.queue.unassigned).toBeGreaterThanOrEqual(1);

      // An IT agent reads the queue, but their own number is the tickets
      // assigned to them (D118): this one is not.
      await signOut(page);
      await signIn(page, { company: 'HLD', name: 'Sherif Awad', lang });
      const counts = await (await page.request.get('/api/tickets/counts')).json();
      expect(counts.queue.canAssign).toBe(false);
      expect(counts.queue.unassigned).toBeGreaterThanOrEqual(1);
      // The agent has no portal Home: they work in the Helpdesk.
      await expect(page).toHaveURL(/\/helpdesk/);
      await expect(page.locator('[data-card="tickets"]')).toHaveCount(0);

      // The Lead gives it to this agent (D122): only the assignee answers.
      await signOut(page);
      await signIn(page, { company: 'HLD', name: 'Omar Fahmy', lang });
      await assignTicket(page, ticket.id, 'Sherif Awad');
      await signOut(page);
      await signIn(page, { company: 'HLD', name: 'Sherif Awad', lang });

      const headers = await csrfHeaders(page);
      const asked = await page.request.post(`/api/tickets/${ticket.id}/comments`, {
        headers,
        data: { body: 'Which access point are you nearest to?' },
      });
      expect(asked.ok()).toBeTruthy();
      const paused = await page.request.patch(`/api/tickets/${ticket.id}`, {
        headers,
        data: { status: 'WaitingOnRequester' },
      });
      expect(paused.ok(), 'the agent sets it to waiting').toBeTruthy();

      // Back as the user: it is now waiting on them.
      await signOut(page);
      await signIn(page, { company: 'MSR', role: 'User', lang });
      const mine = page.locator('[data-card="waiting"] .record', { hasText: subject });
      await expect(mine).toBeVisible();
      await expect(mine).toContainText(t(lang, 'ticket.status.WaitingOnRequester'));
      await shot(page, `tickets-home-waiting-${lang}`);
      await expectNoSidewaysScroll(page);

      // Closed again, so the next run's Home is not crowded by this one.
      await signOut(page);
      await signIn(page, { company: 'HLD', name: 'Sherif Awad', lang });
      const closed = await page.request.patch(`/api/tickets/${ticket.id}`, {
        headers: await csrfHeaders(page),
        data: { status: 'Closed' },
      });
      expect(closed.ok()).toBeTruthy();
    });
  });
}
