/**
 * env.js — the one place in the portal that reads process.env.
 *
 * Everything else imports `env` from here, so a missing or malformed variable
 * fails once, at boot, with a message naming the variable — never halfway
 * through a request. Secrets live only in apps/portal/.env; .env.example lists
 * the keys with placeholder values. The rules themselves are shared with the
 * IT Helpdesk (packages/shared/server/config/env-core.js); importing this file
 * also tells the shared code which app it is serving (config/runtime.js).
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

/** The portal's own folder (apps/portal). */
export const APP_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The portal's own static files. */
export const FRONTEND_DIR = fileURLToPath(new URL('../../../frontend/', import.meta.url));

/** The design system and shared components both apps serve. */
export const SHARED_WEB_DIR = fileURLToPath(
  new URL('../../../../../packages/shared/web/', import.meta.url)
);

/** The portal's database schema and migrations. */
export const PRISMA_SCHEMA = fileURLToPath(
  new URL('../../prisma/schema.prisma', import.meta.url)
);

/** Where static files are looked up, first match wins. */
export const FRONTEND_DIRS = [FRONTEND_DIR, SHARED_WEB_DIR];

prepareProcessEnv({
  envFile: new URL('../../../.env', import.meta.url),
  dataVar: 'PORTAL_DATA',
});

/**
 * Validates a set of variables. Exported for tests; the app uses `env`.
 * Error messages name variables and never echo their values.
 */
export const loadEnv = createEnvLoader({
  dataVar: 'PORTAL_DATA',
  adminsVar: 'INITIAL_HOLDING_ADMINS',
  defaultPort: 3000,
  defaultContainer: 'portal-files',
  extraShape: {
    /**
     * Where the IT Helpdesk app lives (https://helpdesk.<domain>). The portal
     * links to it from its menu and Home, and sends old ticket links there
     * (D146). Absent: the link is hidden and the server logs a warning.
     */
    HELPDESK_URL: z.url().optional(),
  },
  extraRules(value, refuse) {
    if (value.NODE_ENV === 'production' && value.HELPDESK_URL) {
      if (!value.HELPDESK_URL.startsWith('https://')) {
        refuse('HELPDESK_URL', 'must be an https:// address in production');
      }
    }
  },
});

export const env = loadEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

configureRuntime({
  appName: 'portal',
  env,
  dataVar: 'PORTAL_DATA',
  repoRoot: ROOT,
  frontendDirs: FRONTEND_DIRS,
  // The shared strings, then the portal's own (assets/i18n/<bundle>.<lang>.json).
  i18nBundles: ['common', 'portal'],
  // Uploads stay where they were before the apps were split: <repo>/storage.
  // A relative STORAGE_DIR is read from the repository too.
  storageBase: ROOT,
  storageDefault: 'storage',
  outboxDir: new URL('../../mock/outbox/', import.meta.url),
  prismaSchema: PRISMA_SCHEMA,
  seed: () => import('../../prisma/seed.js').then((module) => module.seed),
  prismaClient: () => import('@prisma/client').then((module) => module.PrismaClient),
});
