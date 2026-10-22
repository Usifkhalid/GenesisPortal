import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import { env } from '../src/config/env.js';

/**
 * The trigger from migration 20261011000000_audit_log_append_only, proved
 * against a real database. A bare PrismaClient is used on purpose: the shared
 * one (lib/prisma.js) refuses these calls before they reach SQL Server.
 *
 * Nothing is left behind. Each attempt inserts its row in the same transaction
 * as the UPDATE or DELETE, and the trigger's error rolls the whole thing back.
 */

const REFUSED = /AuditLog is append-only/;

/** A migrated database carrying the trigger, or the reason there is none. */
async function findDatabase() {
  if (!env.hasDatabase) return { reason: 'DATABASE_URL is not configured' };

  let prisma;
  try {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    await prisma.auditLog.count();
    return { prisma };
  } catch {
    await prisma?.$disconnect();
    return { reason: 'the database is unreachable or not migrated' };
  }
}

describe('AuditLog trigger against SQL Server', async () => {
  const { prisma, reason } = await findDatabase();
  after(() => prisma?.$disconnect());

  /** A row only this test run could have written. */
  const row = () => ({
    id: randomUUID(),
    action: `test.trigger.${randomUUID()}`,
    entity: 'Test',
  });

  const leftBehind = (action) => prisma.auditLog.count({ where: { action } });

  test('the trigger is installed and enabled', { skip: reason }, async () => {
    const found = await prisma.$queryRaw`
      SELECT t.is_disabled AS disabled, t.is_instead_of_trigger AS insteadOf
      FROM sys.triggers t
      WHERE t.parent_id = OBJECT_ID('dbo.AuditLog') AND t.name = 'AuditLog_append_only'`;

    assert.equal(found.length, 1);
    assert.equal(found[0].disabled, false);
    assert.equal(found[0].insteadOf, true);
  });

  test('INSERT still works', { skip: reason }, async () => {
    const data = row();
    const rollback = new Error('rollback');

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.auditLog.create({ data });
        assert.equal(await tx.auditLog.count({ where: { action: data.action } }), 1);
        throw rollback;
      }),
      rollback
    );
    assert.equal(await leftBehind(data.action), 0);
  });

  test('UPDATE is refused, through Prisma and in plain SQL', { skip: reason }, async () => {
    const viaPrisma = row();
    await assert.rejects(
      prisma.$transaction([
        prisma.auditLog.create({ data: viaPrisma }),
        prisma.auditLog.update({ where: { id: viaPrisma.id }, data: { action: 'tampered' } }),
      ]),
      REFUSED
    );
    assert.equal(await leftBehind(viaPrisma.action), 0);

    const viaSql = row();
    await assert.rejects(
      prisma.$transaction([
        prisma.auditLog.create({ data: viaSql }),
        prisma.$executeRaw`UPDATE [dbo].[AuditLog] SET [action] = 'tampered' WHERE [id] = ${viaSql.id}`,
      ]),
      REFUSED
    );
    assert.equal(await leftBehind(viaSql.action), 0);
  });

  test('DELETE is refused, through Prisma and in plain SQL', { skip: reason }, async () => {
    const viaPrisma = row();
    await assert.rejects(
      prisma.$transaction([
        prisma.auditLog.create({ data: viaPrisma }),
        prisma.auditLog.delete({ where: { id: viaPrisma.id } }),
      ]),
      REFUSED
    );

    const viaSql = row();
    await assert.rejects(
      prisma.$transaction([
        prisma.auditLog.create({ data: viaSql }),
        prisma.$executeRaw`DELETE FROM [dbo].[AuditLog] WHERE [id] = ${viaSql.id}`,
      ]),
      REFUSED
    );
  });

  test('a statement that matches no row is refused too', { skip: reason }, async () => {
    await assert.rejects(
      prisma.$executeRaw`DELETE FROM [dbo].[AuditLog] WHERE [id] = ${randomUUID()}`,
      REFUSED
    );
    await assert.rejects(
      prisma.auditLog.updateMany({ where: { id: randomUUID() }, data: { action: 'tampered' } }),
      REFUSED
    );
  });
});
