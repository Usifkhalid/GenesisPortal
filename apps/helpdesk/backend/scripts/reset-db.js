/**
 * reset-db.js — `npm run db:reset`: drops, recreates, migrates and seeds the
 * helpdesk's DEVELOPMENT database (packages/shared/server/cli/reset-db.js).
 */

import { cli } from '@mg/shared/server/cli/reset-db.js';

await cli(() => import('../src/config/env.js'));
