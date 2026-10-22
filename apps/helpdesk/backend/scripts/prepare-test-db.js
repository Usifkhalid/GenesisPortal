/**
 * prepare-test-db.js — the helpdesk's test database (mghelpdesk_test): created
 * when missing, migrated, emptied and (with --seed) seeded. Run by `npm test`
 * (pretest) and before the e2e server (packages/shared/server/cli).
 */

import '../src/config/env.js';
import { cli } from '@mg/shared/server/cli/prepare-test-db.js';

await cli();
