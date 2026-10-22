/**
 * setup-live-db.js — `npm run db:setup-live`: the helpdesk's live database
 * (mghelpdesk_live) made ready for the real tenant: created and migrated, the
 * companies and their mail domains, the IT team with its hours, SLA,
 * categories, canned replies, locations and holidays, and with
 * `--it-leads a@x.com,b@x.com --it-members c@x.com` its people, as D141
 * (packages/shared/server/cli/setup-live-db.js). People arrive through
 * `npm run sync:users` and Entra sign-in.
 */

import '../src/config/env.js';
import { cli } from '@mg/shared/server/cli/setup-live-db.js';

await cli('db:setup-live');
