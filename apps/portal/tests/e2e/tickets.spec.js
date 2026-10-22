/**
 * tickets.spec.js — the IT helpdesk, end to end, in English and Arabic at
 * 1440 and 360 px.
 *
 * One story, step by step: a Genesis user raises a ticket in the portal with
 * a pasted screenshot and finds it under My tickets; a Masar user and a
 * colleague cannot see it; the IT Lead assigns it to an agent in the IT
 * Helpdesk (an agent has no assign control, D118; a colleague who does not
 * have it reads it and writes internal notes only, D122); the agent works the
 * queue in the Helpdesk, leaves an internal note and answers with a canned
 * reply; the requester sees the answer in the portal but not the note; the
 * agent resolves it and the requester says it is not solved (a reason is
 * required, the ticket reopens); it is resolved again and the requester says
 * yes with a keyboard-operated star rating, which closes it (D143).
 *
 * Then the split itself (D135): the IT team has the Helpdesk and no portal;
 * the Lead keeps the IT settings; a CompanyAdmin and Nadia (HoldingAdmin)
 * cannot open the Helpdesk or anyone's ticket, and Nadia staffs the team.
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
const LEAD = { company: 'HLD', name: 'Omar Fahmy' };
const OTHER_AGENT = { company: 'HLD', name: 'Tamer Gad' };

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

/** Opens an address inside the IT Helpdesk. */
async function openHd(page, hash) {
  await page.goto(`/helpdesk${hash}`);
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
      await expect(form.locator('input[name="priority"]')).toHaveCount(0);
      await expect(form).not.toContainText(/\bSLA\b|\bP[1-4]\b/);

      await page.locator('.tk-tile').first().click();
      await page.locator('#tkSubject').fill(subject);
      await page.locator('#tkDescription').fill('Paper jams at the second tray every time.');
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
      await expect(done).toContainText(t(lang, 'ticket.priority.P3'));
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

      /* ------------------------------------- the Lead assigns it to an agent */
      await signOut(page);
      await signIn(page, { ...LEAD, lang });
      await expect(page).toHaveURL(/\/helpdesk/);
      await openHd(page, '#queue');
      await page.locator('#tkQ').fill(subject);
      const leadRow = page.locator('#tkQueueBody tbody tr', { hasText: subject });
      await expect(leadRow).toHaveCount(1);
      await expect(leadRow.locator('[data-pick]')).toHaveCount(1);
      await leadRow.locator('a.tk-table__subject').click();
      await expect(page.locator('#tkHandle')).toBeVisible();
      const options = await (await page.request.get('/api/tickets/queue/options')).json();
      const agentId = options.agents.find((a) => a.displayNameEn === AGENT.name).id;
      await page.locator('#tkAssignee').selectOption(agentId);
      await expect(page.locator('#tkAssignee')).toHaveValue(agentId);
      await expect(page.locator('.tk-event', { hasText: /./ }).last()).toBeVisible();
      // Let the page finish its own requests before the session ends.
      await page.waitForLoadState('networkidle');

      /* ----------------- the agent sees the queue, cannot assign, and answers */
      await signOut(page);
      await signIn(page, { ...AGENT, lang });
      await openHd(page, '#queue');
      await expect(page.locator('#tkQ')).toBeVisible();
      await page.locator('#tkQ').fill(subject);
      const row = page.locator('#tkQueueBody tbody tr', { hasText: subject });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(number);
      // IT's words are here: the code and the clock. Assignment is not.
      await expect(row).toContainText('P3');
      await expect(page.locator('[data-pick], #tkPickAll, #tkBulk')).toHaveCount(0);
      await expectNoSidewaysScroll(page);
      await shot(page, `tickets-queue-${lang}`);
      await row.locator('a.tk-table__subject').click();

      await expect(page.locator('#tkHandle')).toBeVisible();
      await expect(page.locator('#tkAssignee')).toHaveCount(0);
      await expect(page.locator('[data-take]')).toHaveCount(0);
      // It shows who has it, read-only.
      await expect(page.locator('#tkHandle')).toContainText(t(lang, 'ticket.assignee'));
      await expect(page.locator('#tkHandle')).not.toContainText(t(lang, 'ticket.unassigned'));
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

      /* ------- a colleague who does not have it reads it and writes notes only */
      await signOut(page);
      await signIn(page, { ...OTHER_AGENT, lang });
      await openHd(page, `#tickets/${ticketId}`);
      await expect(page.locator('#tkHandle')).toBeVisible();
      // The facts are there, with nothing to change them (D122).
      await expect(page.locator('#tkHandle')).toContainText(t(lang, 'tk.side.notYours'));
      await expect(
        page.locator('#tkStatus, #tkPriority, #tkCategory, #tkAssignee')
      ).toHaveCount(0);
      // The reply box is for internal notes: no public side, no canned replies.
      await expect(page.locator('#tkReply')).toHaveClass(/tk-reply--internal/);
      await expect(page.locator('[data-kind], #tkCanned')).toHaveCount(0);
      await expect(page.locator('#tkReply')).toContainText(t(lang, 'tk.reply.notYours'));
      const refused = await page.request.patch(`/api/tickets/${ticketId}`, {
        headers: await csrfHeaders(page),
        data: { status: 'Resolved' },
      });
      expect(refused.status()).toBe(403);
      expect((await refused.json()).error.code).toBe('not_assignee');
      await expectNoSidewaysScroll(page);

      /* ------------- IT resolves it; the requester answers "is it solved?" */
      const resolve = async () => {
        await signOut(page);
        await signIn(page, { ...AGENT, lang });
        await openHd(page, `#tickets/${ticketId}`);
        await page.locator('#tkStatus').selectOption('Resolved');
        await expect(page.locator('#tkHead .labelstrip')).toContainText(
          t(lang, 'ticket.status.Resolved')
        );
        await signOut(page);
        await signIn(page, { ...GEN_USER, lang });
        await open(page, `#tickets/${ticketId}`);
        await expect(page.locator('#tkConfirm')).toContainText(t(lang, 'tk.confirm.title'));
      };

      // "No, still a problem": a reason is required, then the ticket reopens.
      await resolve();
      await shot(page, `tickets-confirm-${lang}`);
      await expectNoSidewaysScroll(page);
      await page.locator('[data-confirm="no"]').click();
      await page.locator('#tkNotSolvedSend').click();
      await expect(page.locator('#tkReason-error')).toContainText(
        t(lang, 'tk.confirm.reasonError')
      );
      await page.locator('#tkReason').fill('It still shows the black screen.');
      await page.locator('#tkNotSolvedSend').click();
      await expect(page.locator('#tkHead .labelstrip')).toContainText(
        t(lang, 'ticket.status.Open')
      );
      await expect(page.locator('#tkConfirm')).toHaveCount(0);
      await expect(
        page.locator('.tk-entry--requester', { hasText: 'It still shows the black screen.' })
      ).toBeVisible();

      // Resolved again: "Yes, solved" needs stars, chosen with the keyboard or a tap.
      await resolve();
      await page.locator('[data-confirm="yes"]').click();
      await expectNoSidewaysScroll(page);
      await page.locator('#tkSolvedSend').click();
      await expect(page.locator('#tkRating-error')).toContainText(
        t(lang, 'tk.confirm.ratingError')
      );
      await expect(page.locator('#tkSolvedForm')).toBeVisible();
      // Each star has a visible number and a name; arrow keys walk the group.
      const stars = page.locator('input[name="tkRating"]');
      await expect(stars).toHaveCount(5);
      await expect(page.locator('.star-rating__number')).toHaveText(['1', '2', '3', '4', '5']);
      await stars.first().focus();
      await page.keyboard.press('Space');
      await expect(page.locator('.star-rating__option.is-on')).toHaveCount(1);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('.star-rating__option.is-on')).toHaveCount(4);
      await expect(page.locator('.star-rating__word')).toHaveText(t(lang, 'tk.rating.word.4'));
      await page.locator('.star-rating__option').nth(4).click();
      await expect(page.locator('.star-rating__option.is-on')).toHaveCount(5);
      await shot(page, `tickets-rating-${lang}`);
      await page.locator('#tkFeedback').fill('Quick and kind.');
      await page.locator('#tkSolvedSend').click();
      await expect(page.locator('#tkHead .labelstrip')).toContainText(
        t(lang, 'ticket.status.Closed')
      );
      await expect(page.locator('#tkNotice')).toContainText(t(lang, 'tk.closed.confirmedYou'));
      await expect(page.locator('#tkNotice .star-rating--static')).toBeVisible();
      await expect(page.locator('#tkNotice')).toContainText('Quick and kind.');
      await expect(page.locator('#tkConfirm')).toHaveCount(0);
      await expectNoSidewaysScroll(page);

      // IT sees the same rating and words, and cannot change them.
      await signOut(page);
      await signIn(page, { ...AGENT, lang });
      await openHd(page, `#tickets/${ticketId}`);
      await expect(page.locator('#tkFacts')).toContainText('Quick and kind.');
      await expect(page.locator('#tkNotice')).toContainText(
        t(lang, 'tk.closed.confirmedStaff')
      );
      await expect(page.locator('input[name="tkRating"]')).toHaveCount(0);
    });

    test('the IT team works in the Helpdesk only; the Lead keeps the IT settings', async ({
      page,
    }) => {
      // An agent lands in the Helpdesk: Queue, My assigned tickets and Reports.
      await signIn(page, { ...AGENT, lang });
      await expect(page).toHaveURL(/\/helpdesk/);
      await expectLanguage(page, lang);
      const nav = page.locator('.app--helpdesk [data-nav]:visible');
      const names = page.locator('.app--helpdesk');
      await expect(names.locator('[data-nav="queue"]:visible')).toHaveCount(1);
      await expect(names.locator('[data-nav="assigned"]:visible')).toHaveCount(1);
      await expect(names.locator('[data-nav="reports"]:visible')).toHaveCount(1);
      await expect(names.locator('[data-nav="settings"]:visible')).toHaveCount(0);
      await expect(nav).toHaveCount(3);
      await expect(page.locator('#tkQueueBody')).toBeVisible();
      // No way into the portal from here.
      await expect(
        page.locator('a[href="/"], a[href^="/#"], a[href="/index.html"]')
      ).toHaveCount(0);
      await expectNoSidewaysScroll(page);
      await shot(page, `helpdesk-queue-${lang}`);

      // My assigned tickets: the same table, fixed to the agent's own.
      await page.locator('[data-nav="assigned"]:visible').click();
      await expect(page.locator('h1')).toHaveText(t(lang, 'hd.nav.assigned'));
      await expect(page.locator('#tkQuick')).toBeHidden();

      // Reports: counts and the SLA for a range of days, and the CSV.
      await page.locator('[data-nav="reports"]:visible').click();
      await expect(page.locator('#hdSummaryTitle')).toBeVisible();
      await expect(page.locator('#hdSlaTitle')).toBeVisible();
      await expect(page.locator('#hdByCompany')).toBeVisible();
      const csv = await page.locator('#hdCsv').getAttribute('href');
      expect(csv).toMatch(/^\/api\/helpdesk\/reports\/export\.csv\?from=\d{4}-\d{2}-\d{2}&to=/);
      expect((await page.request.get(csv)).ok()).toBeTruthy();
      await expectNoSidewaysScroll(page);
      await shot(page, `helpdesk-reports-${lang}`);

      // The portal is not theirs: its pages send them back, its API refuses them.
      await page.goto('/#announcements');
      await page.waitForURL((url) => url.pathname === '/helpdesk');
      // The Helpdesk has drawn before the next address is typed.
      await expect(page.locator('#tkQueueBody')).toBeVisible();
      const refused = await page.request.get('/api/announcements');
      expect(refused.status()).toBe(403);
      expect((await refused.json()).error.code).toBe('helpdesk_only');

      // Settings is the Lead's; an agent who types the address is told no.
      await openHd(page, '#settings');
      await expect(page.locator('#page')).toContainText(t(lang, 'page.noAccess.title'));

      // The Lead edits a setting: a holiday added, then taken away again.
      await signOut(page);
      await signIn(page, { ...LEAD, lang });
      await expect(page.locator('[data-nav="settings"]:visible')).toHaveCount(1);
      await page.locator('[data-nav="settings"]:visible').click();
      await expect(page.locator('#cfgNav')).toBeVisible();
      await expect(page.locator('#cfgNav [data-section="members"]')).toHaveCount(0);
      await page.locator('[data-section="holidays"]').click();
      const run = runIndex(page, lang);
      const day = `2028-0${run + 1}-1${run}`;
      const name = `Helpdesk e2e ${lang} ${run}`;
      await page.locator('[data-add="holiday"]').click();
      await page.locator('#cfg-date').fill(day);
      await page.locator('#cfg-nameEn').fill(name);
      await page.locator('#cfg-nameAr').fill(`عطلة ${run}`);
      await page.locator('#cfgSave').click();
      await page.locator('#cfgYear').selectOption('2028');
      const holiday = page.locator('#cfgBody tbody tr', { hasText: name });
      await expect(holiday).toHaveCount(1);
      await expectNoSidewaysScroll(page);
      await shot(page, `helpdesk-settings-${lang}`);
      await holiday.locator('[data-del-holiday]').click();
      await page.locator('[data-confirm]').click();
      await expect(holiday).toHaveCount(0);
    });

    test('a CompanyAdmin has My tickets and New ticket, and no Helpdesk', async ({ page }) => {
      await signIn(page, { company: 'GEN', role: 'CompanyAdmin', lang });
      await open(page, '#tickets');
      await expect(page.locator('#tkMine')).toBeVisible();
      const links = page.locator('.tk .rooms-nav__link');
      await expect(links).toHaveText([t(lang, 'tk.nav.mine'), t(lang, 'tk.nav.new')]);

      const helpdesk = await page.goto('/helpdesk');
      expect(helpdesk.status()).toBe(403);
      await expect(page.locator('h1')).toHaveText(t(lang, 'hd.noAccess.title'));
      await expectLanguage(page, lang);
      await expectNoSidewaysScroll(page);
      expect((await page.request.get('/api/tickets/queue')).status()).toBe(403);
      expect((await page.request.get('/api/helpdesk/reports')).status()).toBe(403);
    });

    test('Nadia cannot open the Helpdesk or a ticket, and staffs the IT team', async ({
      page,
    }) => {
      // Someone raises a ticket.
      await signIn(page, { ...GEN_USER, lang });
      const options = await (await page.request.get('/api/tickets/options')).json();
      const raised = await page.request.post('/api/tickets', {
        headers: await csrfHeaders(page),
        data: {
          subject: `Monitor flickers ${lang} ${runIndex(page, lang)} ${Date.now()}`,
          description: 'Since this morning.',
          categoryId: options.categories[0].id,
        },
      });
      expect(raised.status()).toBe(201);
      const { ticket } = await raised.json();
      await signOut(page);

      const holding = await findUser(page, { company: 'HLD', role: 'HoldingAdmin' });
      await signIn(page, { company: holding.company.code, role: 'HoldingAdmin', lang });
      expect((await page.goto('/helpdesk')).status()).toBe(403);
      await expect(page.locator('h1')).toHaveText(t(lang, 'hd.noAccess.title'));
      expect((await page.request.get(`/api/tickets/${ticket.id}`)).status()).toBe(404);
      expect((await page.request.get('/api/tickets/queue')).status()).toBe(403);
      await open(page, `#tickets/${ticket.id}`);
      await expect(page.locator('#tkView')).toContainText(t(lang, 'tk.detail.missingTitle'));

      // Administration > IT team: people and roles, nothing of the tickets.
      await open(page, '#admin/it-team');
      await expect(page.locator('#cfgNav')).toBeHidden();
      await expect(page.locator('[data-role]').first()).toBeVisible();
      await expect(page.locator('#page')).not.toContainText(ticket.subject);
      await expectNoSidewaysScroll(page);
      await shot(page, `admin-it-team-${lang}`);

      // Adding and removing someone changes who works where, so it runs once
      // per language, on the desktop, with a person no other spec signs in as.
      if (page.viewportSize().width < 600) return;
      const [person, personAr] =
        lang === 'en'
          ? ['Mona Abdel Rahman', 'منى عبد الرحمن']
          : ['Karim Mansour', 'كريم منصور'];
      const shown = lang === 'ar' ? personAr : person;
      await page.locator('#cfgMemberInput').fill(person.split(' ')[0]);
      await page
        .getByRole('option', { name: new RegExp(shown) })
        .first()
        .dispatchEvent('mousedown');
      await page.locator('#cfgAddMember button[type="submit"]').click();
      const row = page.locator('#cfgBody tbody tr', { hasText: shown });
      await expect(row).toHaveCount(1);
      await expect(row.locator('[data-role]')).toHaveValue('Agent');

      // Back off the team, so the portal is theirs again.
      await row.locator('[data-remove-member]').click();
      await page.locator('[data-confirm]').click();
      await expect(row).toHaveCount(0);
    });
  });
}
