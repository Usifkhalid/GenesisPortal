/**
 * setup-live-db.js — `npm run db:setup-live`: the helpdesk's live database
 * (mghelpdesk_live) made ready for the real tenant: created and migrated, the
 * companies and their mail domains, the IT team with its hours, SLA,
 * categories, canned replies, locations and holidays, and with
 * `--it-leads a@x.com,b@x.com --it-members c@x.com` its people, as D141
 * (packages/shared/server/cli/setup-live-db.js). People arrive through
 * `npm run sync:users` and Entra sign-in.
 *
 * After `npm run migrate:from-portal` (D145) the companies, the IT team and
 * its settings are the portal's: this keeps them as they are and adds no
 * default beside them (src/modules/admin/defaults.js).
 */

import '../src/config/env.js';
import {
  companiesFromPortal,
  ensureDefaults,
  settingsFromPortal,
} from '../src/modules/admin/defaults.js';
import { cli } from '@mg/shared/server/cli/setup-live-db.js';

await cli('db:setup-live', process.argv.slice(2), {
  companiesFromPortal,
  settingsFromPortal,
  ensureDefaults,
});
