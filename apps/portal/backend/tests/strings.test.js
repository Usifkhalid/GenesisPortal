import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FRONTEND_DIRS } from '../src/config/env.js';
import { checkStrings } from '@mg/shared/server/testing/strings.js';

// CLAUDE.md rule 2: the same keys in English and Arabic, and no page naming a
// key its bundles lack (packages/shared/server/testing/strings.js).
test('every string is in both languages, and every key a page names exists', () => {
  const { unpaired, missing } = checkStrings({
    bundles: ['common', 'portal'],
    dirs: FRONTEND_DIRS,
  });
  assert.deepEqual(unpaired, []);
  assert.deepEqual(missing, []);
});
