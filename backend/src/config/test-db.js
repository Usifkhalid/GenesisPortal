/**
 * test-db.js — which database tests run against.
 *
 * Tests and the e2e server never touch the development database: they use
 * DATABASE_URL_TEST, or, when that is absent, DATABASE_URL with the database
 * name replaced by `<name>_test`. The result must differ from DATABASE_URL and
 * end in `_test`, so a typo cannot point a test run (which cleans every table)
 * at real data.
 *
 * Pure string work, no I/O: env.js, playwright.config.js and the prepare and
 * reset scripts all share it.
 */

const DATABASE_PART = /(^|;)(\s*database\s*=\s*)([^;]*)/i;

/** The database name inside a sqlserver:// connection string, or null. */
export function databaseName(url) {
  const match = typeof url === 'string' ? DATABASE_PART.exec(url) : null;
  return match ? match[3].trim() : null;
}

/** The same connection string pointed at another database. */
export function withDatabase(url, name) {
  return url.replace(DATABASE_PART, (_all, lead, key) => `${lead}${key}${name}`);
}

/**
 * @param {{ DATABASE_URL?: string, DATABASE_URL_TEST?: string }} source
 * @returns {string | null}  null when there is no database configured at all
 */
export function resolveTestDatabaseUrl({ DATABASE_URL, DATABASE_URL_TEST }) {
  if (!DATABASE_URL && !DATABASE_URL_TEST) return null;

  const dev = databaseName(DATABASE_URL);
  let url = DATABASE_URL_TEST;
  if (!url) {
    if (!dev) return null;
    url = withDatabase(DATABASE_URL, `${dev}_test`);
  }

  const name = databaseName(url);
  if (!name || !/_test$/i.test(name)) {
    throw new Error('DATABASE_URL_TEST must name a database ending in "_test".');
  }
  if (dev && name.toLowerCase() === dev.toLowerCase()) {
    throw new Error('DATABASE_URL_TEST must not be the development database.');
  }
  return url;
}
