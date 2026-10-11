/**
 * admin.spec.js — onboarding a company through the portal, with no code
 * change, and seeing every step in the audit log.
 *
 * A holding admin creates a company with English and Arabic names and an
 * accent, adds a department, makes a seeded user its company admin, and finds
 * all three actions in the audit log. That company admin then signs in and
 * sees only that company's departments and audit entries.
 *
 * Each run makes its own company (a random code and domain), so the four
 * projects can run side by side and a re-run never collides. The company is
 * deactivated and the role removed at the end.
 */

import {
  LANGUAGES,
  expect,
  expectLanguage,
  expectNoSidewaysScroll,
  openLogin,
  signIn,
  shot,
  signOut,
  t,
  test,
} from './helpers.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const randomLetters = (n) =>
  Array.from({ length: n }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

/** Signs in as one specific person from the mock login list. */
async function signInAs(page, personId, lang) {
  await openLogin(page, lang);
  await page.locator(`[data-user-id="${personId}"]`).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.locator('#menuUserName')).not.toBeEmpty();
}

/**
 * Someone to make a company admin: a Masar person who holds no admin role.
 * Not a Genesis User, which the smoke tests sign in as, so that a run that
 * promotes one never takes them away from another spec.
 */
async function pickPlainUser(page) {
  // Four tests (two languages, two viewports) run at once and Masar has three
  // such people: wait for one that another test has handed back.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const people = await (await page.request.get('/api/admin/people?q=masar.eg')).json();
    const admins = await (await page.request.get('/api/admin/admins')).json();
    const held = new Set(
      [...admins.holding, ...admins.companies.flatMap((g) => g.admins)].map((a) => a.user.id)
    );
    // People a directory sync added have no Arabic name to search for.
    const candidates = people.items.filter((p) => !held.has(p.id) && p.displayNameAr);
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    if (Date.now() > deadline) throw new Error('No Masar user without an admin role');
    await page.waitForTimeout(500);
  }
}

async function csrf(page) {
  const res = await page.request.get('/api/auth/config');
  return (await res.json()).csrfToken;
}

for (const lang of LANGUAGES) {
  test.describe(`in ${lang}`, () => {
    test('a holding admin onboards a company and its admin sees only theirs', async ({
      page,
    }) => {
      test.setTimeout(150_000);

      const code = `T${randomLetters(4)}`;
      const nameEn = `Test Company ${code}`;
      const nameAr = `شركة اختبار ${code}`;
      const domain = `${code.toLowerCase()}.example`;
      const deptEn = `Dept ${code}`;
      const deptAr = `قسم ${code}`;
      const companyName = lang === 'ar' ? nameAr : nameEn;

      /* ---- the holding admin creates the company */
      await signIn(page, { company: 'HLD', role: 'HoldingAdmin', lang });
      const promoted = await pickPlainUser(page);

      await page.goto('/#admin/companies/new');
      await expect(page.locator('#companyForm')).toBeVisible();
      await expectLanguage(page, lang);

      await page.locator('#f-code').fill(code);
      await page.locator('#f-nameEn').fill(nameEn);
      await page.locator('#f-nameAr').fill(nameAr);
      await page.locator('#f-domains').fill(domain);
      await page.locator('#f-accentHex').fill('#7a3fa0');

      // The verdict is shown before saving, and the preview follows the accent.
      await expect(page.locator('#verdict')).toContainText(t(lang, 'admin.verdict.ok'));
      await shot(page, `form-${lang}`);
      const previewAccent = await page
        .locator('[data-preview][data-theme="light"]')
        .evaluate((el) => el.style.getPropertyValue('--brand-accent'));
      expect(previewAccent).toBe('#7a3fa0');
      await expectNoSidewaysScroll(page);

      // A colour that is not a colour is told so, and nothing is saved.
      await page.locator('#f-accentHex').fill('purple');
      await expect(page.locator('#verdict')).toContainText(t(lang, 'admin.verdict.format'));
      await page.locator('#f-accentHex').fill('#7a3fa0');

      await page.getByRole('button', { name: t(lang, 'admin.companies.create') }).click();
      await expect(page.locator('.toast--success')).toContainText(
        t(lang, 'admin.toast.created')
      );
      await page.waitForURL(/#admin\/companies$/);

      const row = page.locator('tbody tr', { hasText: code });
      await expect(row).toBeVisible();
      await expect(row).toContainText(domain);
      await expect(row).toContainText('#7a3fa0');
      await shot(page, `companies-${lang}`);
      await expectNoSidewaysScroll(page);

      const list = await (await page.request.get('/api/admin/companies')).json();
      const company = list.items.find((c) => c.code === code);
      expect(company).toBeTruthy();

      /* ---- a department */
      await page.goto('/#admin/departments');
      // Choosing a company redraws the page when its departments arrive, which
      // would wipe anything typed before then.
      await page.locator('#add-nameEn').evaluate((el) => el.setAttribute('data-stale', ''));
      await Promise.all([
        page.waitForResponse((res) =>
          res.url().includes(`/api/admin/departments?companyId=${company.id}`)
        ),
        page.locator('#companyPick').selectOption({ value: company.id }),
      ]);
      // The redraw has happened once the form we marked is gone.
      await expect(page.locator('#add-nameEn[data-stale]')).toHaveCount(0);
      await expect(page.locator('#add-nameEn')).toBeVisible();
      await page.locator('#add-nameEn').fill(deptEn);
      await page.locator('#add-nameAr').fill(deptAr);
      await page.getByRole('button', { name: t(lang, 'admin.departments.addButton') }).click();
      await expect(page.locator('tbody tr', { hasText: deptEn })).toBeVisible();
      await expectNoSidewaysScroll(page);

      await shot(page, `departments-${lang}`);

      /* ---- a company admin */
      await page.goto('/#admin/admins');
      const group = page.locator('.admin-group', { hasText: code });
      await group.locator('[data-add]').click();

      const search =
        lang === 'ar' ? promoted.displayNameAr.slice(0, 3) : promoted.displayNameEn.slice(0, 4);
      await page.locator('#peopleQuery').fill(search);
      const result = page.locator('.admin-result', {
        hasText: lang === 'ar' ? promoted.displayNameAr : promoted.displayNameEn,
      });
      await result.click();
      await page.locator('#confirmAdd').click();
      await expect(group.locator('.admin-person')).toHaveCount(1);
      await expectNoSidewaysScroll(page);
      await shot(page, `admins-${lang}`);

      /* ---- all three are in the audit log */
      await page.goto(`/#audit-log?companyId=${company.id}`);
      const table = page.locator('tbody');
      await expect(table).toContainText(t(lang, 'audit.action.company.create'));
      await expect(table).toContainText(t(lang, 'audit.action.department.create'));
      await expect(table).toContainText(t(lang, 'audit.action.role.assign'));
      await expectNoSidewaysScroll(page);
      await shot(page, `audit-${lang}`);

      // The detail drawer says what changed.
      await page
        .locator('tbody tr', { hasText: t(lang, 'audit.action.company.create') })
        .getByRole('button')
        .click();
      const drawer = page.locator('dialog.dialog--drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer).toContainText(nameEn);
      await expect(drawer.locator('.diff__row--changed').first()).toBeVisible();
      await shot(page, `drawer-${lang}`);
      await drawer.locator('[data-modal-close]').click();
      await expect(drawer).toHaveCount(0);

      /* ---- the new company admin sees only their company */
      await signOut(page);
      await signInAs(page, promoted.id, lang);

      const me = await (await page.request.get('/api/me')).json();
      expect(me.nav.some((item) => item.key === 'admin')).toBe(true);

      await page.goto('/#admin');
      // Departments, and the data-quality report for their own company.
      await expect(page.locator('.subnav__link')).toHaveCount(2);
      // Parallel runs may have made this same person admin of another test
      // company too, so the picker may list several, but only test companies.
      const picker = page.locator('#companyPick');
      await expect(page.locator('#companyPick, .admin__company')).toBeVisible();
      if (await picker.count()) {
        for (const option of await picker.locator('option').allTextContents()) {
          expect(option).toMatch(/^T[A-Z]{4} /);
        }
        await picker.selectOption({ value: company.id });
      } else {
        await expect(page.locator('.admin__company')).toHaveText(companyName);
      }
      await expect(page.locator('tbody tr', { hasText: deptEn })).toBeVisible();
      // None of the seeded companies' departments are visible to them.
      await expect(page.locator('tbody')).not.toContainText('Mining Operations');
      await expect(page.locator('tbody')).not.toContainText('Projects');
      await expectNoSidewaysScroll(page);

      // Companies and administrators are the holding admin's.
      await page.goto('/#admin/companies');
      await expect(page.locator('.subnav__link[aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('#adminSection tbody tr', { hasText: 'GEN' })).toHaveCount(0);

      await page.goto('/#audit-log');
      await expect(page.locator('tbody tr').first()).toBeVisible();
      const codes = await page
        .locator('tbody td[data-label="' + t(lang, 'audit.col.company') + '"]')
        .allTextContents();
      expect(codes.length).toBeGreaterThan(0);
      for (const text of codes) expect(text.trim()).toMatch(/^T[A-Z]{4}$/);
      expect(codes.map((c) => c.trim())).toContain(code);
      await expectNoSidewaysScroll(page);

      /* ---- tidy up: remove the role, deactivate the company */
      await signOut(page);
      await signIn(page, { company: 'HLD', role: 'HoldingAdmin', lang });
      const token = await csrf(page);
      const admins = await (await page.request.get('/api/admin/admins')).json();
      const assignment = admins.companies
        .find((g) => g.company.id === company.id)
        .admins.find((a) => a.user.id === promoted.id);
      const headers = { 'X-CSRF-Token': token };
      await page.request.delete(`/api/admin/admins/${assignment.id}`, { headers });

      const fresh = await (await page.request.get(`/api/admin/companies/${company.id}`)).json();
      await page.request.post(`/api/admin/companies/${company.id}/deactivate`, {
        headers,
        data: { updatedAt: fresh.updatedAt },
      });
    });
  });
}
