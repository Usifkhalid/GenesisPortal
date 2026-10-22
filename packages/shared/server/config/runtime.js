/**
 * runtime.js — what the app running in this process has said about itself.
 *
 * The shared code serves two apps (apps/portal, apps/helpdesk), each with its
 * own environment, database, frontend and Prisma client. Neither may be named
 * here. Each app's backend/src/config/env.js calls configureRuntime() when it
 * is first imported, which is before any request, job or script runs, and the
 * shared modules read it when they are called, never when they are imported.
 *
 *   env            the app's validated environment (config/env-core.js)
 *   appName        'portal' | 'helpdesk': log lines and messages only
 *   dataVar        'PORTAL_DATA' | 'HELPDESK_DATA': which data this machine uses
 *   repoRoot       the repository (private/, reports/: HR files)
 *   frontendDirs   where static files are looked up, first match wins: the
 *                  app's own frontend, then packages/shared/web
 *   i18nBundles    the string files the app's pages load, in order
 *   storageBase    what a relative STORAGE_DIR is read from (lib/storage.js)
 *   storageDefault the local storage adapter's folder when STORAGE_DIR is absent
 *   outboxDir      where mocked mail is written (integrations/graph/mock-mail.js)
 *   prismaSchema   the app's schema.prisma (migrations sit beside it)
 *   seed           () => Promise<(prisma) => counts>: the app's demo seed
 *   prismaClient   () => Promise<PrismaClient class>: the app's generated client
 */

let current = null;

/** @param {object} settings  see above */
export function configureRuntime(settings) {
  current = Object.freeze({ ...settings });
  return current;
}

/** The running app's settings. Throws when no app has configured itself. */
export function runtime() {
  if (!current) {
    throw new Error(
      "No app is configured: import the app's backend/src/config/env.js before shared code runs."
    );
  }
  return current;
}

/** The running app's environment, or null before one is configured. */
export function appEnvOrNull() {
  return current?.env ?? null;
}

/** The running app's environment. */
export const appEnv = () => runtime().env;
