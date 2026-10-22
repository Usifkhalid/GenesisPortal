/**
 * The IT Helpdesk on its own SQL Server database (mghelpdesk_test, D144): its
 * schema and migrations, its generated client, and the shared stores over
 * them. The whole app runs here with the Prisma stores: demo people seeded,
 * mock sign-in, a ticket raised, worked and confirmed, notifications and the
 * audit trail written, a company added. Skipped when no database is set up.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import { seed } from '../prisma/seed.js';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { disconnectPrisma, getPrisma } from '@mg/shared/server/lib/prisma.js';
import { createMemoryStorage } from '@mg/shared/server/lib/storage.js';
import { databaseName } from '@mg/shared/server/config/test-db.js';
import { createPrismaUserRepo } from '@mg/shared/server/modules/auth/repo.js';
import { signIn } from '@mg/shared/server/testing/clients.js';

async function findDatabase() {
  if (!env.hasDatabase) return { reason: 'DATABASE_URL is not configured' };
  try {
    const prisma = await getPrisma();
    await prisma.ticket.count();
    return { prisma };
  } catch {
    await disconnectPrisma();
    return { reason: 'the database is unreachable or not migrated' };
  }
}

describe('the helpdesk against SQL Server', async () => {
  const { prisma, reason } = await findDatabase();
  after(async () => {
    await disconnectPrisma();
  });

  test('its own test database, never the portal’s', { skip: reason }, () => {
    assert.match(databaseName(process.env.DATABASE_URL), /_test$/);
    assert.doesNotMatch(databaseName(process.env.DATABASE_URL), /portal/i);
  });

  test(
    'a ticket from raising to the requester’s rating, on the helpdesk’s tables',
    { skip: reason },
    async () => {
      await seed(prisma);
      const app = createApp({
        config: { NODE_ENV: 'development', AUTH_MODE: 'mock' },
        userRepo: createPrismaUserRepo(),
        storage: createMemoryStorage(),
        authRateLimit: { limit: 100_000, accountLimit: 100_000 },
        rateLimit: { limit: 100_000 },
      });
      const person = (email) => prisma.userProfile.findUnique({ where: { email } });
      const salma = await signIn(app, await person('salma.ibrahim@genesismining-eg.com'));
      const omar = await signIn(app, await person('omar.fahmy@mgholding.example'));
      const nadia = await signIn(app, await person('nadia.elsayed@mgholding.example'));

      const category = await prisma.ticketCategory.findFirst({
        where: { nameEn: 'Laptop / PC' },
      });
      const raised = await salma.post('/api/tickets', {
        subject: `Database test ${randomUUID().slice(0, 8)}`,
        description: 'It shows the logo and then a black screen.',
        categoryId: category.id,
      });
      assert.equal(raised.status, 201, JSON.stringify(raised.body));
      const { id } = raised.body.ticket;

      // The lead was told, in the database's Notification table.
      const told = await prisma.notification.findFirst({
        where: { userId: omar.user.id, templateKey: 'ticket.created' },
        orderBy: { createdAt: 'desc' },
      });
      assert.equal(JSON.parse(told.payload).link, `#tickets/${id}`);

      const resolved = await omar.patch(`/api/tickets/${id}`, {
        assigneeId: omar.user.id,
        status: 'Resolved',
      });
      assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
      const solved = await salma.post(`/api/tickets/${id}/solved`, { rating: 5 });
      assert.equal(solved.status, 200, JSON.stringify(solved.body));

      const row = await prisma.ticket.findUnique({ where: { id } });
      assert.equal(row.status, 'Closed');
      assert.equal(row.rating, 5);
      assert.equal(row.closeMode, 'confirmed');

      // The administrator adds a company with its domains; it is audited.
      const code = `Z${randomUUID()
        .slice(0, 4)
        .toUpperCase()
        .replace(/[^A-Z]/g, 'Q')}`;
      const added = await nadia.post('/api/admin/companies', {
        code,
        nameEn: 'Database Co',
        nameAr: 'شركة قاعدة البيانات',
        domains: [`${code.toLowerCase()}.example`, `${code.toLowerCase()}2.example`],
        accentColor: '#1e5aa8',
      });
      assert.equal(added.status, 201, JSON.stringify(added.body));
      const domains = await prisma.companyDomain.count({ where: { companyId: added.body.id } });
      assert.equal(domains, 2);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'company.create', entityId: added.body.id },
      });
      assert.ok(audit, 'audited');
    }
  );

  test('the audit log is append-only in the database itself', { skip: reason }, async () => {
    await assert.rejects(
      () => prisma.$executeRawUnsafe("UPDATE [AuditLog] SET [action] = N'x' WHERE 1 = 0"),
      /append-only/
    );
  });
});
