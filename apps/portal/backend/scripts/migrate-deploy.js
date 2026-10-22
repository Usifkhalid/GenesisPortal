/**
 * migrate-deploy.js — `npm run db:deploy`: applies the portal's pending
 * migrations (packages/shared/server/cli/migrate-deploy.js, docs/DEPLOY.md).
 */

import '../src/config/env.js';
import { cli } from '@mg/shared/server/cli/migrate-deploy.js';

cli();
