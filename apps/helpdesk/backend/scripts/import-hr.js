/**
 * import-hr.js — `npm run import:hr -- --as <email> [--dry-run]`: HR's staff
 * list into the helpdesk's live people: company, department, title, office,
 * with the portal's rules unchanged (packages/shared/server/cli/import-hr.js,
 * D140). The --as person must be an active HoldingAdmin of the helpdesk.
 */

import '../src/config/env.js';
import { cli } from '@mg/shared/server/cli/import-hr.js';

await cli();
