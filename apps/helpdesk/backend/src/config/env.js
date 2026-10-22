/**
 * env.js — the one place in the IT Helpdesk that reads process.env.
 *
 * Everything else imports `env` from here, so a missing or malformed variable
 * fails once, at boot, with a message naming the variable, never halfway
 * through a request. Secrets live only in apps/helpdesk/.env; .env.example
 * lists the keys with placeholder values. The rules are the portal's
 * (packages/shared/server/config/env-core.js) under the helpdesk's names:
 *
 *   HELPDESK_DATA            demo | live (mghelpdesk / mghelpdesk_live, D139)
 *   INITIAL_HELPDESK_ADMINS  the helpdesk's first administrators (D136)
 *   GRAPH_MAIL_MODE          mail through Graph (GRAPH_MODE's other name)
 *   PORTAL_URL               where "Back to portal" leads; absent: no link
 *
 * Importing this file also tells the shared code which app it is serving
 * (config/runtime.js), and which database client to use: the helpdesk's own,
 * generated from backend/prisma/schema.prisma into backend/generated/client.
 */

import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  createEnvLoader,
  parseEmailList,
  prepareProcessEnv,
} from '@mg/shared/server/config/env-core.js';
import { configureRuntime } from '@mg/shared/server/config/runtime.js';

export { parseEmailList };

/** The repository, resolved from this file rather than the cwd. */
export const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** The helpdesk's own folder (apps/helpdesk). */
export const APP_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The helpdesk's own static files. */
export const FRONTEND_DIR = fileURLToPath(new URL('../../../frontend/', import.meta.url));

/** The design system, shared components and ticket pages both apps serve. */
export const SHARED_WEB_DIR = fileURLToPath(
  new URL('../../../../../packages/shared/web/', import.meta.url)
);

/** The helpdesk's database schema and migrations. */
export const PRISMA_SCHEMA = fileURLToPath(
  new URL('../../prisma/schema.prisma', import.meta.url)
);

/** Where static files are looked up, first match wins. */
export const FRONTEND_DIRS = [FRONTEND_DIR, SHARED_WEB_DIR];

prepareProcessEnv({
  envFile: new URL('../../../.env', import.meta.url),
  dataVar: 'HELPDESK_DATA',
});

/**
 * Validates a set of variables. Exported for tests; the app uses `env`.
 * Error messages name variables and never echo their values.
 */
export const loadEnv = createEnvLoader({
  dataVar: 'HELPDESK_DATA',
  adminsVar: 'INITIAL_HELPDESK_ADMINS',
  defaultPort: 3001,
  defaultContainer: 'helpdesk-files',
  sessionCookieName: 'mgh.sid',
  extraShape: {
    /**
     * The portal's public address, for the small "Back to portal" link in
     * the header. Absent: no link.
     */
    PORTAL_URL: z.url().optional(),
  },
});

export const env = loadEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

configureRuntime({
  appName: 'helpdesk',
  env,
  dataVar: 'HELPDESK_DATA',
  repoRoot: ROOT,
  frontendDirs: FRONTEND_DIRS,
  // The shared strings, then the helpdesk's own (assets/i18n/<bundle>.<lang>.json).
  i18nBundles: ['common', 'helpdesk'],
  // Ticket attachments: apps/helpdesk/storage, apart from the portal's files.
  storageBase: APP_ROOT,
  storageDefault: 'storage',
  outboxDir: new URL('../../mock/outbox/', import.meta.url),
  prismaSchema: PRISMA_SCHEMA,
  seed: () => import('../../prisma/seed.js').then((module) => module.seed),
  prismaClient: () =>
    import('../../generated/client/index.js').then((module) => module.PrismaClient),
});
