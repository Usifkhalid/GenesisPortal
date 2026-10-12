import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';

import { env } from '../src/config/env.js';
import { disconnectPrisma, getPrisma } from '../src/lib/prisma.js';
import { zoneWallToUtc } from '../src/lib/sla.js';
import { createMemoryStorage } from '../src/lib/storage.js';
import { createHelpdeskAdminService } from '../src/modules/tickets/admin-service.js';
import { createTicketService } from '../src/modules/tickets/service.js';
import { createPrismaTicketStore } from '../src/modules/tickets/store-prisma.js';

/**
 * The helpdesk over real tables: what tickets.test.js (in memory) cannot
 * show. Above all that concurrent creates, each in its own SQL Server
 * transaction, are never handed the same number. It makes a company, people
 * and a team of its own; the test database is emptied before every run.
 */

const cairo = (ymd, hhmm) =>
  new Date(
    zoneWallToUtc(ymd, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), 'Africa/Cairo')
  );

async function findDatabase() {
  if (!env.hasDatabase) return { reason: 'DATABASE_URL is not configured' };
  try {
    const prisma = await getPrisma();
    await prisma.ticket.count();
    await prisma.ticketSequence.count();
    return { prisma };
  } catch {
    await disconnectPrisma();
    return { reason: 'the database is unreachable or not migrated' };
  }
}

describe('tickets against SQL Server', async () => {
  const { prisma, reason } = await findDatabase();
  const tag = randomUUID().slice(0, 8);
  const code = `T${tag.slice(0, 6)}`.toUpperCase();
  const clock = { now: cairo('2026-10-11', '11:00') };
  const w = {};

  after(async () => {
    await disconnectPrisma();
  });

  const reqOf = (user, roles = []) => ({
    user: { id: user.id, companyId: user.companyId, roles },
    ip: '127.0.0.1',
  });

  async function setUp() {
    const company = await prisma.company.create({
      data: {
        code,
        nameEn: `Tickets test ${tag}`,
        nameAr: `اختبار ${tag}`,
        domain: `${tag}.tickets-test.example`,
        accentColor: '#336699',
      },
    });
    const personOf = (name) =>
      prisma.userProfile.create({
        data: {
          entraObjectId: randomUUID(),
          email: `${name}-${tag}@tickets-test.example`,
          companyId: company.id,
          displayNameEn: `${name} ${tag}`,
          displayNameAr: `${name} ${tag}`,
        },
      });
    const [admin, agent, requester, other] = await Promise.all(
      ['admin', 'agent', 'requester', 'other'].map(personOf)
    );
    const store = createPrismaTicketStore();
    const storage = createMemoryStorage();
    const tickets = createTicketService({ store, storage, now: () => clock.now });
    const helpdesk = createHelpdeskAdminService({ store });
    const adminReq = reqOf(admin, [{ role: 'HoldingAdmin', scopeCompanyId: null }]);

    // Through the admin service, so its writes and audit rows run on SQL Server too.
    const team = await helpdesk.createTeam(adminReq, {
      code,
      nameEn: `Team ${tag}`,
      nameAr: `فريق ${tag}`,
      servesAllCompanies: false,
      companyIds: [company.id],
    });
    await helpdesk.setMember(adminReq, team.id, agent.id, { role: 'Agent' });
    const category = await helpdesk.createCategory(adminReq, {
      teamId: team.id,
      nameEn: `Laptop ${tag}`,
      nameAr: `حاسوب ${tag}`,
      defaultPriority: 'P3',
      sortOrder: 0,
    });
    Object.assign(w, {
      company,
      team,
      category,
      tickets,
      helpdesk,
      storage,
      adminReq,
      agentReq: reqOf(agent),
      requesterReq: reqOf(requester),
      otherReq: reqOf(other),
      agent,
      requester,
    });
  }

  const raise = (req, body = {}) =>
    w.tickets.create(req, {
      subject: 'Laptop will not start',
      description: 'Black screen.',
      categoryId: w.category.id,
      ...body,
    });

  test('forty concurrent creates get forty consecutive numbers', { skip: reason }, async () => {
    await setUp();
    const made = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        raise(i % 2 ? w.requesterReq : w.otherReq, { subject: `Concurrent ${i}` })
      )
    );
    const numbers = made.map((d) => d.ticket.number).sort();
    assert.equal(new Set(numbers).size, 40, 'no number given twice');
    assert.equal(numbers[0], `${code}-2026-00001`);
    assert.equal(numbers[39], `${code}-2026-00040`);

    const rows = await prisma.ticket.findMany({ where: { teamId: w.team.id } });
    assert.equal(rows.length, 40);
    const sequence = await prisma.ticketSequence.findUnique({
      where: { prefix_year: { prefix: code, year: 2026 } },
    });
    assert.equal(sequence.last, 40);
    // One "created" event each, written in the same transaction as the ticket.
    const events = await prisma.ticketEvent.count({
      where: { ticketId: { in: rows.map((r) => r.id) }, type: 'created' },
    });
    assert.equal(events, 40);

    // The audit rows of the set-up are on the table, holding-wide.
    const audit = await prisma.auditLog.findMany({
      where: { actorId: w.adminReq.user.id },
      orderBy: { at: 'asc' },
    });
    assert.deepEqual(
      audit.map((a) => a.action),
      ['helpdesk.team.create', 'helpdesk.member.add', 'helpdesk.category.create']
    );
    assert.ok(audit.every((a) => a.companyId === null));
  });

  test(
    'scope, filters, order, pause and the closing job read the same on SQL Server',
    { skip: reason },
    async () => {
      const mine = await w.tickets.listMine(w.requesterReq, {
        status: 'active',
        page: 1,
        pageSize: 100,
      });
      assert.equal(mine.total, 20);
      assert.ok(mine.items.every((t) => t.mine));
      const found = await w.tickets.listMine(w.requesterReq, {
        status: 'all',
        q: 'concurrent 3',
        page: 1,
        pageSize: 100,
      });
      // "Concurrent 3", and 31 to 39 of which the odd ones are this requester's.
      assert.deepEqual(found.items.map((t) => t.subject).sort(), [
        'Concurrent 3',
        'Concurrent 31',
        'Concurrent 33',
        'Concurrent 35',
        'Concurrent 37',
        'Concurrent 39',
      ]);

      // The other requester cannot open one of them; the agent can.
      const one = mine.items[0];
      await assert.rejects(w.tickets.get(w.otherReq, one.id), { status: 404 });
      assert.deepEqual(await w.tickets.counts(w.otherReq), { mine: 20, queue: null });
      assert.equal((await w.tickets.get(w.agentReq, one.id)).ticket.can.manage, true);

      // Urgent goes to the top of the queue: nearest due date first.
      const urgent = await raise(w.agentReq, {
        requesterId: w.requester.id,
        priority: 'P1',
        subject: 'Server room alarm',
      });
      const page = { page: 1, pageSize: 5, status: 'active' };
      const queue = await w.tickets.queue(w.agentReq, page);
      assert.equal(queue.total, 41);
      assert.equal(queue.items[0].id, urgent.ticket.id);

      // Paused: last in the queue, out of the SLA filters.
      clock.now = cairo('2026-10-11', '11:30');
      await w.tickets.update(w.agentReq, urgent.ticket.id, { status: 'WaitingOnRequester' });
      clock.now = cairo('2026-10-11', '13:00');
      const paused = await w.tickets.queue(w.agentReq, { ...page, sla: 'breached' });
      assert.ok(!paused.items.some((t) => t.id === urgent.ticket.id));
      const resumed = await w.tickets.comment(w.requesterReq, urgent.ticket.id, {
        body: 'It stopped.',
        isInternal: false,
      });
      assert.equal(resumed.ticket.status, 'Open');
      assert.equal(resumed.ticket.sla.pausedMinutes, 90);
      assert.deepEqual(
        resumed.timeline.map((e) => e.type),
        ['created', 'status', 'comment', 'status']
      );
      assert.deepEqual(await w.tickets.counts(w.agentReq), {
        mine: 0,
        queue: { unassigned: 41, breachingSoon: 0, assignedToMe: 0 },
      });

      // An attachment row and its bytes; then resolve and let the job close it.
      const file = await w.tickets.addAttachment(
        w.requesterReq,
        urgent.ticket.id,
        { name: 'alarm.log' },
        Buffer.from('ALARM 13:02\n')
      );
      const read = await w.tickets.readAttachment(w.agentReq, urgent.ticket.id, file.id);
      assert.equal(read.buffer.toString(), 'ALARM 13:02\n');
      await assert.rejects(w.tickets.readAttachment(w.otherReq, urgent.ticket.id, file.id), {
        status: 404,
      });

      clock.now = cairo('2026-10-11', '13:30');
      const late = await w.tickets.counts(w.agentReq);
      assert.equal(late.queue.breachingSoon, 1, 'due at 13:30 after the 90-minute pause');
      await w.tickets.update(w.agentReq, urgent.ticket.id, { status: 'Resolved' });
      assert.equal(await w.tickets.closeResolved(), 0);
      clock.now = cairo('2026-10-14', '13:30');
      assert.equal(await w.tickets.closeResolved(), 1);
      const closed = await w.tickets.get(w.requesterReq, urgent.ticket.id);
      assert.equal(closed.ticket.status, 'Closed');
      assert.equal(closed.timeline.at(-1).type, 'autoClosed');
      assert.equal(closed.timeline.at(-1).actor, null);
    }
  );
});
