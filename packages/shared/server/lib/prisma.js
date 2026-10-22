/**
 * prisma.js — one PrismaClient for the process: the running app's own,
 * generated from its schema (apps/<app>/backend/prisma/schema.prisma) and
 * named by its config/env.js (config/runtime.js `prismaClient`).
 *
 * Imported lazily so that nothing in the request path depends on a generated
 * client until a module actually queries the database; `npm run dev` and the
 * health check work on a clean checkout, before `npm run db:migrate` has run.
 *
 * Reads and writes of business tables go through lib/scope.js: this module
 * only owns the connection, and one invariant — AuditLog is append-only.
 */

import { runtime } from '../config/runtime.js';

const AUDIT_WRITES_REFUSED = ['update', 'updateMany', 'upsert', 'delete', 'deleteMany'];

/**
 * Makes AuditLog append-only for every caller, transactions included.
 * Exported for tests.
 * @param {import('@prisma/client').PrismaClient} base
 */
export function guardAuditLog(base) {
  const refuse = (operation) => () => {
    throw new Error(`AuditLog is append-only: ${operation} is not allowed.`);
  };

  return base.$extends({
    name: 'audit-log-append-only',
    query: {
      auditLog: Object.fromEntries(AUDIT_WRITES_REFUSED.map((op) => [op, refuse(op)])),
    },
  });
}

/**
 * The promise is what is kept, not the client: several first requests arriving
 * together must share one client (one engine, one pool), not each make one.
 * @type {Promise<import('@prisma/client').PrismaClient> | undefined}
 */
let client;

/** @returns {Promise<import('@prisma/client').PrismaClient>} */
export function getPrisma() {
  client ??= runtime()
    .prismaClient()
    .then((PrismaClient) => guardAuditLog(new PrismaClient()));
  return client;
}

/** How many pooled connections a start opens before the port does. */
const WARM_CONNECTIONS = 8;

/**
 * Starts the engine, opens the first connections and runs one small query, so
 * the first person after a start (or an App Service cold start) does not wait
 * for all three. Resolves false when the database could not be reached: the
 * process still starts, and each request then fails in the usual way.
 *
 * @param {{ warn: Function }} [log]
 */
export async function warmPrisma(log) {
  try {
    const prisma = await getPrisma();
    await prisma.$connect();
    // A connection is opened when a query finds none free, and each takes most
    // of a second against SQL Server: open a few now, together.
    await Promise.all(
      Array.from({ length: WARM_CONNECTIONS }, () =>
        prisma.company.findFirst({ select: { id: true } })
      )
    );
    return true;
  } catch (err) {
    log?.warn({ err }, 'the database was not reachable at start');
    return false;
  }
}

/** Closes the pool. Used by tests and by shutdown. */
export async function disconnectPrisma() {
  if (client) {
    const open = await client;
    client = undefined;
    await open.$disconnect();
  }
}
