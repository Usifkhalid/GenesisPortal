/**
 * setup-live-db.js — `npm run db:live:setup`: the portal's live database
 * (mgportal_live) made ready for the real tenant: companies and domains, the
 * IT helpdesk's defaults, `--it-leads` / `--it-members`
 * (packages/shared/server/cli/setup-live-db.js, D139, D141).
 */

import '../src/config/env.js';
import { cli } from '@mg/shared/server/cli/setup-live-db.js';

await cli('db:live:setup');
