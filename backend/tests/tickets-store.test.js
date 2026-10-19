import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
    const [admin, lead, agent, requester, other] = await Promise.all(
      ['admin', 'lead', 'agent', 'requester', 'other'].map(personOf)
    );
    const store = createPrismaTicketStore();
    const storage = createMemoryStorage();
    const tickets = createTicketService({ store, storage, now: () => clock.now });
    const helpdesk = createHelpdeskAdminService({ store });
    const adminReq = reqOf(admin, [{ role: 'HoldingAdmin', scopeCompanyId: null }]);

    const leadReq = reqOf(lead);

    // A team is made by a migration or a seed, not a screen (D135).
    const team = await prisma.supportTeam.create({
      data: {
        code,
        nameEn: `Team ${tag}`,
        nameAr: `فريق ${tag}`,
        servesAllCompanies: false,
        companies: { create: [{ companyId: company.id }] },
      },
    });
    // The rest through the services, so their writes and audit rows run on
    // SQL Server too: the HoldingAdmin staffs the team, its lead configures it.
    await helpdesk.setMember(adminReq, team.id, lead.id, { role: 'Lead' });
    await helpdesk.setMember(adminReq, team.id, agent.id, { role: 'Agent' });
    const category = await helpdesk.createCategory(leadReq, {
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
      leadReq,
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
      where: { actorId: { in: [w.adminReq.user.id, w.leadReq.user.id] } },
      orderBy: { at: 'asc' },
    });
    assert.deepEqual(
      audit.map((a) => [a.action, a.actorId]),
      [
        ['helpdesk.member.add', w.adminReq.user.id],
        ['helpdesk.member.add', w.adminReq.user.id],
        ['helpdesk.category.create', w.leadReq.user.id],
      ]
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

      // Paused: last in the queue, out of the SLA filters. (The lead works it:
      // an agent works only the tickets given to them, D122.)
      clock.now = cairo('2026-10-11', '11:30');
      await w.tickets.update(w.leadReq, urgent.ticket.id, { status: 'Pending' });
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
        queue: { unassigned: 41, breachingSoon: 0, assignedToMe: 0, canAssign: false },
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
      await w.tickets.update(w.leadReq, urgent.ticket.id, { status: 'Resolved' });

      // Resolved stays open however long it waits; only the requester closes it (D143).
      clock.now = cairo('2026-10-25', '13:30');
      await w.tickets.remindResolved();
      const waiting = await w.tickets.get(w.requesterReq, urgent.ticket.id);
      assert.equal(waiting.ticket.status, 'Resolved');
      assert.equal(waiting.ticket.can.confirm, true);
      const row = await prisma.ticket.findUnique({ where: { id: urgent.ticket.id } });
      assert.equal(row.slaActive, true, 'the clock runs while it waits');
      assert.equal(row.slaPausedAt, null);

      // The agent cannot answer for the requester; the requester confirms and rates.
      await assert.rejects(w.tickets.confirm(w.agentReq, urgent.ticket.id, { rating: 5 }), {
        status: 403,
      });
      await assert.rejects(w.tickets.confirm(w.otherReq, urgent.ticket.id, { rating: 5 }), {
        status: 404,
      });
      const closed = await w.tickets.confirm(w.requesterReq, urgent.ticket.id, {
        rating: 4,
        feedback: 'Fixed quickly.',
      });
      assert.equal(closed.ticket.status, 'Closed');
      assert.equal(closed.timeline.at(-1).type, 'confirmed');
      const saved = await prisma.ticket.findUnique({ where: { id: urgent.ticket.id } });
      assert.deepEqual(
        [saved.closeMode, saved.rating, saved.ratingFeedback, saved.slaActive],
        ['confirmed', 4, 'Fixed quickly.', false]
      );
      assert.ok(saved.ratedAt && saved.closedAt);
    }
  );

  test(
    'the migration renames the status, keeps old history readable and restarts a resolved ticket’s clock',
    { skip: reason },
    async () => {
      if (!w.team) await setUp();
      clock.now = cairo('2026-10-11', '11:00');
      const [waiting, resolved, closed] = (
        await Promise.all(
          ['Legacy waiting', 'Legacy resolved', 'Legacy closed'].map((subject) =>
            raise(w.requesterReq, { subject })
          )
        )
      ).map((made) => made.ticket);
      const sunday = cairo('2026-10-11', '11:00');
      const thursday = cairo('2026-10-15', '11:00');
      // How the three looked before D143: waiting on the requester, resolved with the
      // clock stopped, and closed by the old auto-close.
      await prisma.ticket.update({
        where: { id: waiting.id },
        data: { status: 'WaitingOnRequester', slaActive: false, slaPausedAt: sunday },
      });
      await prisma.ticket.update({
        where: { id: resolved.id },
        data: { status: 'Resolved', resolvedAt: sunday, slaActive: false, slaPausedAt: sunday },
      });
      await prisma.ticket.update({
        where: { id: closed.id },
        data: { status: 'Closed', resolvedAt: sunday, closedAt: thursday, slaActive: false },
      });
      const event = (ticketId, type, fromValue, toValue) =>
        prisma.ticketEvent.create({
          data: { ticketId, actorId: w.agent.id, type, fromValue, toValue },
        });
      await event(waiting.id, 'status', 'Open', 'WaitingOnRequester');
      await event(waiting.id, 'status', 'WaitingOnRequester', 'Open');
      await event(closed.id, 'autoClosed', 'Resolved', 'Closed');
      await prisma.notification.create({
        data: {
          userId: w.requester.id,
          companyId: w.company.id,
          channel: 'inApp',
          templateKey: 'ticket.status',
          payload: JSON.stringify({
            link: '#tickets/x',
            vars: { status: { en: 'Waiting on you', ar: 'بانتظار ردّك' } },
          }),
        },
      });

      // The data part of the migration, run twice: the second run changes nothing.
      const sql = readFileSync(
        new URL(
          '../prisma/migrations/20261019010000_ticket_confirmation/migration.sql',
          import.meta.url
        ),
        'utf8'
      );
      const data = sql.slice(sql.indexOf('-- Existing rows.'));
      await prisma.$executeRawUnsafe(data);
      await prisma.$executeRawUnsafe(data);

      const after = await w.tickets.get(w.requesterReq, waiting.id);
      assert.equal(after.ticket.status, 'Pending');
      assert.equal(after.ticket.sla.state, 'paused', 'still paused');
      const history = after.timeline.filter((e) => e.type === 'status');
      assert.deepEqual(
        history.map((e) => [e.from, e.to]),
        [
          ['Open', 'Pending'],
          ['Pending', 'Open'],
        ]
      );
      assert.equal(await prisma.ticket.count({ where: { status: 'WaitingOnRequester' } }), 0);

      const note = await prisma.notification.findFirst({
        where: { userId: w.requester.id, templateKey: 'ticket.status' },
      });
      assert.match(note.payload, /"en":"Pending"/);
      assert.match(note.payload, /"ar":"معلّق"/);

      // Resolved: open again, its clock running, and the requester can answer it.
      const row = await prisma.ticket.findUnique({ where: { id: resolved.id } });
      assert.deepEqual([row.status, row.slaActive, row.slaPausedAt], ['Resolved', true, null]);
      const answered = await w.tickets.confirm(w.requesterReq, resolved.id, { rating: 5 });
      assert.equal(answered.ticket.status, 'Closed');

      // A ticket the old rule closed keeps its history and its result.
      const old = await w.tickets.get(w.requesterReq, closed.id);
      assert.equal(old.ticket.status, 'Closed');
      assert.equal(old.ticket.closeMode, null);
      assert.equal(old.ticket.sla.state, 'met', 'judged by the day it was resolved');
      assert.equal(old.timeline.at(-1).type, 'autoClosed');
    }
  );
});
