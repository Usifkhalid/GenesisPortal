/**
 * on-behalf.spec.js — an IT agent raises a ticket for an employee who phoned
 * (the Queue's "Log a ticket for someone"). The employee is the requester:
 * they find it under My tickets, and the ticket says who raised it for whom.
 */

import {
  LANGUAGES,
  expect as strictExpect,
  expectNoSidewaysScroll,
  findUser,
  runIndex,
  signIn,
  signOut,
  t,
  test,
} from './helpers.js';

const expect = strictExpect.configure({ timeout: 20_000 });

const AGENT = { company: 'HLD', name: 'Sherif Awad' };
const EMPLOYEE = { company: 'GEN', role: 'User', name: 'Salma Ibrahim' };

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('the agent raises it for the employee; it is theirs and says so', async ({ page }) => {
      const run = runIndex(page, lang);
      const subject = `Phoned: no network ${lang} ${run} ${Date.now()}`;
      const nameOf = (person) => (lang === 'ar' ? person.displayNameAr : person.displayNameEn);

      /* ------------------------------------------------ the agent logs it */
      const agent = await signIn(page, { ...AGENT, lang });
      await page.goto('/queue');
      await expect(page.locator('#tkLog')).toBeVisible();
      await page.locator('#tkLog').click();

      const form = page.locator('#tkLogForm');
      await expect(form).toBeVisible();
      await expectNoSidewaysScroll(page);

      // Nobody is chosen yet: the form says so and nothing is sent.
      await page.locator('#tkLogSubmit').click();
      await expect(form.locator('#tkLogWho-error')).toBeVisible();

      const employee = await findUser(page, EMPLOYEE);
      const search = lang === 'ar' ? nameOf(employee).split(' ')[0] : 'Salma';
      await page.locator('#tkLogWhoInput').fill(search);
      await page
        .locator('.picker__option', { hasText: nameOf(employee) })
        .first()
        .click();
      await expect(form.locator('.picker__chip')).toContainText(nameOf(employee));

      await expect(form.locator('input[name="source"]:checked')).toHaveValue('phone');
      await form.locator('#tkLogCategory').selectOption({ index: 1 });
      await form.locator('#tkLogSubject').fill(subject);
      await form.locator('#tkLogDescription').fill('Rang the desk: no network at their desk.');
      const made = page.waitForResponse(
        (r) => r.url().endsWith('/api/tickets') && r.request().method() === 'POST'
      );
      await page.locator('#tkLogSubmit').click();
      const response = await made;
      expect(response.status()).toBe(201);
      const { ticket } = await response.json();
      expect(ticket.requester.id).toBe(employee.id);
      await expect(form).toHaveCount(0);

      /* ---------------------------------- the ticket says who raised it for whom */
      await page.goto(`/#tickets/${ticket.id}`);
      await expect(page.locator('#tkSubject')).toContainText(subject);
      // Two lines say where a ticket came from: who opened it, and who raised it for them.
      const provenance = page.locator('.provenance', { hasText: nameOf(agent) });
      await expect(provenance).toHaveCount(1);
      await expect(provenance).toContainText(nameOf(agent));
      await expect(provenance).toContainText(nameOf(employee));
      await expect(provenance).toContainText(t(lang, 'tk.source.phone'));
      await expectNoSidewaysScroll(page);

      /* ---------------------------------- the employee has it under My tickets */
      await signOut(page);
      await signIn(page, { ...EMPLOYEE, lang });
      await page.goto('/#tickets');
      const mine = page.locator('#tkMine .record', { hasText: subject });
      await expect(mine).toBeVisible();
      await mine.locator('a').click();
      await expect(page.locator('#tkSubject')).toContainText(subject);
      await expect(
        page
          .locator('.provenance', { hasText: nameOf(agent) })
          .filter({ hasText: nameOf(employee) })
      ).toHaveCount(1);
      expect(page.url()).toContain(ticket.id);
    });
  });
}
