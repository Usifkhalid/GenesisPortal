import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { createClient as createMockGraph } from '../src/integrations/graph/mock.js';
import {
  createClient as createRealGraph,
  retryAfterMs,
} from '../src/integrations/graph/real.js';
import { cairoParts, startNightlySync } from '../src/jobs/syncUsers.js';
import { normalizeText, searchKeyOf } from '../src/lib/text-search.js';
import { createMemoryUserRepo } from '../src/modules/auth/repo-memory.js';

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };
const FIXTURE = JSON.parse(
  readFileSync(new URL('../mock/graph-users.json', import.meta.url), 'utf8')
);

/** A Graph client over a copy of the mock data, edited by `edit`. */
function graphWith(edit = () => {}) {
  const data = structuredClone(FIXTURE);
  edit(data);
  return createMockGraph(data);
}

function build({ graph = createMockGraph() } = {}) {
  const repo = createMemoryUserRepo();
  const app = createApp({
    config: DEV,
    userRepo: repo,
    graph,
    authRateLimit: { limit: 100_000 },
    rateLimit: { limit: 100_000 },
  });
  const company = (code) => repo.companies.find((c) => c.code === code);
  const userOf = (code, role) =>
    repo.users.find((u) => u.company.code === code && u.roles.some((r) => r.role === role));
  return { app, repo, company, userOf };
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
  const send = (method, path, body) => {
    const call = agent[method](path).set('X-CSRF-Token', csrf);
    return body === undefined ? call : call.send(body);
  };
  return {
    user,
    get: (path) => agent.get(path),
    post: (path, body = {}) => send('post', path, body),
    patch: (path, body) => send('patch', path, body),
    /** Posts a file as the request body, as the browser does. */
    upload: (path, text) =>
      agent.post(path).set('X-CSRF-Token', csrf).set('Content-Type', 'text/csv').send(text),
  };
}

async function world(options) {
  const w = build(options);
  w.ha = await signIn(w.app, w.userOf('HLD', 'HoldingAdmin'));
  w.caGen = await signIn(w.app, w.userOf('GEN', 'CompanyAdmin'));
  w.gen = await signIn(w.app, w.userOf('GEN', 'User'));
  w.msr = await signIn(w.app, w.userOf('MSR', 'User'));
  w.genId = w.company('GEN').id;
  w.msrId = w.company('MSR').id;
  w.hldId = w.company('HLD').id;

  /** Runs a sync as the HoldingAdmin and waits for it. */
  w.sync = async (body = {}) => {
    const res = await w.ha.post('/api/admin/directory/sync', body);
    assert.equal(res.status, 202, JSON.stringify(res.body));
    await w.app.locals.syncRunner.idle();
    const history = await w.ha.get('/api/admin/directory/sync');
    return history.body.items[0];
  };
  w.find = async (who, q, extra = '') =>
    (await who.get(`/api/directory/people?q=${encodeURIComponent(q)}${extra}`)).body.items;
  return w;
}

const warning = (run, code) => run.warnings.filter((x) => x.code === code);

describe('text normalisation', () => {
  test('folds Arabic letter variants, diacritics and Latin accents', () => {
    assert.equal(normalizeText('أحمد'), normalizeText('احمد'));
    assert.equal(normalizeText('إبراهيم'), normalizeText('ابراهيم'));
    assert.equal(normalizeText('آمنة'), normalizeText('امنه'));
    assert.equal(normalizeText('سلمى'), normalizeText('سلمي'));
    assert.equal(normalizeText('نادِيَة'), normalizeText('ناديه'));
    assert.equal(normalizeText('El-Sayed'), 'el sayed');
    assert.equal(normalizeText('José'), 'jose');
    assert.equal(normalizeText('٢٠٢٦'), '2026');
  });

  test('the search key holds both names, the email and the title', () => {
    const key = searchKeyOf({
      displayNameEn: 'Nadia El-Sayed',
      displayNameAr: 'نادية السيد',
      email: 'n@x.eg',
      jobTitle: 'Group IT Director',
    });
    for (const part of ['nadia', 'el sayed', 'ناديه', 'n@x', 'director']) {
      assert.ok(key.includes(part), part);
    }
  });
});

describe('Graph adapters', () => {
  test('the mock lists the seeded users with their ids and the deliberate gaps', async () => {
    const users = await createMockGraph().listUsers();
    assert.ok(users.length >= 35);
    for (const email of ['nadia.elsayed@mgholding.example', 'rania.farouk@masar.eg']) {
      assert.ok(
        users.some((u) => u.mail === email),
        email
      );
    }
    assert.ok(users.some((u) => u.accountEnabled === false));
    assert.ok(users.some((u) => !u.department));
    assert.ok(users.some((u) => !u.jobTitle));
    assert.ok(users.some((u) => u.mail.endsWith('@contractor-partners.example')));
    const client = createMockGraph();
    const karim = users.find((u) => u.mail === 'karim.mansour@mgholding.example');
    assert.equal((await client.getManager(karim.id)).mail, 'nadia.elsayed@mgholding.example');
    assert.equal(await client.getManager('00000000-0000-4000-8000-000000000001'), null);
  });

  test('the real client pages through results and waits out a 429', async () => {
    const waits = [];
    const replies = [
      { status: 200, body: { value: [{ id: 'a' }], '@odata.nextLink': 'https://g/next' } },
      { status: 429, headers: { 'Retry-After': '3' } },
      { status: 200, body: { value: [{ id: 'b' }] } },
    ];
    const fetchStub = async () => {
      const r = replies.shift();
      return {
        ok: r.status === 200,
        status: r.status,
        headers: { get: (name) => r.headers?.[name] ?? null },
        json: async () => r.body,
      };
    };
    const client = createRealGraph({
      fetch: fetchStub,
      getToken: async () => 't',
      wait: async (ms) => waits.push(ms),
    });
    const users = await client.listUsers();
    assert.deepEqual(
      users.map((u) => u.id),
      ['a', 'b']
    );
    assert.deepEqual(waits, [3000]);
    assert.equal(retryAfterMs('7'), 7000);
    assert.equal(retryAfterMs(null), 2000);
  });
});

describe('sync mapping', () => {
  test('places people by company name or mail domain and matches departments', async () => {
    const w = await world();
    const run = await w.sync();
    assert.equal(run.status, 'success', JSON.stringify(run.warnings));
    assert.equal(run.created, 26);
    assert.equal(run.deactivated, 0);

    // companyName empty: placed by the mail domain.
    const [amira] = await w.find(w.ha, 'Amira Taha');
    assert.equal(amira.company.code, 'HLD');
    // companyName in Arabic.
    const [nermine] = await w.find(w.ha, 'Nermine');
    assert.equal(nermine.company.code, 'MSR');

    // Department names in Arabic and in English.
    const [hoda] = await w.find(w.ha, 'Hoda Zaytoun');
    assert.equal(hoda.department.nameEn, 'Finance');
    const [basem] = await w.find(w.ha, 'Basem');
    assert.equal(basem.department.nameEn, 'Health, Safety and Environment');
  });

  test('records unmatched departments and unplaced people, creating neither', async () => {
    const w = await world();
    const run = await w.sync();

    const [dept] = warning(run, 'unmatched_department');
    assert.deepEqual(
      { name: dept.name, companyCode: dept.companyCode, count: dept.count },
      { name: 'Skunkworks', companyCode: 'MSR', count: 1 }
    );
    const departments = await w.ha.get(`/api/admin/departments?companyId=${w.msrId}`);
    assert.ok(!departments.body.items.some((d) => d.nameEn === 'Skunkworks'));
    const [heba] = await w.find(w.ha, 'Heba Lotfy');
    assert.equal(heba.department, null);

    const [unplaced] = warning(run, 'unplaced_user');
    assert.equal(unplaced.email, 'chris.walker@contractor-partners.example');
    assert.equal(unplaced.domain, 'contractor-partners.example');
    assert.deepEqual(await w.find(w.ha, 'Chris Walker'), []);
  });

  test('links managers, including to people created in the same run', async () => {
    const w = await world();
    await w.sync();
    const [laila] = await w.find(w.ha, 'Laila Hassan');
    const detail = await w.ha.get(`/api/directory/people/${laila.id}`);
    assert.equal(detail.body.manager.displayNameEn, 'Nadia El-Sayed');

    const [hoda] = await w.find(w.ha, 'Hoda Zaytoun');
    const lailaDetail = await w.ha.get(`/api/directory/people/${laila.id}`);
    assert.ok(lailaDetail.body.directReports.some((r) => r.id === hoda.id));
  });

  test('never overwrites an Arabic name; a new person has none', async () => {
    const w = await world({
      graph: graphWith((data) => {
        data.users.find((u) => u.mail === 'nadia.elsayed@mgholding.example').displayName =
          'Nadia Elsayed-Renamed';
      }),
    });
    const nadia = w.userOf('HLD', 'HoldingAdmin');
    const arabic = nadia.displayNameAr;
    await w.sync();

    assert.equal(nadia.displayNameEn, 'Nadia Elsayed-Renamed');
    assert.equal(nadia.displayNameAr, arabic);
    const laila = w.repo.users.find((u) => u.email === 'laila.hassan@mgholding.example');
    assert.equal(laila.displayNameAr, '');
    // The directory falls back to the English name where Arabic is empty.
    const [row] = await w.find(w.ha, 'Laila', '&lang=ar');
    assert.equal(row.displayNameAr, '');
    assert.equal(row.displayNameEn, 'Laila Hassan');
  });

  test('a person missing from Graph or disabled becomes inactive, not deleted', async () => {
    const w = await world({
      graph: graphWith((data) => {
        const gone = data.users.findIndex((u) => u.mail === 'rania.farouk@masar.eg');
        data.users.splice(gone, 1);
        data.users.find((u) => u.mail === 'omar.fahmy@mgholding.example').accountEnabled =
          false;
      }),
    });
    const before = w.repo.users.length;
    const run = await w.sync();
    assert.equal(run.status, 'success');
    assert.equal(run.deactivated, 2);

    const rania = w.repo.users.find((u) => u.email === 'rania.farouk@masar.eg');
    const omar = w.repo.users.find((u) => u.email === 'omar.fahmy@mgholding.example');
    assert.equal(rania.isActive, false);
    assert.equal(omar.isActive, false);
    assert.ok(w.repo.users.length >= before);
    assert.deepEqual(await w.find(w.ha, 'Rania Farouk'), []);
  });

  test('a second run changes nothing', async () => {
    const w = await world();
    await w.sync();
    const again = await w.sync();
    assert.equal(again.status, 'success');
    assert.deepEqual([again.created, again.updated, again.deactivated], [0, 0, 0]);
  });

  test('one audit entry per run, with its counts', async () => {
    const w = await world();
    await w.sync();
    await w.sync();
    const entries = w.repo.auditLogs.filter((a) => a.action === 'directory.sync');
    assert.equal(entries.length, 2);
    const first = JSON.parse(entries[0].after);
    assert.equal(first.created, 26);
    assert.equal(entries[0].actorId, w.ha.user.id);
    assert.equal(entries[0].companyId, null);
  });
});

describe('sync safety', () => {
  test('an empty Graph answer is a failed run and changes nothing', async () => {
    const w = await world({ graph: graphWith((d) => (d.users = [])) });
    const run = await w.sync();
    assert.equal(run.status, 'failed');
    assert.equal(warning(run, 'graph_empty').length, 1);
    assert.ok(w.repo.users.every((u) => u.isActive));
  });

  test('more than 20% deactivated aborts, unless the run is confirmed', async () => {
    const w = await world({
      graph: graphWith((data) => {
        for (const mail of [
          'rania.farouk@masar.eg',
          'omar.fahmy@mgholding.example',
          'dina.khalil@genesismining-eg.com',
        ]) {
          data.users.splice(
            data.users.findIndex((u) => u.mail === mail),
            1
          );
        }
      }),
    });

    const aborted = await w.sync();
    assert.equal(aborted.status, 'failed');
    const [limit] = warning(aborted, 'deactivation_limit');
    assert.deepEqual([limit.wouldDeactivate, limit.active], [3, 12]);
    // Nothing applied: no one deactivated, no one created.
    assert.ok(w.repo.users.every((u) => u.isActive));
    assert.equal(w.repo.users.length, 12);

    const confirmed = await w.sync({ allowLargeDeactivation: true });
    assert.equal(confirmed.status, 'success');
    assert.equal(confirmed.deactivated, 3);
  });

  test('a second request while one runs gets 409', async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const inner = createMockGraph();
    const slow = {
      ...inner,
      listUsers: async () => {
        await gate;
        return inner.listUsers();
      },
    };
    const w = await world({ graph: slow });

    const first = await w.ha.post('/api/admin/directory/sync');
    assert.equal(first.status, 202);
    assert.equal(first.body.status, 'running');

    const second = await w.ha.post('/api/admin/directory/sync');
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'sync_in_progress');

    release();
    await w.app.locals.syncRunner.idle();
    const third = await w.ha.post('/api/admin/directory/sync');
    assert.equal(third.status, 202);
    await w.app.locals.syncRunner.idle();
  });
});

describe('search', () => {
  test('finds by English name, email and job title, ignoring case', async () => {
    const w = await world();
    assert.equal((await w.find(w.ha, 'nadia'))[0].displayNameEn, 'Nadia El-Sayed');
    assert.equal((await w.find(w.ha, 'NADIA el sayed'))[0].displayNameEn, 'Nadia El-Sayed');
    assert.equal((await w.find(w.ha, 'omar.fahmy@mgholding'))[0].displayNameEn, 'Omar Fahmy');
    assert.equal((await w.find(w.ha, 'systems administrator'))[0].displayNameEn, 'Omar Fahmy');
    assert.deepEqual(await w.find(w.ha, 'zzzz-nobody'), []);
  });

  test('finds by Arabic name, ignoring diacritics and letter variants', async () => {
    const w = await world();
    const names = async (q) => (await w.find(w.ha, q)).map((p) => p.displayNameEn);

    assert.deepEqual(await names('نادية'), ['Nadia El-Sayed']);
    assert.deepEqual(await names('نادِيَة'), ['Nadia El-Sayed']); // diacritics
    assert.deepEqual(await names('احمد'), ['Ahmed Shawky']); // أ → ا
    assert.deepEqual(await names('ابراهيم'), ['Salma Ibrahim']); // إ → ا
    assert.deepEqual(await names('سلمي'), ['Salma Ibrahim']); // ى → ي
    assert.deepEqual(await names('سلمى'), ['Salma Ibrahim']);

    // ة and ه are equal: the stored key is built from the same folding.
    const salma = w.repo.users.find((u) => u.email === 'salma.ibrahim@genesismining-eg.com');
    salma.displayNameAr = 'سلمة إبراهيم';
    salma.searchKey = searchKeyOf(salma);
    assert.deepEqual(await names('سلمه'), ['Salma Ibrahim']);
    assert.deepEqual(await names('سلمة'), ['Salma Ibrahim']);
  });

  test('sorts by the name in the asked language and pages', async () => {
    const w = await world();
    await w.sync();
    const en = await w.ha.get('/api/directory/people?lang=en&pageSize=50');
    const names = en.body.items.map((p) => p.displayNameEn);
    assert.deepEqual(
      names,
      [...names].sort((a, b) => a.localeCompare(b, 'en'))
    );
    assert.equal(en.body.total, 37);

    const paged = await w.ha.get('/api/directory/people?lang=en&pageSize=10&page=2');
    assert.equal(paged.body.items.length, 10);
    assert.equal(paged.body.items[0].id, en.body.items[10].id);

    const ar = await w.ha.get('/api/directory/people?lang=ar&pageSize=50');
    assert.equal(ar.body.items.length, 37);
  });

  test('filters by company and department, within the reader’s scope', async () => {
    const w = await world();
    await w.sync();
    const gen = await w.find(w.ha, '', `&companyId=${w.genId}&pageSize=50`);
    assert.ok(gen.length > 0 && gen.every((p) => p.company.code === 'GEN'));

    const filters = (await w.ha.get('/api/directory/filters')).body;
    const hse = filters.departments.find(
      (d) => d.companyId === w.genId && d.nameEn.startsWith('Health')
    );
    const inHse = await w.find(w.ha, '', `&departmentId=${hse.id}`);
    assert.deepEqual(inHse.map((p) => p.displayNameEn).sort(), [
      'Basem Younis',
      'Dina Khalil',
      'Farida Hegazy',
    ]);
  });
});

describe('visibility', () => {
  test('the directory is group-wide: a user finds and opens people in every company', async () => {
    const w = await world();
    await w.sync();

    const everyone = await w.find(w.gen, '', '&pageSize=50');
    assert.deepEqual([...new Set(everyone.map((p) => p.company.code))].sort(), [
      'GEN',
      'HLD',
      'MSR',
    ]);
    assert.equal(
      (await w.gen.get('/api/directory/people?pageSize=1')).body.total,
      (await w.ha.get('/api/directory/people?pageSize=1')).body.total
    );

    // A Genesis user finds a Masar person, opens them, and sees work details only.
    const [tarek] = await w.find(w.gen, 'Tarek El-Masry');
    assert.equal(tarek.company.code, 'MSR');
    const detail = await w.gen.get(`/api/directory/people/${tarek.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.email, 'tarek.elmasry@masar.eg');
    assert.ok(detail.body.directReports.length > 0);
    assert.equal(detail.body.canEditArabicName, false);
    assert.deepEqual(Object.keys(detail.body).sort(), [
      'canEditArabicName',
      'company',
      'department',
      'directReports',
      'displayNameAr',
      'displayNameEn',
      'email',
      'id',
      'jobTitle',
      'manager',
      'mobilePhone',
      'officeLocation',
      'phone',
    ]);

    const masar = await w.find(w.gen, '', `&companyId=${w.msrId}&pageSize=50`);
    assert.ok(masar.length > 0 && masar.every((p) => p.company.code === 'MSR'));

    const filters = (await w.gen.get('/api/directory/filters')).body;
    assert.deepEqual(
      filters.companies.map((c) => c.code),
      ['GEN', 'HLD', 'MSR']
    );
    assert.ok(filters.departments.some((d) => d.companyId === w.msrId));
  });

  test('inactive people stay hidden from everyone, in every company', async () => {
    const w = await world();
    const rania = w.repo.users.find((u) => u.email === 'rania.farouk@masar.eg');
    rania.isActive = false;
    assert.deepEqual(await w.find(w.gen, 'Rania Farouk'), []);
    assert.equal((await w.gen.get(`/api/directory/people/${rania.id}`)).status, 404);
    assert.equal((await w.ha.get(`/api/directory/people/${rania.id}`)).status, 404);
  });

  test('a mobile number follows the person’s company, not the reader’s', async () => {
    const w = await world();
    await w.sync();
    const [salma] = await w.find(w.msr, 'Salma Ibrahim');
    const [nermine] = await w.find(w.gen, 'Nermine');

    // Masar turns mobiles on; Genesis leaves them off.
    const company = (await w.ha.get(`/api/admin/companies/${w.msrId}`)).body;
    const on = await w.ha.patch(`/api/admin/companies/${w.msrId}`, {
      updatedAt: company.updatedAt,
      showMobileInDirectory: true,
    });
    assert.equal(on.status, 200, JSON.stringify(on.body));

    // A Masar reader still sees no Genesis mobile; a Genesis reader sees Masar's.
    const genPerson = (await w.msr.get(`/api/directory/people/${salma.id}`)).body;
    assert.equal(genPerson.mobilePhone, null);
    const msrPerson = (await w.gen.get(`/api/directory/people/${nermine.id}`)).body;
    assert.ok(msrPerson.mobilePhone);
  });

  test('a mobile number shows only when the company turns it on, and that is audited', async () => {
    const w = await world();
    await w.sync();
    const [salma] = await w.find(w.gen, 'Salma Ibrahim');

    const hidden = await w.gen.get(`/api/directory/people/${salma.id}`);
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.mobilePhone, null);
    assert.ok(hidden.body.phone);
    assert.ok(!JSON.stringify(hidden.body).includes('+20 100 555'));

    const company = (await w.ha.get(`/api/admin/companies/${w.genId}`)).body;
    const on = await w.ha.patch(`/api/admin/companies/${w.genId}`, {
      updatedAt: company.updatedAt,
      showMobileInDirectory: true,
    });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.showMobileInDirectory, true);

    const shown = await w.gen.get(`/api/directory/people/${salma.id}`);
    assert.match(shown.body.mobilePhone, /^\+20 100 555/);

    const audit = w.repo.auditLogs.find(
      (a) => a.action === 'company.update' && a.entityId === w.genId
    );
    assert.match(audit.after, /"showMobileInDirectory":true/);
    assert.match(audit.before, /"showMobileInDirectory":false/);
  });
});

describe('Arabic names', () => {
  const NAME = 'محمود عطية الله';

  test('a company admin sets a name in their own company; it is audited and searchable', async () => {
    const w = await world();
    const mahmoud = w.repo.users.find((u) => u.email === 'mahmoud.attia@genesismining-eg.com');
    const before = mahmoud.displayNameAr;

    const seen = await w.caGen.get(`/api/directory/people/${mahmoud.id}`);
    assert.equal(seen.body.canEditArabicName, true);

    const res = await w.caGen.patch(`/api/admin/directory/people/${mahmoud.id}`, {
      displayNameAr: `  ${NAME}  `,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.displayNameAr, NAME);
    assert.deepEqual(
      (await w.find(w.msr, 'عطيه الله')).map((p) => p.id),
      [mahmoud.id]
    );

    const [audit] = w.repo.auditLogs.filter((a) => a.action === 'directory.person.arabic_name');
    assert.equal(audit.actorId, w.caGen.user.id);
    assert.equal(audit.companyId, w.genId);
    assert.equal(audit.entityId, mahmoud.id);
    assert.equal(JSON.parse(audit.before).displayNameAr, before);
    assert.equal(JSON.parse(audit.after).displayNameAr, NAME);

    // Saving the same name again writes nothing.
    await w.caGen.patch(`/api/admin/directory/people/${mahmoud.id}`, { displayNameAr: NAME });
    assert.equal(
      w.repo.auditLogs.filter((a) => a.action === 'directory.person.arabic_name').length,
      1
    );
  });

  test('only an admin of the person’s company may set it', async () => {
    const w = await world();
    const tarek = w.repo.users.find((u) => u.email === 'tarek.elmasry@masar.eg');
    const path = `/api/admin/directory/people/${tarek.id}`;
    const before = tarek.displayNameAr;

    assert.equal((await w.gen.patch(path, { displayNameAr: NAME })).status, 403);
    assert.equal((await w.msr.patch(path, { displayNameAr: NAME })).status, 403);
    // A Genesis admin sees the Masar person but cannot change them.
    assert.equal((await w.caGen.patch(path, { displayNameAr: NAME })).status, 403);
    assert.equal(tarek.displayNameAr, before);
    assert.equal(w.repo.auditLogs.length, 0);

    assert.equal((await w.ha.patch(path, { displayNameAr: NAME })).status, 200);
    assert.equal(tarek.displayNameAr, NAME);
    assert.equal((await w.ha.patch(path, { displayNameAr: 'x'.repeat(201) })).status, 400);
    assert.equal((await w.ha.patch(path, { displayNameEn: 'Nope' })).status, 400);
  });

  test('sync never overwrites a name an admin set', async () => {
    const w = await world();
    await w.sync();
    const laila = w.repo.users.find((u) => u.email === 'laila.hassan@mgholding.example');
    assert.equal(laila.displayNameAr, '');
    await w.ha.patch(`/api/admin/directory/people/${laila.id}`, { displayNameAr: 'ليلى حسن' });

    const run = await w.sync();
    assert.equal(run.status, 'success');
    assert.deepEqual([run.created, run.updated, run.deactivated], [0, 0, 0]);
    assert.equal(laila.displayNameAr, 'ليلى حسن');
    // Still found by it after the sync rebuilt the search key.
    assert.deepEqual(
      (await w.find(w.gen, 'ليلي')).map((p) => p.id),
      [laila.id]
    );
  });

  const FILE = [
    '\uFEFFEmail,Arabic Name',
    'MAHMOUD.ATTIA@genesismining-eg.com,"محمود عطية الله"',
    'salma.ibrahim@genesismining-eg.com,سلمى إبراهيم',
    'tarek.elmasry@masar.eg,طارق المصري الكبير',
    'nobody@genesismining-eg.com,لا أحد',
    'not-an-email,اسم',
    'dina.khalil@genesismining-eg.com,',
    'mahmoud.attia@genesismining-eg.com,مكرر',
    '',
  ].join('\r\n');

  test('the import previews matches, unknown emails and changes without writing', async () => {
    const w = await world();
    const res = await w.ha.upload('/api/admin/directory/arabic-names/preview', FILE);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.rows, 7);
    assert.equal(res.body.matched, 3);
    assert.equal(res.body.unchanged, 1); // Salma already has this name
    assert.deepEqual(
      res.body.changes.map((c) => [c.email, c.companyCode, c.from, c.to]),
      [
        ['mahmoud.attia@genesismining-eg.com', 'GEN', 'محمود عطية', 'محمود عطية الله'],
        ['tarek.elmasry@masar.eg', 'MSR', 'طارق المصري', 'طارق المصري الكبير'],
      ]
    );
    assert.deepEqual(res.body.unknown, ['nobody@genesismining-eg.com']);
    assert.deepEqual(
      res.body.invalid.map((i) => [i.line, i.reason]),
      [
        [6, 'email'],
        [7, 'empty'],
        [8, 'duplicate'],
      ]
    );
    assert.equal(w.repo.auditLogs.length, 0);
    assert.equal(
      w.repo.users.find((u) => u.email === 'tarek.elmasry@masar.eg').displayNameAr,
      'طارق المصري'
    );
  });

  test('applying writes the changes and audits them with counts, per company', async () => {
    const w = await world();
    const res = await w.ha.upload('/api/admin/directory/arabic-names/apply', FILE);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.applied, 2);

    const nameOf = (email) => w.repo.users.find((u) => u.email === email).displayNameAr;
    assert.equal(nameOf('mahmoud.attia@genesismining-eg.com'), 'محمود عطية الله');
    assert.equal(nameOf('tarek.elmasry@masar.eg'), 'طارق المصري الكبير');
    assert.equal(nameOf('dina.khalil@genesismining-eg.com'), 'دينا خليل'); // empty cell: untouched

    const audits = w.repo.auditLogs.filter((a) => a.action === 'directory.arabic_names.import');
    assert.deepEqual(audits.map((a) => a.companyId).sort(), [w.genId, w.msrId].sort());
    const gen = JSON.parse(audits.find((a) => a.companyId === w.genId).after);
    assert.deepEqual(
      [gen.changed, gen.fileRows, gen.unchanged, gen.unknown, gen.invalid],
      [1, 7, 1, 1, 3]
    );
    assert.deepEqual(gen.names, [
      { email: 'mahmoud.attia@genesismining-eg.com', displayNameAr: 'محمود عطية الله' },
    ]);

    // The same file again changes nothing and writes no audit row.
    const again = await w.ha.upload('/api/admin/directory/arabic-names/apply', FILE);
    assert.equal(again.body.applied, 0);
    assert.equal(again.body.unchanged, 3);
    assert.equal(
      w.repo.auditLogs.filter((a) => a.action === 'directory.arabic_names.import').length,
      2
    );
  });

  test('a company admin’s import reaches only their own company', async () => {
    const w = await world();
    const preview = await w.caGen.upload('/api/admin/directory/arabic-names/preview', FILE);
    assert.deepEqual(
      preview.body.changes.map((c) => c.email),
      ['mahmoud.attia@genesismining-eg.com']
    );
    assert.deepEqual(preview.body.outOfScope, ['tarek.elmasry@masar.eg']);

    const res = await w.caGen.upload('/api/admin/directory/arabic-names/apply', FILE);
    assert.equal(res.body.applied, 1);
    assert.equal(
      w.repo.users.find((u) => u.email === 'tarek.elmasry@masar.eg').displayNameAr,
      'طارق المصري'
    );
    assert.ok(w.repo.auditLogs.every((a) => a.companyId === w.genId));

    for (const person of [w.gen, w.msr]) {
      for (const step of ['preview', 'apply']) {
        const refused = await person.upload(`/api/admin/directory/arabic-names/${step}`, FILE);
        assert.equal(refused.status, 403);
      }
    }
  });

  test('a file without the two columns, or empty, is refused', async () => {
    const w = await world();
    const url = '/api/admin/directory/arabic-names/preview';
    const noHeader = await w.ha.upload(url, 'a@b.eg,اسم\r\n');
    assert.equal(noHeader.status, 400);
    assert.equal(noHeader.body.error.code, 'csv_invalid');
    const empty = await w.ha.upload(url, '');
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, 'empty_upload');
    // Excel in an Arabic or European locale separates with semicolons.
    const semi = await w.ha.upload(
      url,
      'email;arabic_name\r\ndina.khalil@genesismining-eg.com;دينا\r\n'
    );
    assert.equal(semi.body.changes.length, 1);
  });
});

describe('data quality and sync permissions', () => {
  test('counts and lists what is missing, per company', async () => {
    const w = await world();
    await w.sync();
    const report = (await w.ha.get('/api/admin/directory/quality')).body;
    const gen = report.companies.find((c) => c.company.code === 'GEN');

    assert.equal(gen.activeUsers, 13); // 4 seeded + 10 new, one of them disabled
    assert.deepEqual(
      gen.lists.missingDepartment.map((p) => p.displayNameEn),
      ['Wael Ghoneim']
    );
    assert.equal(gen.counts.missingDepartment, 1);
    assert.equal(gen.counts.missingBusinessPhone, 1);
    assert.equal(gen.counts.missingJobTitle, 0);
    assert.equal(gen.counts.missingManager, 2); // the director and Wael
    assert.equal(gen.counts.missingArabicName, 9); // new, enabled GEN people

    const hld = report.companies.find((c) => c.company.code === 'HLD');
    assert.deepEqual(
      hld.lists.missingJobTitle.map((p) => p.displayNameEn),
      ['Samir Barakat']
    );
    assert.deepEqual(
      hld.lists.missingCompany.map((p) => p.displayNameEn),
      ['Amira Taha']
    );

    const msr = report.companies.find((c) => c.company.code === 'MSR');
    assert.deepEqual(msr.unmatchedDepartments, [{ name: 'Skunkworks', count: 1 }]);
    assert.deepEqual(
      report.unplaced.map((u) => u.email),
      ['chris.walker@contractor-partners.example']
    );
    assert.equal(report.latestRun.status, 'success');
  });

  test('the CSV export lists the same gaps and is audited', async () => {
    const w = await world();
    await w.sync();
    const res = await w.ha.get('/api/admin/directory/quality/export.csv');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.text, /"missingDepartment","Wael Ghoneim"/);
    assert.match(res.text, /"unmatchedDepartment".*Skunkworks \(1\)/);
    assert.match(res.text, /"unplacedUser"/);
    assert.ok(w.repo.auditLogs.some((a) => a.action === 'directory.quality.export'));
  });

  test('users read the directory but not the reports; only a HoldingAdmin runs sync', async () => {
    const w = await world();

    for (const person of [w.gen, w.msr]) {
      assert.equal((await person.get('/api/directory/people')).status, 200);
      assert.equal((await person.get('/api/admin/directory/quality')).status, 403);
      assert.equal((await person.get('/api/admin/directory/quality/export.csv')).status, 403);
      assert.equal((await person.get('/api/admin/directory/sync')).status, 403);
      assert.equal((await person.post('/api/admin/directory/sync')).status, 403);
    }

    // A CompanyAdmin sees the report for their own company only, and cannot sync.
    const own = await w.caGen.get('/api/admin/directory/quality');
    assert.equal(own.status, 200);
    assert.deepEqual(
      own.body.companies.map((c) => c.company.code),
      ['GEN']
    );
    assert.deepEqual(own.body.unplaced, []);
    const other = await w.caGen.get(`/api/admin/directory/quality?companyId=${w.msrId}`);
    assert.equal(other.status, 404);
    assert.equal((await w.caGen.get('/api/admin/directory/sync')).status, 403);
    assert.equal((await w.caGen.post('/api/admin/directory/sync')).status, 403);

    const anon = await request(w.app).get('/api/directory/people');
    assert.equal(anon.status, 401);
  });
});

describe('nightly schedule', () => {
  test('02:00 is read in Cairo time, across the daylight-saving change', () => {
    assert.deepEqual(cairoParts(new Date('2026-10-12T23:30:00Z')), {
      day: '2026-10-13',
      hour: 2,
    });
    assert.deepEqual(cairoParts(new Date('2026-12-01T00:30:00Z')), {
      day: '2026-12-01',
      hour: 2,
    });
  });

  test('runs once on a day, in the 02:00 hour only', async () => {
    const starts = [];
    const runner = { start: async (options) => starts.push(options.source) };
    let at = new Date('2026-10-12T22:00:00Z'); // 01:00 in Cairo
    const nightly = startNightlySync(runner, console, { now: () => at, checkMs: 3_600_000 });
    await nightly.tick();
    assert.equal(starts.length, 0);
    at = new Date('2026-10-12T23:05:00Z'); // 02:05
    await nightly.tick();
    await nightly.tick();
    assert.deepEqual(starts, ['schedule']);
    at = new Date('2026-10-13T23:05:00Z'); // the next night
    await nightly.tick();
    assert.equal(starts.length, 2);
    nightly.stop();
  });
});
