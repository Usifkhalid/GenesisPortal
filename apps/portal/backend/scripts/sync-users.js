/**
 * sync-users.js — `npm run sync:users [-- --dry-run]`: one directory sync into
 * the portal's database, with a report (packages/shared/server/cli/sync-users.js).
 */

import '../src/config/env.js';
import { cli } from '@mg/shared/server/cli/sync-users.js';

await cli();
