/**
 * prepare-test-db.js — the portal's test database: created when missing,
 * migrated, emptied and (with --seed) seeded. Run by `npm test` (pretest) and
 * before the e2e server. The work is shared with the helpdesk
 * (packages/shared/server/cli/prepare-test-db.js).
 */

import '../src/config/env.js';
import { cli } from '@mg/shared/server/cli/prepare-test-db.js';

await cli();
