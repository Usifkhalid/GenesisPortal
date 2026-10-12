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

import { resolveTestDatabaseUrl } from './test-db.js';

/** Repository root, resolved from this file rather than the cwd. */
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The static frontend the backend serves. */
export const FRONTEND_DIR = fileURLToPath(new URL('../../../frontend/', import.meta.url));

// Node reads .env itself (>=21). Absent in hosted environments, where the
// platform supplies real variables, so its absence is not an error.
const envFile = new URL('../../../.env', import.meta.url);
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

    /** Requests per IP per window across /api, and the stricter cap on /api/auth. */
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

    /** mock: seeded fake users, no tenant needed. entra: real Entra ID. */
    AUTH_MODE: z.enum(['mock', 'entra']).default('mock'),

    /** mock: canned Graph responses. real: the live tenant. */
    GRAPH_MODE: z.enum(['mock', 'real']).default('mock'),

    /**
     * Where uploaded files (company logos) are kept by the local storage
     * adapter. Default: <repo>/storage, outside frontend/, so it is never
     * served as a static file. Azure Blob replaces the adapter later.
     */
    STORAGE_DIR: z.string().min(1).optional(),

    /**
     * The mailbox portal email is sent from (Graph sendMail). Nobody reads it:
     * replies are not handled. The real client needs Mail.Send on this mailbox.
     */
    NOREPLY_MAILBOX: z.email().default('no-reply@mgholding.example'),

    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    ENTRA_CLIENT_SECRET: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const require = (key, why) => {
      if (isPlaceholder(value[key])) {
        ctx.addIssue({ code: 'custom', path: [key], message: `required ${why}` });
      }
    };

    // Dev and test boot without a database or a secret; production never does,
    // and never with a mocked identity.
    if (value.NODE_ENV === 'production') {
      require('DATABASE_URL', 'in production');
      require('SESSION_SECRET', 'in production');
      require('APP_BASE_URL', 'in production');
      if (value.AUTH_MODE === 'mock') {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_MODE'],
          message: 'mock sign-in is not allowed in production',
        });
      }
    }

    if (value.AUTH_MODE === 'entra' || value.GRAPH_MODE === 'real') {
      const why = 'when AUTH_MODE=entra or GRAPH_MODE=real';
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
    APP_BASE_URL: (data.APP_BASE_URL ?? `http://localhost:${data.PORT}`).replace(/\/+$/, ''),
    /** False while DATABASE_URL is missing or still the .env.example placeholder. */
    hasDatabase: !isPlaceholder(data.DATABASE_URL),
  });
}

export const env = loadEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
