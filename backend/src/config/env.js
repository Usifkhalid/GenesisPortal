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

/** Repository root, resolved from this file rather than the cwd. */
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The static frontend the backend serves. */
export const FRONTEND_DIR = fileURLToPath(new URL('../../../frontend/', import.meta.url));

// Node reads .env itself (>=21). Absent in hosted environments, where the
// platform supplies real variables, so its absence is not an error.
const envFile = new URL('../../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(fileURLToPath(envFile));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** SQL Server connection string. Prisma reads this too, from .env. */
  DATABASE_URL: z.string().min(1).optional(),

  /** Signs the server-side session cookie. Required once sign-in exists. */
  SESSION_SECRET: z.string().min(16).optional(),

  /** mock: seeded fake users, no tenant needed. entra: real Entra ID. */
  AUTH_MODE: z.enum(['mock', 'entra']).default('mock'),

  /** mock: canned Graph responses. real: the live tenant. */
  GRAPH_MODE: z.enum(['mock', 'real']).default('mock'),

  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment:\n${lines.join('\n')}\n\nSee .env.example.`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
