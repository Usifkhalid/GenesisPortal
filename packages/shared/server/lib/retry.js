/**
 * retry.js — running a database transaction again when SQL Server chose it as
 * a deadlock's victim. Prisma reports that as P2034; the victim's work was
 * rolled back whole, so running it again is safe, and a few short, jittered
 * tries absorb two people saving at once.
 */

/** Prisma's code for a transaction that lost a deadlock or a write conflict. */
const WRITE_CONFLICT = 'P2034';

/**
 * @template T
 * @param {() => Promise<T>} run
 * @param {{ attempts?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withWriteRetry(run, { attempts = 6 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      if (err?.code !== WRITE_CONFLICT || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.random() * 120));
    }
  }
}
