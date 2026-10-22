import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import { env } from '../src/config/env.js';
import { disconnectPrisma, getPrisma } from '@mg/shared/server/lib/prisma.js';
import { PrismaSessionStore } from '@mg/shared/server/lib/session.js';

/**
 * PrismaSessionStore against a real Session table. The in-memory version of
 * these checks is in auth.test.js; this one exists for what only SQL Server
 * shows: many people arriving at once. Every row written here is removed.
 */

async function findDatabase() {
  if (!env.hasDatabase) return { reason: 'DATABASE_URL is not configured' };
  try {
    const prisma = await getPrisma();
    await prisma.session.count();
    return { prisma };
  } catch {
    await disconnectPrisma();
    return { reason: 'the database is unreachable or not migrated' };
  }
}

describe('PrismaSessionStore against SQL Server', async () => {
  const { prisma, reason } = await findDatabase();
  const store = new PrismaSessionStore();
  const prefix = `test-${randomUUID()}`;

  after(async () => {
    await prisma?.session.deleteMany({ where: { sid: { startsWith: prefix } } });
    await disconnectPrisma();
  });

  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      store[method](...args, (err, value) => (err ? reject(err) : resolve(value)));
    });

  const session = (userId) => ({
    cookie: { expires: new Date(Date.now() + 3_600_000).toISOString() },
    userId,
  });

  test('stores, reads back, changes and ends a session', { skip: reason }, async () => {
    const sid = `${prefix}-one`;

    const fresh = session(null);
    await call('set', sid, fresh);
    assert.deepEqual(await call('get', sid), fresh);

    const userId = randomUUID();
    await call('set', sid, { ...session(userId), csrfToken: 't' });
    assert.equal((await call('get', sid)).userId, userId);
    assert.equal((await prisma.session.findUnique({ where: { sid } })).userId, userId);

    await call('destroy', sid);
    assert.equal(await call('get', sid), null);
  });

  test('sixty sessions starting at once all get a row', { skip: reason }, async () => {
    const sids = Array.from({ length: 60 }, (_, i) => `${prefix}-many-${i}`);

    await Promise.all(sids.map((sid) => call('set', sid, session(null))));

    assert.equal(await prisma.session.count({ where: { sid: { in: sids } } }), 60);
  });

  test('the same new session saved twice at once is one row', { skip: reason }, async () => {
    const sid = `${prefix}-twice`;

    await Promise.all(Array.from({ length: 8 }, () => call('set', sid, session(null))));

    assert.equal(await prisma.session.count({ where: { sid } }), 1);
  });
});
