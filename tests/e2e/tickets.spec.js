/**
 * tickets.spec.js — the IT helpdesk, end to end, in English and Arabic at
 * 1440 and 360 px.
 *
 * One story, step by step: a Genesis user raises a ticket with a pasted
 * screenshot and finds it under My tickets; a Masar user and a colleague of
 * another team cannot see it; an IT agent finds it in the queue, takes it,
 * leaves an internal note and answers with a canned reply; the requester
 * sees the answer but not the note; the agent resolves it and the requester
 * reopens it. A CompanyAdmin who is not on the IT team has no queue.
 *
 * Four runs share one database, so everything is found by this run's subject.
 */

import {
  LANGUAGES,
  csrfHeaders,
  expect as strictExpect,
  expectLanguage,
  expectNoSidewaysScroll,
  findUser,
  runIndex,
  shot,
  signIn,
  signOut,
  t,
  test,
} from './helpers.js';

const expect = strictExpect.configure({ timeout: 20_000 });

/** A 1x1 PNG: what a screenshot pasted from the clipboard is, in miniature. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const GEN_USER = { company: 'GEN', role: 'User', name: 'Salma Ibrahim' };
const GEN_COLLEAGUE = { company: 'GEN', role: 'User', name: 'Mahmoud Attia' };
const MSR_USER = { company: 'MSR', role: 'User', name: 'Yasmine Nabil' };
const AGENT = { company: 'HLD', name: 'Sherif Awad' };

/** Pastes a screenshot into `selector`, as Ctrl+V would. */
async function pasteScreenshot(page, selector) {
  await page.locator(selector).evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  }, PNG);
}

/** Opens an address inside the signed-in portal. */
async function open(page, hash) {
  await page.goto(`/${hash}`);
  await expect(page.locator('#page')).not.toContainText('Loading');
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('raise with a pasted screenshot, work it as IT, answer, resolve, reopen', async ({
      page,
    }) => {
      const run = runIndex(page, lang);
      const subject = `Printer jams ${lang} ${run} ${Date.now()}`;
      const note = `Checked the rollers ${lang} ${run}`;
      const marker = `Thank you for waiting ${lang} ${run}`;

      /* ------------------------------------------- the requester raises it */
      await signIn(page, { ...GEN_USER, lang });
      await expectLanguage(page, lang);
      await open(page, '#tickets/new');

      // Plain words only: no codes, no SLA.
      const form = page.locator('#tkNew');
      await expect(form).toBeVisible();
      await expect(form).toContainText(t(lang, 'tk.new.urgency'));
      await expect(form).not.toContainText(/\bSLA\b|\bP[1-4]\b/);
      for (const p of ['P1', 'P2', 'P3', 'P4']) {
        await expect(form).toContainText(t(lang, `ticket.priority.${p}`));
        await expect(form).toContainText(t(lang, `tk.urgency.${p}`));
      }

      await page.locator('.tk-tile').first().click();
      await page.locator('#tkSubject').fill(subject);
      await page.locator('#tkDescription').fill('Paper jams at the second tray every time.');
      await page.locator('input[name="priority"][value="P2"]').check();
      await pasteScreenshot(page, '#tkDescription');
      const file = page.locator('#tkFiles .tk-file');
      await expect(file).toHaveCount(1);
      await expect(file).toContainText(t(lang, 'tk.new.screenshotName'));
      await expectNoSidewaysScroll(page);
      await shot(page, `tickets-new-${lang}`);

      await page.locator('#tkSubmit').click();
      const done = page.locator('#tkDone');
      await expect(done).toBeVisible();
      const number = (
        await done.locator('.labelstrip__value bdi').first().textContent()
      ).trim();
      expect(number).toMatch(/^IT-\d{4}-\d{5}$/);
      await expect(done).toContainText(t(lang, 'ticket.priority.P2'));
      await expect(done).toContainText(t(lang, 'tk.expect.reply'));
      const href = await done.locator('a.btn--primary').getAttribute('href');
      const ticketId = href.replace('#tickets/', '');
      await shot(page, `tickets-done-${lang}`);

      // It is under My tickets, with its screenshot on the ticket.
      await open(page, '#tickets');
      const mine = page.locator('#tkMine .record', { hasText: subject });
      await expect(mine).toBeVisible();
      await expect(mine).toContainText(number);
      await expect(mine).toContainText(t(lang, 'ticket.status.New'));
      await mine.locator('a').click();
      await expect(page.locator('#tkSubject')).toContainText(subject);
      await expect(page.locator('.tk-attachments .tk-chip')).toHaveCount(1);
      // The requester's reading has no queue words in it.
      await expect(page.locator('.tk-detail')).not.toContainText(/\bSLA\b|breached/i);
      await expect(page.locator('#tkHandle')).toHaveCount(0);
      await expectNoSidewaysScroll(page);
      await shot(page, `tickets-detail-requester-${lang}`);

      /* ------------------------------------- nobody else can see the ticket */
      for (const other of [MSR_USER, GEN_COLLEAGUE]) {
        await signOut(page);
        await signIn(page, { ...other, lang });
        await open(page, '#tickets');
        await expect(page.locator('#tkMineBody')).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator('#tkMine .record', { hasText: subject })).toHaveCount(0);
        await open(page, `#tickets/${ticketId}`);
        await expect(page.locator('#tkView')).toContainText(t(lang, 'tk.detail.missingTitle'));
        const api = await page.request.get(`/api/tickets/${ticketId}`);
        expect(api.status()).toBe(404);
      }

      /* -------------------------------------------- IT takes it and answers */
      await signOut(page);
      await signIn(page, { ...AGENT, lang });
      await open(page, '#tickets/queue');
      await expect(page.locator('#tkQ')).toBeVisible();
      await page.locator('#tkQ').fill(subject);
      const row = page.locator('#tkQueueBody tbody tr', { hasText: subject });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(number);
      // IT's words are here: the code and the clock.
      await expect(row).toContainText('P2');
      await expectNoSidewaysScroll(page);
      await shot(page, `tickets-queue-${lang}`);
      await row.locator('a.tk-table__subject').click();

      await expect(page.locator('#tkHandle')).toBeVisible();
      await page.locator('[data-take]').click();
      await expect(page.locator('#tkAssignee')).not.toHaveValue('');
      await expect(page.locator('#tkContact')).toContainText('Salma');

      // An internal note: drawn apart, and flagged before it is sent.
      await page.locator('[data-kind="internal"]').click();
      await expect(page.locator('#tkReply')).toHaveClass(/tk-reply--internal/);
      await page.locator('#tkReplyText').fill(note);
      await page.locator('#tkReplySend').click();
      const internal = page.locator('.tk-entry--internal', { hasText: note });
      await expect(internal).toBeVisible();
      await expect(internal).toContainText(t(lang, 'tk.entry.internal'));

      // A public reply from a canned reply, inserted and then edited.
      await page.locator('[data-kind="public"]').click();
      await expect(page.locator('#tkCanned')).toBeVisible();
      const detail = await (await page.request.get(`/api/tickets/${ticketId}`)).json();
      const replies = await (
        await page.request.get(`/api/tickets/canned-replies?teamId=${detail.ticket.team.id}`)
      ).json();
      const first = replies.items[0];
      const expected = detail.ticket.requesterLanguage === 'ar' ? first.bodyAr : first.bodyEn;
      await page.locator('#tkCanned').selectOption({ index: 1 });
      const box = page.locator('#tkReplyText');
      await expect(box).toHaveValue(expected);
      await box.fill(`${expected}\n\n${marker}`);
      await page.locator('#tkReplySend').click();
      const answer = page.locator('.tk-entry--team', { hasText: marker });
      await expect(answer).toBeVisible();
      await shot(page, `tickets-detail-staff-${lang}`);
      await expectNoSidewaysScroll(page);

      /* -------------------------- the requester sees the answer, not the note */
      await signOut(page);
      await signIn(page, { ...GEN_USER, lang });
      await open(page, `#tickets/${ticketId}`);
      await expect(page.locator('.tk-entry--team', { hasText: marker })).toBeVisible();
      await expect(page.locator('.tk-entry--internal')).toHaveCount(0);
      await expect(page.locator('#page')).not.toContainText(note);
      const asRequester = await (await page.request.get(`/api/tickets/${ticketId}`)).json();
      expect(JSON.stringify(asRequester)).not.toContain(note);
      expect('requesterLanguage' in asRequester.ticket).toBe(false);

      /* ---------------------------------- IT resolves it; the requester reopens */
      await signOut(page);
      await signIn(page, { ...AGENT, lang });
      await open(page, `#tickets/${ticketId}`);
      await page.locator('#tkStatus').selectOption('Resolved');
      await expect(page.locator('#tkHead .labelstrip')).toContainText(
        t(lang, 'ticket.status.Resolved')
      );

      await signOut(page);
      await signIn(page, { ...GEN_USER, lang });
      await open(page, `#tickets/${ticketId}`);
      await expect(page.locator('#tkNotice')).toContainText(
        t(lang, 'tk.reopen.title.Resolved')
      );
      await page.locator('[data-reopen]').click();
      await expect(page.locator('#tkHead .labelstrip')).toContainText(
        t(lang, 'ticket.status.Open')
      );
      await expect(page.locator('#tkNotice')).toBeEmpty();
      await expect(page.locator('.tk-event', { hasText: /./ }).last()).toBeVisible();

      // Closed again, so the next run's queue is not crowded by this one.
      await signOut(page);
      await signIn(page, { ...AGENT, lang });
      const closed = await page.request.patch(`/api/tickets/${ticketId}`, {
        headers: await csrfHeaders(page),
        data: { status: 'Closed' },
      });
      expect(closed.ok()).toBeTruthy();
    });

    test('a CompanyAdmin who is not on the IT team has no queue', async ({ page }) => {
      await signIn(page, { company: 'GEN', role: 'CompanyAdmin', lang });
      await open(page, '#tickets');
      await expect(page.locator('#tkMine')).toBeVisible();
      await expect(page.getByRole('link', { name: t(lang, 'tk.nav.queue') })).toHaveCount(0);
      await expect(page.getByRole('link', { name: t(lang, 'tk.nav.settings') })).toHaveCount(0);

      await open(page, '#tickets/queue');
      await expect(page.locator('#tkView')).toContainText(t(lang, 'page.noAccess.title'));
      expect((await page.request.get('/api/tickets/queue')).status()).toBe(403);
      await expectNoSidewaysScroll(page);
    });

    test('IT sees the queue card on Home and the helpdesk settings', async ({ page }) => {
      await signIn(page, { ...AGENT, lang });
      await open(page, '');
      const card = page.locator('[data-card="queue"]');
      await expect(card).toBeVisible();
      await expect(card).toContainText(t(lang, 'tk.queue.quick.unassigned'));
      await card.getByRole('link', { name: t(lang, 'home.queue.open') }).click();
      await expect(page.locator('#tkQueueTitle')).toBeVisible();
      await expect(page.locator('#tkQuick')).toBeVisible();
      await expectNoSidewaysScroll(page);

      // A Lead and a HoldingAdmin open the helpdesk settings; an agent does not.
      await expect(page.getByRole('link', { name: t(lang, 'tk.nav.settings') })).toHaveCount(0);
      await signOut(page);
      await signIn(page, { company: 'HLD', name: 'Omar Fahmy', lang });
      await open(page, '#tickets/settings');
      await expect(page.locator('#cfgNav')).toBeVisible();
      await page.locator('[data-section="replies"]').click();
      await expect(page.locator('#cfgBody .record').first()).toBeVisible();
      await expectNoSidewaysScroll(page);
      await shot(page, `tickets-settings-${lang}`);
    });

    test('the HoldingAdmin configures the helpdesk in the Admin area', async ({ page }) => {
      const holding = await findUser(page, { company: 'HLD', role: 'HoldingAdmin' });
      await signIn(page, { company: holding.company.code, role: 'HoldingAdmin', lang });
      await open(page, '#admin/helpdesk');
      await expect(page.locator('#cfgNav [data-section]')).toHaveCount(6);
      await page.locator('[data-section="targets"]').click();
      await expect(page.locator('#cfgSla')).toBeVisible();
      await expect(page.locator('#cfgHours')).toBeVisible();
      await page.locator('[data-section="holidays"]').click();
      await expect(page.locator('#cfgBody tbody tr').first()).toBeVisible();
      await page.locator('[data-section="members"]').click();
      await expect(page.locator('[data-role]').first()).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  });
}
