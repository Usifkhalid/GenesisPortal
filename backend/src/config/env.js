/**
 * env.js — the one place that reads process.env.
 *
 * Everything else imports `env` from here, so a missing or malformed variable
 * fails once, at boot, with a message naming the variable — never halfway
 * through a request. Secrets live only in .env; .env.example lists the keys
 * with placeholder values.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { liveDatabaseUrl, resolveTestDatabaseUrl } from './test-db.js';

/** Repository root, resolved from this file rather than the cwd. */
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The static frontend the backend serves. */
export const FRONTEND_DIR = fileURLToPath(new URL('../../../frontend/', import.meta.url));

// Node reads .env itself (>=21). Absent in hosted environments, where the
// platform supplies real variables, so its absence is not an error.
const envFile = new URL('../../../.env', import.meta.url);
// Under `npm test` (its pretest database step too) and `node --test` the mocks
// are used whatever .env says for trying the real tenant (loadEnvFile never
// overrides a variable already set). A test that wants Entra or real Graph
// passes its own config to createApp.
const underTest =
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  ['test', 'pretest'].includes(process.env.npm_lifecycle_event ?? '');
if (underTest) {
  process.env.AUTH_MODE ??= 'mock';
  process.env.GRAPH_MODE ??= 'mock';
  process.env.GRAPH_DIRECTORY_MODE ??= 'mock';
  process.env.PORTAL_DATA ??= 'demo';
}
if (existsSync(envFile)) process.loadEnvFile(fileURLToPath(envFile));

// `node --test` marks its child processes; treating them as NODE_ENV=test keeps
// `npm test` free of a cross-platform env-setting dependency.
if (!process.env.NODE_ENV && process.env.NODE_TEST_CONTEXT) process.env.NODE_ENV = 'test';

// Under test the database is the test one, whatever .env says: Prisma reads
// DATABASE_URL from the process environment, so this is the one switch that
// keeps every test off the development data (see config/test-db.js).
// The e2e server asks for the same switch with USE_TEST_DATABASE=1: it runs as
// NODE_ENV=development (mock sign-in), and handing it a ready-made test URL as
// DATABASE_URL made the prepare script derive "<name>_test_test" and empty a
// database the server was not using (docs/DECISIONS.md D84).
const wantsTestDatabase =
  process.env.NODE_ENV === 'test' ||
  (process.env.USE_TEST_DATABASE === '1' && process.env.NODE_ENV !== 'production');
if (wantsTestDatabase && process.env.TEST_DATABASE_ACTIVE !== '1') {
  const testUrl = resolveTestDatabaseUrl(process.env);
  if (testUrl) {
    process.env.DATABASE_URL = testUrl;
    // Says DATABASE_URL already is the test database, to this process and to
    // any it starts, so that nothing derives a test name from it a second time.
    process.env.TEST_DATABASE_ACTIVE = '1';
  }
}

// PORTAL_DATA=live on a developer's machine: the same server, the database
// "<name>_live" (mgportal_live), holding only what the real tenant put there.
// demo keeps DATABASE_URL as written (fake people, demo content). Tests never
// switch: their database is derived above from the demo name. In production
// DATABASE_URL is the real database and is used as given (D139).
if (
  !wantsTestDatabase &&
  process.env.PORTAL_DATA === 'live' &&
  (process.env.NODE_ENV ?? 'development') === 'development' &&
  process.env.DATABASE_URL
) {
  process.env.DATABASE_URL = liveDatabaseUrl(process.env.DATABASE_URL);
}

/**
 * "a@x.eg, B@y.eg" → ['a@x.eg', 'b@y.eg']. Also takes an array, which is what
 * a test's config override may hold.
 * @param {string | string[] | undefined} value
 */
export function parseEmailList(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(',');
  return items.map((email) => email.trim().toLowerCase()).filter(Boolean);
}

/** True for a value still carrying a .env.example placeholder. */
const isPlaceholder = (value) => !value || value.includes('CHANGE_ME');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    /** pino level. Defaults to silent under test, info in production, debug in dev. */
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .optional(),

    /** SQL Server connection string. Prisma reads this too, from .env. */
    DATABASE_URL: z.string().min(1).optional(),

    /**
     * The database tests and e2e use. Absent: DATABASE_URL with `_test` added
     * to the database name. Must end in `_test`.
     */
    DATABASE_URL_TEST: z.string().min(1).optional(),

    /**
     * Signs the server-side session cookie. Without one (dev and test only) a
     * random secret is made at boot, so sessions end when the process does.
     */
    SESSION_SECRET: z.string().min(16).optional(),

    /**
     * The portal's own public origin, e.g. https://portal.mgholding.example.
     * Entra redirect URIs are built from it, never from the Host header.
     */
    APP_BASE_URL: z.url().optional(),

    /** The secret before the last rotation: its cookies stay valid, new ones use SESSION_SECRET. */
    SESSION_SECRET_PREVIOUS: z.string().min(16).optional(),

    /** A session unused for this long is gone. */
    SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(480),
    /** A session ends this long after sign-in, however active it is. */
    SESSION_ABSOLUTE_HOURS: z.coerce.number().positive().default(12),

    /**
     * How many reverse proxies stand between the internet and this process.
     * Azure App Service is one. The client address is read that many entries
     * from the end of X-Forwarded-For; anything further left is the client's
     * own claim and is ignored. 0: no proxy, the socket address is the client.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

    /** Requests per client address per window across /api. */
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    /**
     * Sign-in attempts per window: a low cap per account, and a much higher
     * ceiling per client address, because all of HQ leaves through one public
     * address (middleware/rate-limit.js).
     */
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
    AUTH_ACCOUNT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    /** mock: seeded fake users, no tenant needed. entra: real Entra ID. */
    AUTH_MODE: z.enum(['mock', 'entra']).default('mock'),

    /**
     * on: the browser installs the offline service worker (frontend/sw.js).
     * Default: on in production, off in development, where a worker that
     * serves files from its cache would hide every edit.
     */
    SERVICE_WORKER: z.enum(['on', 'off']).optional(),

    /**
     * on: text files of the frontend are compressed once at Brotli's best
     * level and served from memory (lib/precompressed-static.js). Default: on
     * in production, off in development, where files change under the server.
     */
    STATIC_PRECOMPRESS: z.enum(['on', 'off']).optional(),

    /** mock: canned Graph responses. real: the live tenant. */
    GRAPH_MODE: z.enum(['mock', 'real']).default('mock'),

    /**
     * Users and managers only (the directory sync), apart from mail, calendar
     * and rooms. real: the tenant's directory with the application's own
     * token (client credentials, User.Read.All). Absent: follows GRAPH_MODE.
     */
    GRAPH_DIRECTORY_MODE: z.enum(['mock', 'real']).optional(),

    /**
     * Which data a developer's machine works on. demo: DATABASE_URL as written,
     * with seeded fake people and demo content. live: the database of the same
     * name plus "_live", filled only from the real tenant; it needs the real
     * directory and Entra sign-in, so fake and real people never mix (D139).
     * Absent: demo, except in production, which has only real data.
     */
    PORTAL_DATA: z.enum(['demo', 'live']).optional(),

    /**
     * Where uploaded files (company logos) are kept by the local storage
     * adapter. Default: <repo>/storage, outside frontend/, so it is never
     * served as a static file. Azure Blob replaces the adapter later.
     */
    STORAGE_DIR: z.string().min(1).optional(),

    /**
     * local: the folder above. azure: a private Azure Blob container, reached
     * only by this app (lib/storage-azure.js). Production must use azure.
     */
    STORAGE_DRIVER: z.enum(['local', 'azure']).default('local'),
    /** https://<account>.blob.core.windows.net, reached with the app's managed identity. */
    AZURE_STORAGE_ACCOUNT_URL: z.url().optional(),
    AZURE_STORAGE_CONTAINER: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,62}$/)
      .default('portal-files'),
    /** Instead of the account URL and managed identity: a connection string (Azurite). */
    AZURE_STORAGE_CONNECTION_STRING: z.string().min(1).optional(),

    /**
     * Who says an uploaded file is clean (lib/file-scan.js). mock: a local
     * stand-in that passes everything but the EICAR test file. defender:
     * Microsoft Defender for Storage, read from the blob's scan-result tag.
     */
    SCAN_MODE: z.enum(['mock', 'defender']).default('mock'),

    /** Application Insights. Absent: no telemetry is collected or sent. */
    APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().min(1).optional(),

    /** How long a stopping process waits for requests in flight before it exits. */
    SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(10_000),

    /** Set by Azure App Service. Read only to notice a missing NODE_ENV there. */
    WEBSITE_SITE_NAME: z.string().optional(),

    /**
     * The mailbox portal email is sent from (Graph sendMail). Nobody reads it:
     * replies are not handled. The real client needs Mail.Send on this mailbox.
     */
    NOREPLY_MAILBOX: z.email().default('no-reply@mgholding.example'),

    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    ENTRA_CLIENT_SECRET: z.string().optional(),

    /**
     * Comma-separated emails made HoldingAdmin at their Entra sign-in, but only
     * while no active HoldingAdmin with a real Entra account exists: the way in
     * for the first administrator, closed once there is one (D136).
     */
    INITIAL_HOLDING_ADMINS: z
      .string()
      .optional()
      .transform((value) => parseEmailList(value))
      .pipe(z.array(z.email())),
  })
  .superRefine((value, ctx) => {
    const require = (key, why) => {
      if (isPlaceholder(value[key])) {
        ctx.addIssue({ code: 'custom', path: [key], message: `required ${why}` });
      }
    };

    const refuse = (key, message) => ctx.addIssue({ code: 'custom', path: [key], message });

    // On App Service a forgotten NODE_ENV would mean development: mock sign-in
    // open to the internet. Say so instead of starting.
    if (value.WEBSITE_SITE_NAME && value.NODE_ENV !== 'production') {
      refuse('NODE_ENV', 'must be "production" on Azure App Service');
    }

    // Dev and test boot without a database or a secret; production never does,
    // and never with anything mocked.
    if (value.NODE_ENV === 'production') {
      require('DATABASE_URL', 'in production');
      require('SESSION_SECRET', 'in production');
      require('APP_BASE_URL', 'in production');
      if ((value.SESSION_SECRET ?? '').length < 32) {
        refuse('SESSION_SECRET', 'must be at least 32 characters in production');
      }
      if (value.SESSION_SECRET_PREVIOUS?.includes('CHANGE_ME')) {
        refuse('SESSION_SECRET_PREVIOUS', 'is still a placeholder');
      }
      if (value.APP_BASE_URL && !value.APP_BASE_URL.startsWith('https://')) {
        refuse('APP_BASE_URL', 'must be an https:// address in production');
      }
      if (value.AUTH_MODE === 'mock') {
        refuse('AUTH_MODE', 'mock sign-in is not allowed in production');
      }
      if (value.GRAPH_MODE === 'mock') {
        refuse('GRAPH_MODE', 'mock Graph is not allowed in production');
      }
      if (value.GRAPH_DIRECTORY_MODE === 'mock') {
        refuse('GRAPH_DIRECTORY_MODE', 'mock directory is not allowed in production');
      }
      if (value.PORTAL_DATA === 'demo') {
        refuse('PORTAL_DATA', 'demo data is not allowed in production');
      }
      if (value.STORAGE_DRIVER !== 'azure') {
        refuse('STORAGE_DRIVER', 'must be "azure" in production');
      }
      if (value.SCAN_MODE !== 'defender') {
        refuse('SCAN_MODE', 'must be "defender" in production');
      }
    }

    if (value.STORAGE_DRIVER === 'azure') {
      const hasUrl = !isPlaceholder(value.AZURE_STORAGE_ACCOUNT_URL);
      const hasString = !isPlaceholder(value.AZURE_STORAGE_CONNECTION_STRING);
      if (!hasUrl && !hasString) {
        refuse('AZURE_STORAGE_ACCOUNT_URL', 'required when STORAGE_DRIVER=azure');
      }
    }
    if (value.SCAN_MODE === 'defender' && value.STORAGE_DRIVER !== 'azure') {
      refuse('SCAN_MODE', 'defender needs STORAGE_DRIVER=azure');
    }
    if (value.SESSION_ABSOLUTE_HOURS * 60 < value.SESSION_IDLE_MINUTES) {
      refuse('SESSION_ABSOLUTE_HOURS', 'must not be shorter than SESSION_IDLE_MINUTES');
    }

    const directoryMode = value.GRAPH_DIRECTORY_MODE ?? value.GRAPH_MODE;
    const portalData = value.PORTAL_DATA ?? (value.NODE_ENV === 'production' ? 'live' : 'demo');
    if (portalData === 'live') {
      if (directoryMode !== 'real') {
        refuse('GRAPH_DIRECTORY_MODE', 'must be "real" when PORTAL_DATA=live');
      }
      if (value.AUTH_MODE !== 'entra') {
        refuse(
          'AUTH_MODE',
          'must be "entra" when PORTAL_DATA=live (mock sign-in lists people)'
        );
      }
    } else if (directoryMode === 'real') {
      refuse('GRAPH_DIRECTORY_MODE', 'real people belong in PORTAL_DATA=live, not demo');
    }

    if (
      value.AUTH_MODE === 'entra' ||
      value.GRAPH_MODE === 'real' ||
      directoryMode === 'real'
    ) {
      const why = 'when AUTH_MODE=entra or GRAPH_MODE or GRAPH_DIRECTORY_MODE is real';
      require('ENTRA_TENANT_ID', why);
      require('ENTRA_CLIENT_ID', why);
      require('ENTRA_CLIENT_SECRET', why);
    }
    if (value.GRAPH_MODE === 'real' && value.NOREPLY_MAILBOX.endsWith('.example')) {
      ctx.addIssue({
        code: 'custom',
        path: ['NOREPLY_MAILBOX'],
        message: 'required when GRAPH_MODE=real (still the placeholder)',
      });
    }
  });

/**
 * Validates a set of variables. Exported for tests; the app uses `env`.
 * Error messages name variables and never echo their values.
 * @param {Record<string, string | undefined>} source
 */
export function loadEnv(source) {
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}\n\nSee .env.example.`);
  }

  const data = parsed.data;
  const defaultLevel = { test: 'silent', production: 'info', development: 'debug' };

  return Object.freeze({
    ...data,
    LOG_LEVEL: data.LOG_LEVEL ?? defaultLevel[data.NODE_ENV],
    GRAPH_DIRECTORY_MODE: data.GRAPH_DIRECTORY_MODE ?? data.GRAPH_MODE,
    PORTAL_DATA: data.PORTAL_DATA ?? (data.NODE_ENV === 'production' ? 'live' : 'demo'),
    APP_BASE_URL: (data.APP_BASE_URL ?? `http://localhost:${data.PORT}`).replace(/\/+$/, ''),
    sessionIdleMs: data.SESSION_IDLE_MINUTES * 60_000,
    sessionAbsoluteMs: Math.round(data.SESSION_ABSOLUTE_HOURS * 3_600_000),
    /** False while DATABASE_URL is missing or still the .env.example placeholder. */
    hasDatabase: !isPlaceholder(data.DATABASE_URL),
    /** Whether static text is served precompressed; see STATIC_PRECOMPRESS above. */
    staticPrecompress:
      (data.STATIC_PRECOMPRESS ?? (data.NODE_ENV === 'production' ? 'on' : 'off')) === 'on',
    /** Whether /sw.js serves the offline worker; see SERVICE_WORKER above. */
    serviceWorkerEnabled:
      (data.SERVICE_WORKER ?? (data.NODE_ENV === 'production' ? 'on' : 'off')) === 'on',
  });
}

export const env = loadEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
