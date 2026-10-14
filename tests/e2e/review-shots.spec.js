/**
 * review-shots.spec.js — screenshots of every page for a design review:
 * both languages, light and dark, at the two screens. Only runs with
 * E2E_SHOTS=1 (`E2E_SHOTS=1 npx playwright test review-shots`); the images
 * land in test-results/shots. It asserts nothing but that each page drew.
 */

import { LANGUAGES, expect, shot, signIn, signOut, test } from './helpers.js';

test.skip(process.env.E2E_SHOTS !== '1', 'screenshots are taken on request');

const EMPLOYEE = [
  'home',
  'announcements',
  'rooms',
  'rooms/mine',
  'tickets',
  'tickets/new',
  'directory',
  'notifications',
  'help',
];
const ADMIN = [
  'admin/companies',
  'admin/bookings',
  'admin/sync',
  'admin/it-team',
  'audit-log',
  'announcements/new',
];
/** The IT Helpdesk's pages (D135), under /helpdesk. */
const IT = ['queue', 'assigned', 'reports', 'settings'];

async function visit(page, lang, scheme, who, routes, base = '/') {
  for (const route of routes) {
    await page.goto(`${base}#${route}`);
    await expect(page.locator('#page h1, #page h2').first()).toBeVisible();
    await expect(page.locator('#page .skeleton')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await shot(page, `${who}-${route.replaceAll('/', '_')}-${lang}-${scheme}`);
  }
}

for (const lang of LANGUAGES) {
  for (const scheme of ['light', 'dark']) {
    test(`shots ${lang} ${scheme}`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page, { company: 'GEN', role: 'User', name: 'Salma Ibrahim', lang });
      await visit(page, lang, scheme, 'emp', EMPLOYEE);
      await signOut(page);
      await shot(page, `login-${lang}-${scheme}`);
      await signIn(page, { company: 'HLD', role: 'HoldingAdmin', lang });
      await visit(page, lang, scheme, 'adm', ADMIN);
      await signOut(page);
      await signIn(page, { company: 'HLD', name: 'Omar Fahmy', lang });
      await visit(page, lang, scheme, 'it', IT, '/helpdesk');
    });
  }
}
