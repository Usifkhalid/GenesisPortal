/**
 * sync-users.js — `npm run sync:users [-- --dry-run]`: one directory sync from
 * Microsoft 365 into the helpdesk's own database, with a report
 * (packages/shared/server/cli/sync-users.js).
 */

import '../src/config/env.js';
import { cli } from '@mg/shared/server/cli/sync-users.js';

await cli();
