import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import { createMemoryOutbox } from '@mg/shared/server/integrations/graph/mock-mail.js';
import { env } from '../src/config/env.js';
import { createNotifier } from '@mg/shared/server/lib/notify.js';
import { disconnectPrisma, getPrisma } from '@mg/shared/server/lib/prisma.js';
import { createNotificationService } from '@mg/shared/server/modules/notifications/service.js';
import { createPrismaNotificationStore } from '@mg/shared/server/modules/notifications/store-prisma.js';

/**
 * Notifications over real tables: what notifications.test.js (in memory)
 * cannot show: the unique switch per person, category and channel, the
 * dedupe lookup, and mark-read touching only one person's rows. It makes a
 * company and people of its own; the test database is emptied before every run.
 */

async function findDatabase() {
  if (!env.hasDatabase) return { reason: 'DATABASE_URL is not configured' };
  try {
    const prisma = await getPrisma();
    await prisma.notificationPreference.count();
    return { prisma };
  } catch {
    await disconnectPrisma();
    return { reason: 'the database is unreachable or not migrated' };
  }
}

describe('notifications against SQL Server', async () => {
  const { prisma, reason } = await findDatabase();
  const tag = randomUUID().slice(0, 8);

  after(async () => {
    await disconnectPrisma();
  });

  async function setUp() {
    const company = await prisma.company.create({
      data: {
        code: `N${tag.slice(0, 6)}`.toUpperCase(),
        nameEn: `Notify test ${tag}`,
        nameAr: `اختبار ${tag}`,
        domain: `${tag}.notify-test.example`,
        accentColor: '#336699',
      },
    });
    const personOf = (name, language = 'en') =>
      prisma.userProfile.create({
        data: {
          entraObjectId: randomUUID(),
          email: `${name}-${tag}@notify-test.example`,
          companyId: company.id,
          displayNameEn: `${name} ${tag}`,
          displayNameAr: `${name} ${tag}`,
          language,
        },
      });
    const [ann, bob] = await Promise.all([personOf('ann', 'ar'), personOf('bob')]);
    const store = createPrismaNotificationStore();
    const outbox = createMemoryOutbox();
    const notify = createNotifier({
      store,
      getGraph: async () => ({ sendMail: (mail) => outbox.add(mail) }),
      config: {
        NOREPLY_MAILBOX: 'no-reply@notify-test.example',
        APP_BASE_URL: env.APP_BASE_URL,
      },
    });
    const service = createNotificationService({ store });
    const reqOf = (user) => ({ user: { id: user.id, companyId: user.companyId, roles: [] } });
    return { company, ann, bob, store, outbox, notify, service, reqOf };
  }

  test(
    'rows, dedupe, switches and mark-read behave in the database',
    { skip: reason },
    async () => {
      const w = await setUp();
      const data = { link: '#tickets/x', number: 'IT-1', subject: 'S', phase: 'p' };

      const sent = await w.notify([w.ann.id, w.bob.id], 'ticket.slaAtRisk', {
        ...data,
        dedupeKey: `sla:${tag}:1`,
      });
      assert.deepEqual(sent, { inApp: 2, email: 2 });
      assert.deepEqual(
        await w.notify([w.ann.id, w.bob.id], 'ticket.slaAtRisk', {
          ...data,
          dedupeKey: `sla:${tag}:1`,
        }),
        { inApp: 0, email: 0 }
      );
      const mails = await w.outbox.list();
      assert.equal(mails.length, 2);
      assert.ok(mails.find((m) => m.to[0] === w.ann.email).html.includes('dir="rtl"'));

      // A switch is one row per person, category and channel, however often saved.
      const annReq = w.reqOf(w.ann);
      await w.service.setPreferences(annReq, [
        { category: 'tickets', channel: 'email', enabled: false },
      ]);
      await w.service.setPreferences(annReq, [
        { category: 'tickets', channel: 'email', enabled: false },
        { category: 'tickets', channel: 'inApp', enabled: true },
      ]);
      assert.equal(
        await prisma.notificationPreference.count({ where: { userId: w.ann.id } }),
        2
      );
      const prefs = await w.service.preferences(annReq);
      assert.equal(
        prefs.items.find((i) => i.category === 'tickets' && i.channel === 'email').enabled,
        false
      );

      await w.notify([w.ann.id], 'ticket.created', { number: 'IT-2', subject: 'Two' });
      assert.equal((await w.outbox.list()).length, 2, 'no new email for ann');

      // Listing is one's own; marking read cannot reach another person's row.
      const annList = await w.service.list(annReq, { unread: false, page: 1, pageSize: 10 });
      assert.equal(annList.total, 2);
      assert.equal(annList.unread, 2);
      const bobRows = await prisma.notification.findMany({
        where: { userId: w.bob.id, channel: 'inApp' },
      });
      const poke = await w.service.markRead(annReq, [bobRows[0].id]);
      assert.equal(poke.marked, 0);
      const mine = await w.service.markRead(annReq, [annList.items[0].id]);
      assert.deepEqual(mine, { marked: 1, unread: 1 });
      assert.deepEqual(await w.service.markAllRead(annReq), { marked: 1, unread: 0 });
      assert.equal(
        await prisma.notification.count({
          where: { userId: w.bob.id, channel: 'inApp', readAt: null },
        }),
        1
      );
    }
  );
});
