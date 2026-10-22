/**
 * a11y.js — axe-core checks for either app's accessibility specs: the
 * standards scanned, which findings fail a test, a finding in one line, and
 * waiting until a page has drawn before it is scanned.
 */

import { expect as strictExpect } from './helpers.js';

/** A page with many requests can take a while to settle on a loaded machine. */
const expect = strictExpect.configure({ timeout: 20_000 });

export const STANDARDS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
];

export const isSerious = (violation) =>
  violation.impact === 'serious' || violation.impact === 'critical';

/** What went wrong, in a line a person can act on. */
export function describe(violation) {
  const where = violation.nodes
    .slice(0, 3)
    .map((node) => node.target.join(' '))
    .join(' | ');
  const data = violation.nodes[0]?.any[0]?.data;
  const detail = data?.contrastRatio
    ? ` [${data.fgColor} on ${data.bgColor}, ${data.contrastRatio}:1]`
    : '';
  return `${violation.impact} ${violation.id}: ${violation.help} (${violation.nodes.length}) -> ${where}${detail}`;
}

/** Waits until the page has drawn: no skeleton and nothing still loading. */
export async function settled(page) {
  await expect(page.locator('#page [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('#page .skeleton')).toHaveCount(0);
  await expect(page.locator('#page h1').first()).toBeVisible();
  // Searches and counts that start once the page is up.
  await page.waitForLoadState('networkidle');
  // A colour still in transition or fading in is not the colour a person is
  // left with: wait until nothing on the page is animating.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length
      )
    )
    .toBe(0);
}
