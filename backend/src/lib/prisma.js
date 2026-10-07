/**
 * prisma.js — one PrismaClient for the process.
 *
 * Imported lazily so that nothing in the request path depends on a generated
 * client until a module actually queries the database; `npm run dev` and the
 * health check work on a clean checkout, before `npm run db:migrate` has run.
 *
 * Reads and writes of business tables go through lib/scope.js: this module
 * only owns the connection, and one invariant — AuditLog is append-only.
 */

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

/** @type {import('@prisma/client').PrismaClient | undefined} */
let client;

/** @returns {Promise<import('@prisma/client').PrismaClient>} */
export async function getPrisma() {
  if (!client) {
    const { PrismaClient } = await import('@prisma/client');
    client = guardAuditLog(new PrismaClient());
  }
  return client;
}

/** Closes the pool. Used by tests and by shutdown. */
export async function disconnectPrisma() {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
