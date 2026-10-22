/**
 * import-hr.js — `npm run import:hr -- --as <email> [--dry-run]`: HR's staff
 * list into the portal's live people (packages/shared/server/cli/import-hr.js,
 * D140).
 */

import '../src/config/env.js';
import { cli } from '@mg/shared/server/cli/import-hr.js';

await cli();
