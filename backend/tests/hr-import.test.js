/**
 * The HR import (modules/directory/hr-import.js, scripts/import-hr.js, D140):
 * name matching, departments, the fields HR then owns against sync and the
 * sign-in refresh, and company scoping after HR moves someone. Fake people
 * only: the seeded stand-ins and names made up here.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import { cairoDate, parseArgs, summary } from '../scripts/import-hr.js';
import { createApp } from '../src/app.js';
import { createClient as createMockGraph } from '../src/integrations/graph/mock.js';
import { hrOwned, keepHrFields } from '../src/lib/hr-fields.js';
import { createMemoryUserRepo } from '../src/modules/auth/repo-memory.js';
import { planProfileRefresh } from '../src/modules/auth/refresh.js';
import {
  nameWords,
  namesMatch,
  planHrImport,
  readHandMatches,
  readHrDepartments,
  readHrPeople,
  reportCsv,
  runHrImport,
} from '../src/modules/directory/hr-import.js';
import { createMemoryDirectoryStore } from '../src/modules/directory/store-memory.js';

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };
const PEOPLE_HEAD =
  'staff_id,full_name,position,company_code,department,hr_department_original,location,employment_category,hire_date';
const DEPT_HEAD = 'company_code,department,name_ar,people';
const csv = (head, rows) => '﻿' + [head, ...rows].join('\r\n') + '\r\n';

/* ---- a small portal for the pure planner */

const STATE = {
  companies: [
    { id: 'c-hld', code: 'HLD' },
    { id: 'c-gen', code: 'GEN' },
    { id: 'c-msr', code: 'MSR' },
  ],
  departments: [{ id: 'd-fin', companyId: 'c-hld', nameEn: 'Finance', nameAr: 'المالية' }],
  users: [
    ['u-omar', 'Omar El-Shal', 'c-gen'],
    ['u-hany', 'Hany Sami', 'c-gen'],
    ['u-karim1', 'Karim Nabil', 'c-msr'],
    ['u-karim2', 'Karim Zaki', 'c-msr'],
    ['u-rania', 'Rania Lotfy', 'c-msr'],
    ['u-aya', 'Aya Abdel Azim', 'c-gen'],
    ['u-old', 'Gone Person', 'c-gen', false],
  ].map(([id, name, companyId, isActive = true]) => ({
    id,
    email: `${id}@example.test`,
    displayNameEn: name,
    displayNameAr: '',
    companyId,
    departmentId: null,
    jobTitle: null,
    officeLocation: null,
    staffId: null,
    employmentCategory: null,
    hireDate: null,
    hrFields: null,
    isActive,
  })),
};

const row = (staff_id, full_name, company_code, extra = {}) => ({
  staff_id,
  full_name,
  position: 'Engineer',
  company_code,
  department: '',
  hr_department_original: '',
  location: 'Cairo HQ',
  employment_category: 'White Collars',
  hire_date: '2024-02-01',
  ...extra,
});

const byStaff = (plan, id) => plan.report.find((r) => r.staff_id === id);

describe('HR names', () => {
  test('lower case, no accents, apostrophes or hyphens; prefixes join the next word', () => {
    assert.deepEqual(nameWords('Omar El-Shal'), ['omar', 'elshal']);
    assert.deepEqual(nameWords('Omar El Shal'), ['omar', 'elshal']);
    assert.deepEqual(nameWords('Aya Abdel Azim'), ['aya', 'abdelazim']);
    assert.deepEqual(nameWords('Aya Abdelazim'), ['aya', 'abdelazim']);
    assert.deepEqual(nameWords('Abd El-Rahman Abo Zeid'), ['abdelrahman', 'abozeid']);
    assert.deepEqual(nameWords("José O'Neil"), ['jose', 'oneil']);
  });

  test('first names equal and every portal word in the longer HR name', () => {
    const m = (portal, hr) => namesMatch(nameWords(portal), nameWords(hr));
    assert.ok(m('Omar El-Shal', 'Omar Mohamed Elshal'));
    assert.ok(m('Aya Abdel Azim', 'AYA ABDELAZIM HASSAN'));
    assert.ok(!m('Omar El-Shal', 'Ahmed Omar Elshal'), 'first names differ');
    assert.ok(!m('Omar El-Shal Fathy', 'Omar Elshal'), 'portal word missing from HR');
    assert.ok(!m('', 'Omar'));
  });
});

describe('HR files', () => {
  test('rows are validated; bad and duplicate rows are refused by line, not dropped silently', () => {
    const { rows, invalid } = readHrPeople(
      csv(PEOPLE_HEAD, [
        '10001,Omar Fathy,Engineer,gen,Projects,,Cairo,White Collars,2024-01-31',
        '10001,Omar Again,Engineer,GEN,Projects,,Cairo,White Collars,',
        '10002,Bad Date,Engineer,GEN,Projects,,Cairo,White Collars,2024-02-30',
        ',No Id,Engineer,GEN,,,,,',
      ])
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].company_code, 'GEN');
    assert.deepEqual(invalid.map((i) => [i.line, i.reason]).sort(), [
      [3, 'duplicate_staff_id'],
      [4, 'bad_date'],
      [5, 'bad_staff_id'],
    ]);
    assert.throws(() => readHrPeople('staff_id,full_name\n1,x'), /missing column/);
    assert.throws(() => readHrDepartments(''), /empty/);
    assert.equal(readHandMatches('staff_id,email\n1,A@B.EG').rows[0].email, 'a@b.eg');
  });
});

describe('HR matching and planning', () => {
  test('one account per row matches; several either way is ambiguous; none is unmatched', () => {
    const plan = planHrImport({
      people: [
        row('1', 'Omar Mohamed El Shal', 'HLD'),
        row('2', 'Hany Sami Adel', 'GEN'),
        row('3', 'Hany Sami Fouad', 'GEN'),
        row('4', 'Karim Nabil Zaki', 'MSR'),
        row('5', 'Mona Adel Ibrahim', 'MSR'),
        row('6', 'Aya Abdelazim Hassan', 'PENDING_NEWCO'),
        row('7', 'Gone Person Too', 'GEN'),
      ],
      departments: [],
      state: STATE,
    });
    assert.equal(byStaff(plan, '1').result, 'matched');
    assert.equal(byStaff(plan, '1').portal_email, 'u-omar@example.test');
    assert.equal(byStaff(plan, '2').reason, 'account_matches_several_hr_rows');
    assert.equal(byStaff(plan, '3').result, 'ambiguous');
    assert.equal(byStaff(plan, '4').reason, 'several_portal_accounts_match');
    assert.match(byStaff(plan, '4').candidates, /u-karim1.*u-karim2/);
    assert.equal(byStaff(plan, '5').reason, 'no_microsoft_account');
    // Inactive accounts are not candidates.
    assert.equal(byStaff(plan, '7').result, 'unmatched');
    // A pending company's person is listed with their account and left alone.
    assert.equal(byStaff(plan, '6').result, 'pending');
    assert.equal(byStaff(plan, '6').portal_email, 'u-aya@example.test');
    assert.ok(!plan.updates.some((u) => u.id === 'u-aya'));

    // Only u-rania is an active account that no row could be.
    const missing = plan.report.filter((r) => r.result === 'not_in_hr_list');
    assert.deepEqual(
      missing.map((r) => r.portal_email),
      ['u-rania@example.test']
    );
    assert.deepEqual({ ...plan.counts.HLD }, { ...plan.counts.HLD, matched: 1, changed: 1 });
    assert.equal(plan.counts.GEN.ambiguous, 2);
    assert.equal(plan.counts.MSR.unmatched, 1);
    assert.equal(plan.counts.MSR.notInHr, 1);
    assert.equal(plan.counts.PENDING_NEWCO.pending, 1);
  });

  test('a hand match wins, and a staff id from an earlier import matches again', () => {
    const state = structuredClone(STATE);
    state.users.find((u) => u.id === 'u-rania').staffId = '9';
    const plan = planHrImport({
      people: [
        row('4', 'Karim Nabil Zaki', 'MSR'),
        row('9', 'Rania Renamed', 'MSR'),
        row('8', 'Somebody Else', 'MSR'),
      ],
      departments: [],
      handMatches: [
        { staff_id: '4', email: 'u-karim2@example.test' },
        { staff_id: '8', email: 'nobody@example.test' },
        { staff_id: '77', email: 'u-hany@example.test' },
      ],
      state,
    });
    assert.equal(byStaff(plan, '4').reason, 'matched_by_hand');
    assert.equal(byStaff(plan, '4').portal_email, 'u-karim2@example.test');
    assert.equal(byStaff(plan, '9').reason, 'matched_by_staff_id');
    assert.equal(byStaff(plan, '8').reason, 'hand_match_email_not_in_portal');
    assert.equal(byStaff(plan, '77').reason, 'hand_match_staff_id_not_in_hr_list');
  });

  test('departments: created with both names for portal companies only, existing ones reused', () => {
    const plan = planHrImport({
      people: [row('1', 'Omar El Shal', 'HLD', { department: 'Treasury' })],
      departments: [
        { company_code: 'HLD', department: 'Treasury', name_ar: 'الخزينة', people: '1' },
        // Same Arabic name as the existing Finance: that one, not a second.
        {
          company_code: 'HLD',
          department: 'Finance & Accounts',
          name_ar: 'المالية',
          people: '3',
        },
        {
          company_code: 'PENDING_NEWCO',
          department: 'Sales',
          name_ar: 'المبيعات',
          people: '2',
        },
        { company_code: 'XYZ', department: 'Sales', name_ar: 'المبيعات', people: '2' },
      ],
      state: STATE,
    });
    assert.deepEqual(
      plan.departmentCreates.map((d) => [d.nameEn, d.nameAr, d.companyId]),
      [['Treasury', 'الخزينة', 'c-hld']]
    );
    assert.deepEqual(
      plan.report.filter((r) => r.result === 'department').map((r) => r.reason),
      ['department_created', 'department_exists', 'company_pending', 'company_not_in_portal']
    );
    assert.equal(plan.counts.HLD.departmentsCreated, 1);
    const omar = plan.updates.find((u) => u.id === 'u-omar');
    assert.equal(omar.departmentKey, plan.departmentCreates[0].key);
  });

  test('a matched person gets HR’s company and fields; empty HR fields stay Microsoft’s', () => {
    const plan = planHrImport({
      people: [
        row('1', 'Omar El Shal', 'HLD', { department: 'Finance', location: '', hire_date: '' }),
      ],
      departments: [],
      state: STATE,
    });
    const [omar] = plan.updates;
    assert.equal(omar.fromCompanyId, 'c-gen');
    assert.deepEqual(
      { ...omar.data, searchKey: undefined },
      {
        companyId: 'c-hld',
        departmentId: 'd-fin',
        jobTitle: 'Engineer',
        staffId: '1',
        employmentCategory: 'White Collars',
        hrFields: 'companyId,departmentId,jobTitle',
        searchKey: undefined,
      }
    );
    assert.equal(omar.before.companyId, 'c-gen');
    assert.equal(omar.after.companyId, 'c-hld');
  });
});

/* ---- end to end over the in-memory portal */

function build() {
  const repo = createMemoryUserRepo();
  const graph = createMockGraph();
  const app = createApp({
    config: DEV,
    userRepo: repo,
    graph,
    authRateLimit: { limit: 100_000 },
    rateLimit: { limit: 100_000 },
  });
  const store = createMemoryDirectoryStore(repo);
  const user = (email) => repo.users.find((u) => u.email === email);
  const company = (code) => repo.companies.find((c) => c.code === code);
  return { app, repo, store, user, company };
}

async function signIn(app, user) {
  const agent = request.agent(app);
  const config = await agent.get('/api/auth/config');
  const login = await agent
    .post('/api/auth/mock-login')
    .set('X-CSRF-Token', config.body.csrfToken)
    .send({ userId: user.id });
  assert.equal(login.status, 200);
  const csrf = login.body.csrfToken;
  return {
    get: (path) => agent.get(path),
    post: (path, body = {}) => agent.post(path).set('X-CSRF-Token', csrf).send(body),
  };
}

const ADMIN = 'nadia.elsayed@mgholding.example';
const SALMA = 'salma.ibrahim@genesismining-eg.com';

/** Salma (a Genesis address) is holding staff in HR's list; Dina has no location. */
const FILES = {
  people: csv(PEOPLE_HEAD, [
    '20001,Salma Ahmed Ibrahim,Payroll Lead,HLD,Payroll,Payroll Dept.,Cairo Head Office,White Collars,2019-03-10',
    '20002,Dina Mostafa Khalil,HSE Officer,GEN,Mining Operations,,,Blue Collars,2021-07-01',
    '20003,Unknown Worker,Driver,GEN,Mining Operations,,Mine,Blue Collars,',
    '20004,Pending Person,Clerk,PENDING_NEWCO,Sales,,Cairo,White Collars,',
  ]),
  departments: csv(DEPT_HEAD, [
    'HLD,Payroll,الرواتب,1',
    'GEN,Mining Operations,عمليات التعدين,2',
    'PENDING_NEWCO,Sales,المبيعات,1',
  ]),
  matches: null,
};

const run = (t, options = {}) =>
  runHrImport({
    portalData: 'live',
    store: t.store,
    files: FILES,
    asEmail: ADMIN,
    now: () => new Date('2026-10-19T08:00:00Z'),
    ...options,
  });

describe('npm run import:hr', () => {
  test('only with PORTAL_DATA=live, and only for an active HoldingAdmin', async () => {
    const t = build();
    await assert.rejects(run(t, { portalData: 'demo' }), /PORTAL_DATA=live/);
    await assert.rejects(run(t, { asEmail: undefined }), /--as/);
    // A company admin is not enough.
    await assert.rejects(
      run(t, { asEmail: 'hany.soliman@genesismining-eg.com' }),
      /HoldingAdmin/
    );
    t.user(ADMIN).isActive = false;
    await assert.rejects(run(t), /HoldingAdmin/);
  });

  test('a dry run writes nothing', async () => {
    const t = build();
    const before = structuredClone(t.user(SALMA));
    const departments = t.repo.departments.length;
    const { plan, applied } = await run(t, { dryRun: true });
    assert.equal(applied, null);
    assert.equal(plan.updates.length, 2);
    assert.deepEqual(
      { ...t.user(SALMA), company: undefined },
      { ...before, company: undefined }
    );
    assert.equal(t.repo.departments.length, departments);
    assert.equal(t.repo.auditLogs.length, 0);
  });

  test('applying moves the person, creates the department, audits each change; a rerun changes nothing', async () => {
    const t = build();
    const { plan, applied } = await run(t);
    assert.deepEqual(applied, { departmentsCreated: 1, peopleChanged: 2 });

    const salma = t.user(SALMA);
    const hld = t.company('HLD');
    const payroll = t.repo.departments.find((d) => d.nameEn === 'Payroll');
    assert.equal(payroll.companyId, hld.id);
    assert.equal(payroll.nameAr, 'الرواتب');
    assert.equal(salma.companyId, hld.id);
    assert.equal(salma.departmentId, payroll.id);
    assert.equal(salma.jobTitle, 'Payroll Lead');
    assert.equal(salma.officeLocation, 'Cairo Head Office');
    assert.equal(salma.staffId, '20001');
    assert.equal(salma.employmentCategory, 'White Collars');
    assert.equal(salma.hireDate.toISOString(), '2019-03-10T00:00:00.000Z');
    assert.equal(salma.hrFields, 'companyId,departmentId,jobTitle,officeLocation');
    // Her plain User role moved with her.
    assert.deepEqual(
      salma.roles.map((r) => [r.role, r.scopeCompanyId]),
      [['User', hld.id]]
    );
    // Dina's empty location is not HR's.
    assert.equal(
      t.user('dina.khalil@genesismining-eg.com').hrFields,
      'companyId,departmentId,jobTitle'
    );

    const actor = t.user(ADMIN).id;
    const audits = t.repo.auditLogs;
    assert.ok(audits.every((a) => a.actorId === actor));
    assert.deepEqual(audits.map((a) => a.action).sort(), [
      'department.create',
      'directory.hr_import',
      'user.hr_import',
      'user.hr_import',
    ]);
    const move = audits.find((a) => a.action === 'user.hr_import' && a.entityId === salma.id);
    assert.equal(move.companyId, hld.id);
    assert.equal(JSON.parse(move.before).companyId, t.company('GEN').id);
    assert.equal(JSON.parse(move.after).departmentId, payroll.id);

    assert.equal(byStaff(plan, '20003').reason, 'no_microsoft_account');
    assert.equal(byStaff(plan, '20004').result, 'pending');
    const csvText = reportCsv(plan.report);
    assert.match(csvText.split('\r\n')[0], /"result","reason","staff_id"/);

    const again = await run(t);
    assert.deepEqual(again.applied, { departmentsCreated: 0, peopleChanged: 0 });
    assert.equal(byStaff(again.plan, '20001').reason, 'matched_by_staff_id');
  });

  test('the nightly sync keeps what HR set and fills only what HR left empty', async () => {
    const t = build();
    await run(t);
    const ha = await signIn(t.app, t.user(ADMIN));
    const res = await ha.post('/api/admin/directory/sync', {});
    assert.equal(res.status, 202, JSON.stringify(res.body));
    await t.app.locals.syncRunner.idle();

    const salma = t.user(SALMA);
    // Graph says Genesis Mining, Geology, Senior Geologist: HR's values stay.
    assert.equal(salma.companyId, t.company('HLD').id);
    assert.equal(salma.jobTitle, 'Payroll Lead');
    assert.equal(salma.officeLocation, 'Cairo Head Office');
    assert.equal(salma.department.nameEn, 'Payroll');
    assert.equal(salma.staffId, '20001');
    // Microsoft 365 still owns the rest.
    assert.equal(salma.phone, '+20 2 5550 0202');
    // HR gave Dina no location, so Graph's office fills it.
    const dina = t.user('dina.khalil@genesismining-eg.com');
    assert.equal(dina.officeLocation, 'Eastern Desert Mine Site');
    assert.equal(dina.jobTitle, 'HSE Officer');
  });

  test('the sign-in refresh keeps HR’s fields, and HR’s company beats the email domain', () => {
    const person = {
      id: 'p1',
      email: 'someone@genesismining-eg.com',
      companyId: 'c-hld',
      departmentId: 'd-pay',
      jobTitle: 'Payroll Lead',
      officeLocation: null,
      displayNameEn: 'Some One',
      displayNameAr: '',
      hrFields: 'companyId,departmentId,jobTitle',
    };
    const { data, changed } = planProfileRefresh({
      person,
      me: {
        displayName: 'Some One',
        jobTitle: 'Geologist',
        department: 'Geology',
        companyName: 'Genesis Mining',
        officeLocation: 'Mine Site',
      },
      managerId: undefined,
      companies: [
        { id: 'c-hld', code: 'HLD', nameEn: 'MG Holding', nameAr: '', domains: ['mg.test'] },
        {
          id: 'c-gen',
          code: 'GEN',
          nameEn: 'Genesis Mining',
          nameAr: '',
          domains: ['genesismining-eg.com'],
        },
      ],
      departments: [{ id: 'd-geo', companyId: 'c-gen', nameEn: 'Geology', nameAr: 'جيولوجيا' }],
    });
    assert.ok(!changed.includes('companyId'));
    assert.ok(!changed.includes('departmentId'));
    assert.ok(!changed.includes('jobTitle'));
    assert.equal(data.officeLocation, 'Mine Site');
    // Without HR's mark the domain and Graph decide, as before.
    const free = planProfileRefresh({
      person: { ...person, hrFields: null },
      me: { displayName: 'Some One', companyName: 'Genesis Mining', jobTitle: 'Geologist' },
      managerId: undefined,
      companies: [
        { id: 'c-hld', code: 'HLD', nameEn: 'MG Holding', nameAr: '', domains: [] },
        { id: 'c-gen', code: 'GEN', nameEn: 'Genesis Mining', nameAr: '', domains: [] },
      ],
      departments: [],
    });
    assert.equal(free.data.companyId, 'c-gen');
    assert.equal(free.data.jobTitle, 'Geologist');
  });

  test('company scoping follows HR’s move: the new company’s records, never the old one’s', async () => {
    const t = build();
    const caGen = await signIn(t.app, t.user('hany.soliman@genesismining-eg.com'));
    const ha = await signIn(t.app, t.user(ADMIN));
    const post = async (admin, companyId, titleEn) => {
      const made = await admin.post('/api/admin/announcements', {
        companyId,
        titleEn,
        bodyEn: 'Body',
        category: 'HSE',
      });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      const out = await admin.post(`/api/admin/announcements/${made.body.id}/publish`, {
        updatedAt: made.body.updatedAt,
      });
      assert.equal(out.status, 200, JSON.stringify(out.body));
      return made.body.id;
    };
    const genPost = await post(caGen, t.company('GEN').id, 'Genesis only');
    const hldPost = await post(ha, t.company('HLD').id, 'Holding only');

    const before = await signIn(t.app, t.user(SALMA));
    assert.equal((await before.get(`/api/announcements/${genPost}`)).status, 200);
    assert.equal((await before.get(`/api/announcements/${hldPost}`)).status, 404);

    await run(t);

    // Her company changed, so the session she had ends (D126).
    assert.equal((await before.get('/api/me')).status, 401);
    const after = await signIn(t.app, t.user(SALMA));
    const me = await after.get('/api/me');
    assert.equal(me.body.company.code, 'HLD');
    assert.equal((await after.get(`/api/announcements/${genPost}`)).status, 404);
    assert.equal((await after.get(`/api/announcements/${hldPost}`)).status, 200);
    const list = (await after.get('/api/announcements')).body.items.map((a) => a.id);
    assert.ok(list.includes(hldPost) && !list.includes(genPost));
    // A client cannot ask its way back into the old company.
    assert.equal(
      (await after.get(`/api/announcements?companyId=${t.company('GEN').id}`)).status,
      400
    );
  });
});

describe('import:hr command line', () => {
  test('arguments, the report date in Cairo, and a summary with counts only', () => {
    assert.deepEqual(parseArgs(['--dry-run', '--as', 'a@b.eg']), {
      dryRun: true,
      as: 'a@b.eg',
      dir: null,
    });
    assert.equal(parseArgs(['--as=a@b.eg']).as, 'a@b.eg');
    assert.throws(() => parseArgs(['--force']), /Unknown option/);
    // 23:30 UTC on the 18th is already the 19th in Cairo.
    assert.equal(cairoDate(new Date('2026-10-18T23:30:00Z')), '2026-10-19');

    const plan = planHrImport({
      people: [row('1', 'Omar El Shal', 'HLD'), row('5', 'Mona Adel', 'MSR')],
      departments: [],
      state: STATE,
    });
    const text = summary(plan, { dryRun: true });
    assert.match(text, /dry run/);
    assert.match(text, /^total\s+1\s+1\s+0\s+1\s/m);
    for (const secret of ['Omar', 'Mona', 'u-omar', 'Shal']) assert.ok(!text.includes(secret));
    assert.ok(hrOwned({ hrFields: 'jobTitle,bogus' }).has('jobTitle'));
    assert.deepEqual(
      keepHrFields({ hrFields: 'jobTitle', jobTitle: 'HR' }, { jobTitle: 'MS' }),
      {
        jobTitle: 'HR',
      }
    );
  });
});

describe('HR import against SQL Server', async () => {
  const { env } = await import('../src/config/env.js');
  const { getPrisma, disconnectPrisma } = await import('../src/lib/prisma.js');
  const { createPrismaDirectoryStore } =
    await import('../src/modules/directory/store-prisma.js');
  let prisma = null;
  let reason = null;
  if (!env.hasDatabase) reason = 'DATABASE_URL is not configured';
  else {
    try {
      prisma = await getPrisma();
      await prisma.userProfile.count({ where: { hrFields: { not: null } } });
    } catch {
      await disconnectPrisma();
      reason = 'the database is unreachable or not migrated';
    }
  }
  const { randomUUID } = await import('node:crypto');
  const tag = randomUUID().slice(0, 6).toUpperCase();
  // Unique per run: a staff id already stored would (rightly) match by itself.
  const staffId = String(parseInt(tag, 16));

  test(
    'departments, fields, the moved User role and the audit rows are written',
    { skip: reason ?? false },
    async () => {
      const company = (code) =>
        prisma.company.create({
          data: {
            code: `${code}${tag}`.slice(0, 10),
            nameEn: `${code} ${tag}`,
            nameAr: `${code} ${tag}`,
            domain: `${code}-${tag}.hr.example`.toLowerCase(),
            accentColor: '#336699',
          },
        });
      const [from, to] = [await company('F'), await company('T')];
      const admin = await prisma.userProfile.create({
        data: {
          entraObjectId: randomUUID(),
          email: `admin-${tag}@hr.example`.toLowerCase(),
          companyId: to.id,
          displayNameEn: 'Test Admin',
          displayNameAr: '',
          roleAssignments: { create: { role: 'HoldingAdmin', scopeCompanyId: null } },
        },
      });
      const person = await prisma.userProfile.create({
        data: {
          entraObjectId: randomUUID(),
          email: `zed-${tag}@hr.example`.toLowerCase(),
          companyId: from.id,
          displayNameEn: `Zed Qux${tag.toLowerCase()}`,
          displayNameAr: '',
          roleAssignments: { create: { role: 'User', scopeCompanyId: from.id } },
        },
      });

      const store = createPrismaDirectoryStore();
      const { applied } = await runHrImport({
        portalData: 'live',
        store,
        asEmail: admin.email,
        files: {
          people: csv(PEOPLE_HEAD, [
            `${staffId},Zed Middle Qux${tag.toLowerCase()},Analyst,${to.code},Audit,,HQ,White Collars,2020-05-05`,
          ]),
          departments: csv(DEPT_HEAD, [`${to.code},Audit,التدقيق ${tag},1`]),
        },
      });
      assert.equal(applied.peopleChanged, 1);

      const after = await prisma.userProfile.findUnique({
        where: { id: person.id },
        include: { roleAssignments: true, department: true },
      });
      assert.equal(after.companyId, to.id);
      assert.equal(after.department.nameEn, 'Audit');
      assert.equal(after.department.companyId, to.id);
      assert.equal(after.staffId, staffId);
      assert.equal(after.hireDate.toISOString().slice(0, 10), '2020-05-05');
      assert.equal(after.hrFields, 'companyId,departmentId,jobTitle,officeLocation');
      assert.ok(after.hrImportedAt);
      assert.deepEqual(
        after.roleAssignments.map((r) => [r.role, r.scopeCompanyId]),
        [['User', to.id]]
      );
      const audits = await prisma.auditLog.findMany({
        where: { actorId: admin.id },
        select: { action: true, companyId: true },
      });
      assert.deepEqual(audits.map((a) => a.action).sort(), [
        'department.create',
        'directory.hr_import',
        'user.hr_import',
      ]);
    }
  );

  test('disconnects', { skip: reason ?? false }, async () => {
    await disconnectPrisma();
  });
});
