import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { HOLIDAYS, SUPPORT_TEAMS, TICKET_LOCATIONS } from '../prisma/seed-data.js';
import { createAdminService } from '../src/modules/admin/service.js';
import { ensureHelpdeskDefaults, LIVE_TEAM } from '../src/modules/tickets/defaults.js';
import {
  parseEmails,
  parseTeamArgs,
  setItMembers,
} from '../src/modules/tickets/team-members.js';
import { createFakePrisma } from './helpers/fake-prisma.js';

const [IT] = SUPPORT_TEAMS;

const counts = (db) => ({
  teams: db.supportTeam.rows.length,
  calendars: db.businessCalendar.rows.length,
  sla: db.slaPolicy.rows.length,
  categories: db.ticketCategory.rows.length,
  replies: db.cannedReply.rows.length,
  locations: db.ticketLocation.rows.length,
  holidays: db.holiday.rows.length,
});

async function liveLikeDb() {
  const db = createFakePrisma();
  for (const code of ['GEN', 'HLD', 'MSR']) {
    await db.company.create({ data: { code, domain: `${code}.test`, isActive: true } });
  }
  return db;
}

describe('ensureHelpdeskDefaults', () => {
  test('creates the IT team and its reference data, no people, no tickets', async () => {
    const db = await liveLikeDb();
    const { created } = await ensureHelpdeskDefaults(db);

    const [team] = db.supportTeam.rows;
    assert.equal(team.code, 'IT');
    assert.equal(team.nameEn, LIVE_TEAM.nameEn);
    assert.equal(team.nameAr, 'الدعم الفني');
    assert.equal(team.servesAllCompanies, true);
    assert.deepEqual(counts(db), {
      teams: 1,
      calendars: 1,
      sla: IT.sla.length,
      categories: IT.categories.length,
      replies: IT.cannedReplies.length,
      locations: TICKET_LOCATIONS.length,
      holidays: HOLIDAYS.length,
    });
    assert.equal(db.supportTeamMember.rows.length, 0);
    assert.equal(db.userProfile.rows.length, 0);
    assert.equal(created.team, 1);
    assert.equal(
      db.supportTeamCompany.rows.length,
      0,
      'a team serving all needs no company rows'
    );

    const [audit] = db.auditLog.rows;
    assert.equal(audit.action, 'helpdesk.defaults.create');
    assert.equal(audit.companyId, null);
  });

  test('a second run adds nothing and writes no audit row', async () => {
    const db = await liveLikeDb();
    await ensureHelpdeskDefaults(db);
    const before = counts(db);
    const { created } = await ensureHelpdeskDefaults(db);

    assert.deepEqual(counts(db), before);
    assert.ok(Object.values(created).every((n) => n === 0));
    assert.equal(db.auditLog.rows.length, 1);
  });

  test('keeps an administrator’s edits and fills only what is missing', async () => {
    const db = await liveLikeDb();
    const { teamId } = await ensureHelpdeskDefaults(db);
    db.supportTeam.rows[0].nameEn = 'Service Desk';
    db.slaPolicy.rows.find((p) => p.priority === 'P1').resolveMinutes = 1;
    db.ticketCategory.rows.pop();

    const { created } = await ensureHelpdeskDefaults(db);
    assert.equal(db.supportTeam.rows[0].nameEn, 'Service Desk');
    assert.equal(db.slaPolicy.rows.find((p) => p.priority === 'P1').resolveMinutes, 1);
    assert.equal(db.ticketCategory.rows.length, IT.categories.length);
    assert.equal(created.categories, 1);
    assert.equal(db.supportTeam.rows[0].id, teamId);
  });

  test('a team narrowed to chosen companies serves every active company', async () => {
    const db = await liveLikeDb();
    const { teamId } = await ensureHelpdeskDefaults(db);
    db.supportTeam.rows[0].servesAllCompanies = false;
    await db.company.create({ data: { code: 'OLD', domain: 'old.test', isActive: false } });

    await ensureHelpdeskDefaults(db);
    assert.equal(db.supportTeamCompany.rows.length, 3);
    // A company added later is picked up by the next run, never duplicated.
    await db.company.create({ data: { code: 'NEW', domain: 'new.test', isActive: true } });
    await ensureHelpdeskDefaults(db);
    await ensureHelpdeskDefaults(db);
    assert.equal(db.supportTeamCompany.rows.length, 4);
    assert.ok(db.supportTeamCompany.rows.every((r) => r.teamId === teamId));
  });
});

describe('creating a company', () => {
  test('makes sure the helpdesk defaults exist, in the same transaction', async () => {
    const db = await liveLikeDb();
    const tx = {
      auditLog: db.auditLog,
      getCompanyByCode: async () => null,
      domainOwners: async () => [],
      createCompany: async (body) => ({ id: 'c-new', ...body }),
      ensureHelpdeskDefaults: (req) => ensureHelpdeskDefaults(db, { req }),
    };
    const service = createAdminService({
      store: { transaction: (fn) => fn(tx) },
      storage: {},
    });
    const req = {
      user: {
        id: 'u1',
        companyId: 'c1',
        roles: [{ role: 'HoldingAdmin', scopeCompanyId: null }],
      },
    };

    await service.createCompany(req, {
      code: 'TST',
      nameEn: 'Test Co',
      nameAr: 'شركة',
      domains: ['tst.test'],
      accentColor: '#2f6f4f',
    });
    assert.equal(db.supportTeam.rows.length, 1);
    assert.equal(db.auditLog.rows.at(-1).actorId, 'u1');
  });
});

describe('IT team members by email', () => {
  async function setup() {
    const db = await liveLikeDb();
    const { teamId } = await ensureHelpdeskDefaults(db);
    const person = async (email, isActive = true) =>
      (await db.userProfile.create({ data: { email, isActive, entraObjectId: email } })).id;
    return { db, teamId, person };
  }
  const roles = (db) => db.supportTeamMember.rows.map((m) => m.role).sort();

  test('parses and normalises the lists', () => {
    assert.deepEqual(parseEmails(' A@x.com, b@x.com ;a@x.com'), ['a@x.com', 'b@x.com']);
    assert.throws(() => parseEmails('nope'), /not email/);
    assert.deepEqual(parseTeamArgs(['--it-leads', 'a@x.com', '--it-members=b@x.com,c@x.com']), {
      leads: ['a@x.com'],
      members: ['b@x.com', 'c@x.com'],
    });
    assert.deepEqual(parseTeamArgs(['--domain', 'HLD=x.com']), { leads: null, members: null });
  });

  test('adds leads and agents and audits each change', async () => {
    const { db, teamId, person } = await setup();
    await person('lead.one@fake.test');
    await person('agent.one@fake.test');
    const auditBefore = db.auditLog.rows.length;

    const result = await setItMembers(db, {
      teamId,
      leads: ['lead.one@fake.test'],
      members: ['agent.one@fake.test'],
    });
    assert.deepEqual(result, { added: 2, changed: 0, unchanged: 0 });
    assert.deepEqual(roles(db), ['Agent', 'Lead']);
    const rows = db.auditLog.rows.slice(auditBefore);
    assert.deepEqual(
      rows.map((r) => r.action),
      ['helpdesk.member.add', 'helpdesk.member.add']
    );
    assert.ok(rows.every((r) => r.entity === 'SupportTeamMember' && r.companyId === null));
  });

  test('is repeatable: a second run changes nothing, a new role is an update', async () => {
    const { db, teamId, person } = await setup();
    await person('a@fake.test');
    await person('b@fake.test');
    const input = { teamId, leads: ['a@fake.test'], members: ['b@fake.test'] };
    await setItMembers(db, input);
    const audits = db.auditLog.rows.length;

    assert.deepEqual(await setItMembers(db, input), { added: 0, changed: 0, unchanged: 2 });
    assert.equal(db.auditLog.rows.length, audits);

    const swap = { teamId, leads: ['a@fake.test', 'b@fake.test'], members: [] };
    assert.deepEqual(await setItMembers(db, swap), { added: 0, changed: 1, unchanged: 1 });
    assert.equal(db.auditLog.rows.at(-1).action, 'helpdesk.member.update');
    assert.deepEqual(roles(db), ['Lead', 'Lead']);
  });

  test('refuses an unknown or inactive email and writes nothing, naming none', async () => {
    const { db, teamId, person } = await setup();
    await person('ok@fake.test');
    await person('gone@fake.test', false);
    const audits = db.auditLog.rows.length;

    await assert.rejects(
      setItMembers(db, {
        teamId,
        leads: ['ok@fake.test'],
        members: ['gone@fake.test', 'nobody@fake.test'],
      }),
      (err) => {
        assert.match(err.message, /2 of 3 email\(s\) are not active users/);
        assert.doesNotMatch(err.message, /fake\.test/);
        return true;
      }
    );
    assert.equal(db.supportTeamMember.rows.length, 0);
    assert.equal(db.auditLog.rows.length, audits);
  });

  test('refuses a person in both lists, and demoting the last lead', async () => {
    const { db, teamId, person } = await setup();
    await person('a@fake.test');
    await assert.rejects(
      setItMembers(db, { teamId, leads: ['a@fake.test'], members: ['a@fake.test'] }),
      /both/
    );
    await setItMembers(db, { teamId, leads: ['a@fake.test'], members: [] });
    await assert.rejects(
      setItMembers(db, { teamId, leads: [], members: ['a@fake.test'] }),
      /at least one active lead/
    );
    assert.deepEqual(roles(db), ['Lead']);
  });
});
