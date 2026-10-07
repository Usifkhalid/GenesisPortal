/**
 * prisma.js — one PrismaClient for the process.
 *
 * Imported lazily so that nothing in the request path depends on a generated
 * client until a module actually queries the database; `npm run dev` and the
 * health check work on a clean checkout, before `npm run db:migrate` has run.
 *
 * Reads and writes still go through lib/scope.js once business tables exist:
 * this module only owns the connection.
 */

/** @type {import('@prisma/client').PrismaClient | undefined} */
let client;

/** @returns {Promise<import('@prisma/client').PrismaClient>} */
export async function getPrisma() {
  if (!client) {
    const { PrismaClient } = await import('@prisma/client');
    client = new PrismaClient();
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
