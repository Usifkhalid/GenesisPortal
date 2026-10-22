/**
 * source.js — the portal's database, opened for reading only (D145).
 *
 * `npm run migrate:from-portal` is the one place in the helpdesk that reaches
 * the portal's data, through PORTAL_SOURCE_DATABASE_URL. The connection is a
 * client of the helpdesk's own generated Prisma client: the tables it reads
 * (companies, people, the IT team, tickets, notifications, the audit log)
 * carry the same names and columns in both databases (D144). It is wrapped
 * here so that only reads can be asked of it: any create, update, delete,
 * raw query or transaction throws before it reaches SQL Server. A read-only
 * SQL login (db_datareader) on the portal's database is the second lock
 * (README).
 */

const READS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const refuse = (what) => {
  throw new Error(`The portal's database is read-only here: ${what} is not allowed.`);
};

/**
 * @param {object} client  a PrismaClient (or anything with model delegates)
 * @returns {object} the same models, reads only, plus $disconnect
 */
export function readOnly(client) {
  return new Proxy(
    {},
    {
      get(_target, model) {
        // Not a thenable: `await readOnly(x)` must not call a model "then".
        if (model === 'then' || typeof model === 'symbol') return undefined;
        if (model === '$disconnect') return () => client.$disconnect?.();
        if (model.startsWith('$')) refuse(model);
        const delegate = client[model];
        if (!delegate) return undefined;
        return new Proxy(
          {},
          {
            get(_d, operation) {
              if (operation === 'then' || typeof operation === 'symbol') return undefined;
              if (!READS.has(operation)) refuse(`${model}.${operation}`);
              return delegate[operation].bind(delegate);
            },
          }
        );
      },
    }
  );
}

/** A stored-files adapter that can only be read from (lib/storage.js shape). */
export function readOnlyFiles(storage) {
  return Object.freeze({ get: (key) => storage.get(key) });
}
