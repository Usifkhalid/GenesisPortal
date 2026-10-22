import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  ACCENT_RULES,
  EDGE_GROUNDS,
  GROUNDS,
  checkAccent,
} from '@mg/shared/web/assets/js/accent.js';
import { COMPANIES } from '@mg/shared/server/demo/seed-data.js';

const tokens = readFileSync(
  new URL('../../../../packages/shared/web/assets/css/tokens.css', import.meta.url),
  'utf8'
);

describe('accent rule', () => {
  test('its constants are the ones tokens.css derives with', () => {
    const R = ACCENT_RULES;
    const has = (text) => assert.ok(tokens.includes(text), `tokens.css no longer has: ${text}`);

    has(`clamp(${R.fillBand[0]}, l, ${R.fillBand[1]})`);
    has(`- ${R.labelThreshold})`);
    has(`clamp(${R.inkLight.min}, min(l, ${R.inkLight.max}), 1)`);
    has(`max(l, ${R.inkDarkFloor})`);
    has(`min(c, ${R.inkDarkChromaCap}) * ${R.inkDarkChromaScale}`);
    has(`min(l, ${R.edgeLightMax}) c h`);
    has(`clamp(${R.edgeDarkBand[0]}, l, ${R.edgeDarkBand[1]})`);
  });

  test('its grounds are the stone steps in tokens.css', () => {
    const dark = tokens.slice(tokens.indexOf("[data-theme='light']"));
    for (const hex of GROUNDS.light) assert.ok(tokens.includes(hex), hex);
    for (const hex of GROUNDS.dark) assert.ok(dark.includes(hex), hex);
    for (const hex of [...EDGE_GROUNDS.light, ...EDGE_GROUNDS.dark]) {
      assert.ok([...GROUNDS.light, ...GROUNDS.dark].includes(hex), hex);
    }
  });

  test('the seeded company colours pass', () => {
    for (const { code, accentColor } of COMPANIES) {
      assert.equal(checkAccent(accentColor).ok, true, code);
    }
  });

  test('a sweep of the colour cube passes, as D3 promises', () => {
    let failures = 0;
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
          if (!checkAccent(hex).ok) failures += 1;
        }
      }
    }
    assert.equal(failures, 0);
  });

  test('malformed values are rejected with the format reason', () => {
    for (const bad of ['red', '#fff', '#gggggg', '', null, undefined, 12, '#1c7a4a ']) {
      const verdict = checkAccent(bad);
      assert.equal(verdict.ok, false);
      assert.deepEqual(verdict.failed, ['format']);
    }
    assert.equal(checkAccent('#1C7A4A').normalized, '#1c7a4a');
  });
});
