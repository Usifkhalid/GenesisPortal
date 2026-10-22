import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { createMemoryStorage } from '@mg/shared/server/lib/storage.js';
import { createAdminService } from '../src/modules/admin/service.js';
import { createMemoryAdminStore } from '../src/modules/admin/store-memory.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };

/** A 1x1 PNG, a JPEG and a WebP header: enough bytes to carry a signature. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x20, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(32, 1),
]);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
);

function build() {
  const repo = createMemoryUserRepo();
  const storage = createMemoryStorage();
  const app = createApp({
    config: DEV,
    userRepo: repo,
    storage,
    authRateLimit: { limit: 100_000 },
    rateLimit: { limit: 100_000 },
  });
  const company = (code) => repo.companies.find((c) => c.code === code);
  const userOf = (code, role) =>
    repo.users.find((u) => u.company.code === code && u.roles.some((r) => r.role === role));
  return { app, repo, storage, company, userOf };
}

/** An agent signed in as one seeded user, with helpers that carry the CSRF token. */
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
    put: (path, body) => send('put', path, body),
    del: (path) => send('delete', path),
    upload: (path, bytes, type = 'application/octet-stream') =>
      agent.put(path).set('X-CSRF-Token', csrf).set('Content-Type', type).send(bytes),
  };
}

/** Everyone the permission matrix needs, signed in. */
async function world() {
  const w = build();
  w.ha = await signIn(w.app, w.userOf('HLD', 'HoldingAdmin'));
  w.caGen = await signIn(w.app, w.userOf('GEN', 'CompanyAdmin'));
  w.caMsr = await signIn(w.app, w.userOf('MSR', 'CompanyAdmin'));
  w.user = await signIn(w.app, w.userOf('GEN', 'User'));
  w.newCompany = async (code = 'TST', domain = 'tst.example') => {
    const res = await w.ha.post('/api/admin/companies', {
      code,
      nameEn: 'Test Co',
      nameAr: 'شركة اختبار',
      domains: [domain],
      accentColor: '#1c7a4a',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  return w;
}

const audits = (w) => w.repo.auditLogs;

/** Runs `fn` and says how many audit rows it wrote. */
async function auditCount(w, fn) {
  const before = audits(w).length;
  const result = await fn();
  return { result, written: audits(w).length - before };
}

describe('permission matrix', () => {
  test('every admin endpoint allows and denies the right people', async () => {
    const w = await world();
    const gen = w.company('GEN');
    // Deactivating a company ends its people’s sessions, so the cases that
    // switch one off use a company none of the signed-in people belong to.
    const tst = await w.newCompany();
    const genDept = w.repo.departments.find((d) => d.companyId === gen.id);
    const fresh = async (path) => (await w.ha.get(path)).body;

    // Seed one audit row so the detail route has something to find.
    await w.ha.post('/api/admin/departments', {
      companyId: gen.id,
      nameEn: 'Matrix',
      nameAr: 'مصفوفة',
    });
    const rowId = audits(w).at(-1).id;
    assert.ok(rowId);

    // [label, call, who may use it (anyone else is refused), refusal status per role]
    const D = { user: 403, caGen: 403, caMsr: 403 };
    const cases = [
      ['GET scope', (a) => a.get('/api/admin/scope'), ['ha', 'caGen', 'caMsr'], { user: 403 }],
      ['GET companies', (a) => a.get('/api/admin/companies'), ['ha'], D],
      ['GET company', (a) => a.get(`/api/admin/companies/${gen.id}`), ['ha'], D],
      [
        'POST company',
        (a) =>
          a.post('/api/admin/companies', {
            code: 'ZZ',
            nameEn: 'Zed',
            nameAr: 'زد',
            domains: ['zz.example'],
            accentColor: '#1e5aa8',
          }),
        ['ha'],
        D,
      ],
      [
        'PATCH company',
        async (a) =>
          a.patch(`/api/admin/companies/${tst.id}`, {
            updatedAt: (await fresh(`/api/admin/companies/${tst.id}`)).updatedAt,
            nameEn: 'Masar Group',
          }),
        ['ha'],
        D,
      ],
      [
        'deactivate company',
        async (a) =>
          a.post(`/api/admin/companies/${tst.id}/deactivate`, {
            updatedAt: (await fresh(`/api/admin/companies/${tst.id}`)).updatedAt,
          }),
        ['ha'],
        D,
      ],
      [
        'reactivate company',
        async (a) =>
          a.post(`/api/admin/companies/${tst.id}/reactivate`, {
            updatedAt: (await fresh(`/api/admin/companies/${tst.id}`)).updatedAt,
          }),
        ['ha'],
        D,
      ],
      [
        'PUT logo',
        async (a) =>
          a.upload(
            `/api/admin/companies/${tst.id}/logo?updatedAt=${encodeURIComponent(
              (await fresh(`/api/admin/companies/${tst.id}`)).updatedAt
            )}`,
            PNG,
            'image/png'
          ),
        ['ha'],
        D,
      ],
      ['GET admins', (a) => a.get('/api/admin/admins'), ['ha'], D],
      ['GET people', (a) => a.get('/api/admin/people?q=na'), ['ha'], D],
      [
        'POST admins',
        (a) =>
          a.post('/api/admin/admins', {
            userId: w.userOf('MSR', 'User').id,
            role: 'CompanyAdmin',
            companyId: gen.id,
          }),
        ['ha'],
        D,
      ],
      [
        'GET departments (GEN)',
        (a) => a.get(`/api/admin/departments?companyId=${gen.id}`),
        ['ha', 'caGen'],
        { user: 403, caMsr: 404 },
      ],
      [
        'POST department (GEN)',
        (a) =>
          a.post('/api/admin/departments', {
            companyId: gen.id,
            nameEn: `Dept ${Math.random()}`,
            nameAr: `قسم ${Math.random()}`,
          }),
        ['ha', 'caGen'],
        { user: 403, caMsr: 404 },
      ],
      [
        'PATCH department (GEN)',
        async (a) =>
          a.patch(`/api/admin/departments/${genDept.id}`, {
            updatedAt: (
              await w.ha.get(`/api/admin/departments?companyId=${gen.id}`)
            ).body.items.find((d) => d.id === genDept.id).updatedAt,
            nameEn: `Renamed ${Math.random()}`,
          }),
        ['ha', 'caGen'],
        { user: 403, caMsr: 404 },
      ],
      ['GET audit', (a) => a.get('/api/admin/audit'), ['ha', 'caGen', 'caMsr'], { user: 403 }],
      [
        'GET audit facets',
        (a) => a.get('/api/admin/audit/facets'),
        ['ha', 'caGen', 'caMsr'],
        { user: 403 },
      ],
      [
        'GET audit export',
        (a) => a.get('/api/admin/audit/export.csv'),
        ['ha', 'caGen', 'caMsr'],
        { user: 403 },
      ],
      [
        'GET audit row (GEN)',
        (a) => a.get(`/api/admin/audit/${rowId}`),
        ['ha', 'caGen'],
        { user: 403, caMsr: 404 },
      ],
    ];

    const names = {
      ha: 'HoldingAdmin',
      caGen: 'CompanyAdmin GEN',
      caMsr: 'CompanyAdmin MSR',
      user: 'User',
    };

    for (const [label, call, allowed, refused] of cases) {
      for (const who of ['user', 'caGen', 'caMsr', 'ha']) {
        const res = await call(w[who]);
        if (allowed.includes(who)) {
          assert.ok(
            res.status >= 200 && res.status < 300,
            `${label}: ${names[who]} should be allowed, got ${res.status} ${JSON.stringify(res.body)}`
          );
        } else {
          assert.equal(res.status, refused[who] ?? 403, `${label}: ${names[who]}`);
        }
      }
    }
  });

  test('a signed-out request is refused and the audit log has no write routes', async () => {
    const w = await world();
    const anon = request(w.app);
    assert.equal((await anon.get('/api/admin/companies')).status, 401);
    assert.equal((await anon.get('/api/admin/audit')).status, 401);

    const someId = '11111111-1111-4111-8111-111111111111';
    for (const method of ['put', 'patch', 'delete', 'post']) {
      const res = await w.ha[method === 'delete' ? 'del' : method](
        `/api/admin/audit/${someId}`,
        method === 'delete' ? undefined : {}
      );
      assert.equal(res.status, 404, `${method} /audit/:id`);
    }
    assert.equal((await w.ha.post('/api/admin/audit', {})).status, 404);
  });
});

describe('companies', () => {
  test('create, read, edit and the audit rows they leave', async () => {
    const w = await world();

    const created = await auditCount(w, () => w.newCompany('TST', 'Tst.Example'));
    assert.equal(created.written, 1);
    const company = created.result;
    assert.equal(company.isActive, true);
    assert.deepEqual(company.domains, ['tst.example'], 'domains are lower-cased');
    assert.equal(company.logoKey, undefined, 'the storage key stays inside');

    const row = audits(w).at(-1);
    assert.equal(row.action, 'company.create');
    assert.equal(row.companyId, company.id);
    assert.equal(row.before, null);
    assert.equal(JSON.parse(row.after).code, 'TST');
    assert.equal(row.actorId, w.ha.user.id);

    const edited = await auditCount(w, () =>
      w.ha.patch(`/api/admin/companies/${company.id}`, {
        updatedAt: company.updatedAt,
        nameEn: 'Test Company',
        accentColor: '#1E5AA8',
      })
    );
    assert.equal(edited.result.status, 200);
    assert.equal(edited.written, 1);
    assert.equal(edited.result.body.accentColor, '#1e5aa8');

    const log = audits(w).at(-1);
    assert.equal(log.action, 'company.update');
    assert.equal(JSON.parse(log.before).nameEn, 'Test Co');
    assert.equal(JSON.parse(log.after).nameEn, 'Test Company');

    const listed = await w.ha.get('/api/admin/companies?status=active');
    assert.ok(listed.body.items.some((c) => c.code === 'TST' && c.userCount === 0));
  });

  test('the code is 2 to 5 capitals, unique, and cannot change', async () => {
    const w = await world();
    const base = {
      nameEn: 'X',
      nameAr: 'س',
      domains: ['x1.example'],
      accentColor: '#1c7a4a',
    };
    for (const code of ['T', 'TOOLONG', 'tst', 'T1', 'T-T']) {
      const res = await w.ha.post('/api/admin/companies', { ...base, code });
      assert.equal(res.status, 400, code);
      assert.equal(res.body.error.code, 'validation_failed');
    }

    const company = await w.newCompany('TST');
    const again = await w.ha.post('/api/admin/companies', {
      ...base,
      code: 'TST',
      domains: ['other.example'],
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'code_taken');

    const change = await w.ha.patch(`/api/admin/companies/${company.id}`, {
      updatedAt: company.updatedAt,
      code: 'NEW',
    });
    assert.equal(change.status, 400, 'code is not an editable field');
  });

  test('a mail domain belongs to one company, and must be a domain', async () => {
    const w = await world();
    const base = { code: 'TST', nameEn: 'X', nameAr: 'س', accentColor: '#1c7a4a' };

    const taken = await w.ha.post('/api/admin/companies', {
      ...base,
      domains: ['New.example', 'MASAR.eg'],
    });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, 'domain_taken');
    assert.equal(taken.body.error.details.domain, 'masar.eg');
    assert.equal(
      w.repo.companies.some((c) => c.code === 'TST'),
      false
    );

    for (const bad of [
      'nodot',
      'has space.com',
      '-bad.com',
      'a..b.com',
      'http://x.com',
      'x.c',
    ]) {
      const res = await w.ha.post('/api/admin/companies', { ...base, domains: [bad] });
      assert.equal(res.status, 400, bad);
    }

    const company = await w.newCompany('TST', 'tst.example');
    const steal = await w.ha.patch(`/api/admin/companies/${company.id}`, {
      updatedAt: company.updatedAt,
      domains: ['tst.example', 'genesismining-eg.com'],
    });
    assert.equal(steal.status, 409);

    const two = await w.ha.patch(`/api/admin/companies/${company.id}`, {
      updatedAt: company.updatedAt,
      domains: ['tst.example', 'tst2.example'],
    });
    assert.equal(two.status, 200);
    assert.deepEqual(two.body.domains, ['tst.example', 'tst2.example']);
  });

  test('a colour that is not a six-digit hex is refused', async () => {
    const w = await world();
    for (const accentColor of ['red', '#fff', '#12345g', 'rgb(0,0,0)', '1c7a4a']) {
      const res = await w.ha.post('/api/admin/companies', {
        code: 'TST',
        nameEn: 'X',
        nameAr: 'س',
        domains: ['x.example'],
        accentColor,
      });
      assert.equal(res.status, 400, accentColor);
    }
  });

  test('deactivate and reactivate: never a hard delete', async () => {
    const w = await world();
    const company = await w.newCompany();

    const off = await auditCount(w, () =>
      w.ha.post(`/api/admin/companies/${company.id}/deactivate`, {
        updatedAt: company.updatedAt,
      })
    );
    assert.equal(off.result.body.isActive, false);
    assert.equal(off.written, 1);
    assert.equal(audits(w).at(-1).action, 'company.deactivate');

    const on = await auditCount(w, () =>
      w.ha.post(`/api/admin/companies/${company.id}/reactivate`, {
        updatedAt: off.result.body.updatedAt,
      })
    );
    assert.equal(on.result.body.isActive, true);
    assert.equal(on.written, 1);

    const del = await w.ha.del(`/api/admin/companies/${company.id}`);
    assert.equal(del.status, 404, 'there is no delete');

    const filtered = await w.ha.get('/api/admin/companies?status=inactive');
    assert.equal(
      filtered.body.items.some((c) => c.id === company.id),
      false
    );
  });

  test('a stale updatedAt answers 409 and writes nothing', async () => {
    const w = await world();
    const company = await w.newCompany();

    const first = await w.ha.patch(`/api/admin/companies/${company.id}`, {
      updatedAt: company.updatedAt,
      nameEn: 'First edit',
    });
    assert.equal(first.status, 200);

    const { result, written } = await auditCount(w, () =>
      w.ha.patch(`/api/admin/companies/${company.id}`, {
        updatedAt: company.updatedAt,
        nameEn: 'Second edit from an old form',
      })
    );
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'stale_record');
    assert.equal(written, 0);
    assert.equal(
      (await w.ha.get(`/api/admin/companies/${company.id}`)).body.nameEn,
      'First edit'
    );

    const off = await w.ha.post(`/api/admin/companies/${company.id}/deactivate`, {
      updatedAt: company.updatedAt,
    });
    assert.equal(off.status, 409);
  });

  test('an unknown field is an error, not ignored', async () => {
    const w = await world();
    const company = await w.newCompany();
    const res = await w.ha.patch(`/api/admin/companies/${company.id}`, {
      updatedAt: company.updatedAt,
      nameEn: 'Fine',
      isActive: false,
    });
    assert.equal(res.status, 400);
  });
});

describe('logo', () => {
  async function putLogo(w, company, bytes, type) {
    return w.ha.upload(
      `/api/admin/companies/${company.id}/logo?updatedAt=${encodeURIComponent(company.updatedAt)}`,
      bytes,
      type
    );
  }

  test('PNG, JPEG and WebP are accepted and served with cache headers', async () => {
    const w = await world();
    let company = await w.newCompany();

    for (const [bytes, type] of [
      [PNG, 'image/png'],
      [JPEG, 'image/jpeg'],
      [WEBP, 'image/webp'],
    ]) {
      const { result, written } = await auditCount(w, () => putLogo(w, company, bytes, type));
      assert.equal(result.status, 200, type);
      assert.equal(written, 1);
      company = result.body;
      assert.match(company.logoUrl, /^\/api\/companies\/[^/]+\/logo\?v=/);

      const served = await w.ha.get(company.logoUrl);
      assert.equal(served.status, 200);
      assert.equal(served.headers['content-type'], type);
      assert.match(served.headers['cache-control'], /max-age=31536000/);
      assert.match(served.headers['cache-control'], /immutable/);
      assert.deepEqual(served.body, bytes);
    }
  });

  test('SVG, oversize and a renamed non-image are refused, and nothing is stored', async () => {
    const w = await world();
    const company = await w.newCompany();

    const svg = await putLogo(w, company, SVG, 'image/svg+xml');
    assert.equal(svg.status, 415);
    assert.equal(svg.body.error.code, 'unsupported_image');

    // A script claiming to be a PNG: the content type is the client's claim.
    const renamed = await putLogo(
      w,
      company,
      Buffer.from('MZ not an image at all....'),
      'image/png'
    );
    assert.equal(renamed.status, 415);

    // SVG markup behind a PNG content type.
    const disguised = await putLogo(w, company, SVG, 'image/png');
    assert.equal(disguised.status, 415);

    const big = await putLogo(
      w,
      company,
      Buffer.concat([PNG, Buffer.alloc(600 * 1024)]),
      'image/png'
    );
    assert.equal(big.status, 413);

    const empty = await putLogo(w, company, Buffer.alloc(0), 'image/png');
    assert.equal(empty.status, 400);

    assert.equal(w.storage.files.size, 0);
    assert.equal(audits(w).filter((r) => r.action.startsWith('company.logo')).length, 0);
  });

  test('replacing a logo removes the old file; removing it removes the last', async () => {
    const w = await world();
    const company = await w.newCompany();

    const one = await putLogo(w, company, PNG, 'image/png');
    assert.equal(w.storage.files.size, 1);
    const [firstKey] = [...w.storage.files.keys()];

    const two = await putLogo(w, one.body, JPEG, 'image/jpeg');
    assert.equal(two.status, 200);
    assert.equal(w.storage.files.size, 1);
    assert.equal(w.storage.files.has(firstKey), false);

    const gone = await auditCount(w, () =>
      w.ha.del(
        `/api/admin/companies/${company.id}/logo?updatedAt=${encodeURIComponent(two.body.updatedAt)}`
      )
    );
    assert.equal(gone.result.status, 200);
    assert.equal(gone.written, 1);
    assert.equal(gone.result.body.logoUrl, null);
    assert.equal(w.storage.files.size, 0);
  });

  test('a stale upload is a 409 and leaves no file behind', async () => {
    const w = await world();
    const company = await w.newCompany();
    await w.ha.patch(`/api/admin/companies/${company.id}`, {
      updatedAt: company.updatedAt,
      nameEn: 'Moved on',
    });

    const res = await putLogo(w, company, PNG, 'image/png');
    assert.equal(res.status, 409);
    assert.equal(w.storage.files.size, 0);
  });

  test('the logo route needs a session and the right company', async () => {
    const w = await world();
    const company = await w.newCompany();
    const done = await putLogo(w, company, PNG, 'image/png');
    const url = done.body.logoUrl;

    assert.equal((await request(w.app).get(url)).status, 401);
    // A GEN user may not see TST's files; the response does not say they exist.
    assert.equal((await w.user.get(url)).status, 404);
    assert.equal((await w.ha.get(`/api/companies/${w.company('GEN').id}/logo`)).status, 404);
  });
});

describe('departments', () => {
  test('names are unique per company, in both languages', async () => {
    const w = await world();
    const gen = w.company('GEN');
    const make = (nameEn, nameAr) =>
      w.caGen.post('/api/admin/departments', { companyId: gen.id, nameEn, nameAr });

    const ok = await auditCount(w, () => make('Logistics', 'اللوجستيات'));
    assert.equal(ok.result.status, 201);
    assert.equal(ok.written, 1);

    const sameEn = await make('Logistics', 'شيء آخر');
    assert.equal(sameEn.status, 409);
    assert.equal(sameEn.body.error.code, 'department_name_taken');
    assert.equal(sameEn.body.error.details.field, 'nameEn');

    const sameAr = await make('Something else', 'اللوجستيات');
    assert.equal(sameAr.status, 409);
    assert.equal(sameAr.body.error.details.field, 'nameAr');

    // Another company may reuse the names.
    const msr = await w.caMsr.post('/api/admin/departments', {
      companyId: w.company('MSR').id,
      nameEn: 'Logistics',
      nameAr: 'اللوجستيات',
    });
    assert.equal(msr.status, 201);
  });

  test('edit, deactivate and reactivate each leave one audit row', async () => {
    const w = await world();
    const gen = w.company('GEN');
    let dept = (
      await w.caGen.post('/api/admin/departments', {
        companyId: gen.id,
        nameEn: 'Lab',
        nameAr: 'المختبر',
      })
    ).body;

    const edit = await auditCount(w, () =>
      w.caGen.patch(`/api/admin/departments/${dept.id}`, {
        updatedAt: dept.updatedAt,
        nameEn: 'Laboratory',
      })
    );
    assert.equal(edit.result.status, 200);
    assert.equal(edit.written, 1);
    dept = edit.result.body;

    const off = await auditCount(w, () =>
      w.caGen.post(`/api/admin/departments/${dept.id}/deactivate`, {
        updatedAt: dept.updatedAt,
      })
    );
    assert.equal(off.result.body.isActive, false);
    assert.equal(off.written, 1);

    const on = await auditCount(w, () =>
      w.caGen.post(`/api/admin/departments/${dept.id}/reactivate`, {
        updatedAt: off.result.body.updatedAt,
      })
    );
    assert.equal(on.result.body.isActive, true);
    assert.equal(on.written, 1);

    const stale = await w.caGen.patch(`/api/admin/departments/${dept.id}`, {
      updatedAt: dept.updatedAt,
      nameEn: 'Old form',
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'stale_record');
  });

  test('a department with people in it is deactivated, and they keep it', async () => {
    const w = await world();
    const gen = w.company('GEN');
    const list = await w.caGen.get(`/api/admin/departments?companyId=${gen.id}`);
    const used = list.body.items.find((d) => d.userCount > 0);
    assert.ok(used, 'the seed puts someone in a department');

    const res = await w.caGen.post(`/api/admin/departments/${used.id}/deactivate`, {
      updatedAt: used.updatedAt,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.userCount, used.userCount);
    assert.equal((await w.caGen.del(`/api/admin/departments/${used.id}`)).status, 404);
  });

  test('a CompanyAdmin cannot read or change another company’s departments', async () => {
    const w = await world();
    const msr = w.company('MSR');
    const msrDept = w.repo.departments.find((d) => d.companyId === msr.id);

    const list = await w.caGen.get(`/api/admin/departments?companyId=${msr.id}`);
    assert.equal(list.status, 404);

    const { written, result } = await auditCount(w, async () => ({
      create: await w.caGen.post('/api/admin/departments', {
        companyId: msr.id,
        nameEn: 'Sneaky',
        nameAr: 'خفي',
      }),
      patch: await w.caGen.patch(`/api/admin/departments/${msrDept.id}`, {
        updatedAt: msrDept.updatedAt.toISOString(),
        nameEn: 'Hijacked',
      }),
      off: await w.caGen.post(`/api/admin/departments/${msrDept.id}/deactivate`, {
        updatedAt: msrDept.updatedAt.toISOString(),
      }),
    }));
    assert.equal(result.create.status, 404);
    assert.equal(result.patch.status, 404);
    assert.equal(result.off.status, 404);
    assert.equal(written, 0);
    assert.equal(msrDept.nameEn, 'Projects');
    assert.equal(msrDept.isActive, true);

    // With no companyId a CompanyAdmin lands on their own company.
    const own = await w.caGen.get('/api/admin/departments');
    assert.equal(own.status, 200);
    assert.equal(own.body.companyId, w.company('GEN').id);
  });
});

describe('admins', () => {
  test('assign and remove a CompanyAdmin, one audit row each', async () => {
    const w = await world();
    const company = await w.newCompany();
    const person = w.userOf('GEN', 'User');

    const assigned = await auditCount(w, () =>
      w.ha.post('/api/admin/admins', {
        userId: person.id,
        role: 'CompanyAdmin',
        companyId: company.id,
      })
    );
    assert.equal(assigned.result.status, 201);
    assert.equal(assigned.written, 1);
    const row = audits(w).at(-1);
    assert.equal(row.action, 'role.assign');
    assert.equal(row.companyId, company.id, 'filed under the company they now administer');

    const listed = await w.ha.get('/api/admin/admins');
    const group = listed.body.companies.find((g) => g.company.id === company.id);
    assert.deepEqual(
      group.admins.map((a) => a.user.id),
      [person.id]
    );

    // They are now an admin of TST and of nothing else.
    const asNew = await signIn(w.app, person);
    const scope = await asNew.get('/api/admin/scope');
    assert.deepEqual(
      scope.body.companies.map((c) => c.code),
      ['TST']
    );
    assert.equal(
      (await asNew.get(`/api/admin/departments?companyId=${w.company('GEN').id}`)).status,
      403
    );

    const dup = await w.ha.post('/api/admin/admins', {
      userId: person.id,
      role: 'CompanyAdmin',
      companyId: company.id,
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'already_assigned');

    const removed = await auditCount(w, () =>
      w.ha.del(`/api/admin/admins/${assigned.result.body.id}`)
    );
    assert.equal(removed.result.status, 200);
    assert.equal(removed.written, 1);
    assert.equal(audits(w).at(-1).action, 'role.remove');
    // A change of role ends the session it was held in (OWASP: renew on
    // privilege change); signed in again, the person is a plain user.
    assert.equal((await asNew.get('/api/admin/scope')).status, 401, 'session ended at once');
    const again = await signIn(w.app, person);
    assert.equal((await again.get('/api/admin/scope')).status, 403, 'and the role is gone');
  });

  test('a holding admin cannot remove their own role', async () => {
    const w = await world();
    const mine = w.ha.user.roles.find((r) => r.role === 'HoldingAdmin');

    const { result, written } = await auditCount(w, () =>
      w.ha.del(`/api/admin/admins/${mine.id}`)
    );
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'cannot_remove_own_role');
    assert.equal(written, 0);
  });

  test('another holding admin can be removed, until they are the last', async () => {
    const w = await world();
    const second = w.userOf('GEN', 'User');
    const made = await w.ha.post('/api/admin/admins', {
      userId: second.id,
      role: 'HoldingAdmin',
    });
    assert.equal(made.status, 201);

    const removed = await w.ha.del(`/api/admin/admins/${made.body.id}`);
    assert.equal(removed.status, 200);

    // The guard itself, with an actor whose own assignment is not the target:
    // the only active holding admin's assignment cannot be removed.
    const sole = w.ha.user.roles.find((r) => r.role === 'HoldingAdmin');
    const service = createAdminService({
      store: createMemoryAdminStore(w.repo),
      storage: createMemoryStorage(),
    });
    const outsider = {
      user: {
        id: 'not-in-the-store',
        companyId: w.company('HLD').id,
        roles: [{ role: 'HoldingAdmin', scopeCompanyId: null }],
      },
    };
    await assert.rejects(
      () => service.removeRole(outsider, sole.id),
      (err) => err.status === 409 && err.code === 'last_holding_admin'
    );
    assert.ok(w.ha.user.roles.some((r) => r.id === sole.id));
  });

  test('a CompanyAdmin needs a company, a HoldingAdmin must not name one', async () => {
    const w = await world();
    const person = w.userOf('GEN', 'User').id;
    const gen = w.company('GEN').id;
    for (const body of [
      { userId: person, role: 'CompanyAdmin' },
      { userId: person, role: 'HoldingAdmin', companyId: gen },
      { userId: person, role: 'User', companyId: gen },
      { userId: 'nope', role: 'HoldingAdmin' },
    ]) {
      assert.equal(
        (await w.ha.post('/api/admin/admins', body)).status,
        400,
        JSON.stringify(body)
      );
    }
    const missing = await w.ha.post('/api/admin/admins', {
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'HoldingAdmin',
    });
    assert.equal(missing.status, 404);
  });

  test('people are found by English name, Arabic name and email', async () => {
    const w = await world();
    const target = w.userOf('MSR', 'User');
    const byEn = await w.ha.get(
      `/api/admin/people?q=${encodeURIComponent(target.displayNameEn.slice(0, 4))}`
    );
    assert.ok(byEn.body.items.some((p) => p.id === target.id));
    const byAr = await w.ha.get(
      `/api/admin/people?q=${encodeURIComponent(target.displayNameAr.slice(0, 3))}`
    );
    assert.ok(byAr.body.items.some((p) => p.id === target.id));
    const byMail = await w.ha.get(`/api/admin/people?q=${encodeURIComponent(target.email)}`);
    assert.equal(byMail.body.items[0].id, target.id);
    assert.equal((await w.ha.get('/api/admin/people?q=a')).status, 400);
  });
});

describe('audit log', () => {
  async function activity(w) {
    const company = await w.newCompany();
    await w.caGen.post('/api/admin/departments', {
      companyId: w.company('GEN').id,
      nameEn: 'Audit One',
      nameAr: 'تدقيق ١',
    });
    await w.caMsr.post('/api/admin/departments', {
      companyId: w.company('MSR').id,
      nameEn: 'Audit Two',
      nameAr: 'تدقيق ٢',
    });
    return company;
  }

  test('a CompanyAdmin sees only their own company’s entries', async () => {
    const w = await world();
    await activity(w);
    const gen = w.company('GEN');

    const res = await w.caGen.get('/api/admin/audit?pageSize=100');
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length >= 1);
    assert.ok(res.body.items.every((r) => r.companyId === gen.id));

    const all = await w.ha.get('/api/admin/audit?pageSize=100');
    assert.ok(all.body.total > res.body.total);

    const msrRow = audits(w).find((r) => r.companyId === w.company('MSR').id);
    assert.equal((await w.caGen.get(`/api/admin/audit/${msrRow.id}`)).status, 404);
    assert.equal(
      (await w.caGen.get(`/api/admin/audit?companyId=${w.company('MSR').id}`)).status,
      404
    );
    assert.equal((await w.caGen.get('/api/admin/audit?companyId=holding')).status, 404);

    const csv = await w.caGen.get('/api/admin/audit/export.csv');
    assert.equal(csv.status, 200);
    assert.ok(!csv.text.includes('Audit Two'), 'the export is scoped like the list');
    assert.ok(csv.text.includes('Audit One'));
  });

  test('filters by company, action, entity, actor and Cairo date; newest first', async () => {
    const w = await world();
    const company = await activity(w);

    const byCompany = await w.ha.get(`/api/admin/audit?companyId=${company.id}`);
    assert.ok(byCompany.body.items.every((r) => r.companyId === company.id));

    const byAction = await w.ha.get('/api/admin/audit?action=department.create');
    assert.equal(byAction.body.total, 2);

    const byEntity = await w.ha.get('/api/admin/audit?entity=Company');
    assert.ok(byEntity.body.items.every((r) => r.entity === 'Company'));

    const byActor = await w.ha.get(`/api/admin/audit?actorId=${w.caMsr.user.id}`);
    assert.equal(byActor.body.total, 1);

    const times = (await w.ha.get('/api/admin/audit?pageSize=100')).body.items.map((r) =>
      Date.parse(r.at)
    );
    assert.deepEqual(
      times,
      [...times].sort((a, b) => b - a)
    );

    // Cairo's calendar day: an entry made now is in today's Cairo date.
    const cairoToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(
      new Date()
    );
    const today = await w.ha.get(`/api/admin/audit?from=${cairoToday}&to=${cairoToday}`);
    assert.equal(today.body.total, audits(w).length);
    const past = await w.ha.get('/api/admin/audit?from=2020-01-01&to=2020-01-31');
    assert.equal(past.body.total, 0);

    // A row written at 23:30 UTC on 30 Jan is 01:30 on 31 Jan in Cairo (UTC+2).
    audits(w).push({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      at: new Date('2026-01-30T23:30:00Z'),
      actorId: null,
      companyId: null,
      action: 'test.edge',
      entity: 'Edge',
      entityId: null,
      before: null,
      after: null,
      ip: null,
    });
    const jan31 = await w.ha.get(
      '/api/admin/audit?from=2026-01-31&to=2026-01-31&action=test.edge'
    );
    assert.equal(jan31.body.total, 1);
    const jan30 = await w.ha.get(
      '/api/admin/audit?from=2026-01-30&to=2026-01-30&action=test.edge'
    );
    assert.equal(jan30.body.total, 0);

    assert.equal((await w.ha.get('/api/admin/audit?from=2026-13-40')).status, 400);
  });

  test('paginates', async () => {
    const w = await world();
    for (let i = 0; i < 12; i += 1) {
      await w.caGen.post('/api/admin/departments', {
        companyId: w.company('GEN').id,
        nameEn: `Page ${i}`,
        nameAr: `صفحة ${i}`,
      });
    }
    const p1 = await w.ha.get('/api/admin/audit?pageSize=10&page=1');
    const p2 = await w.ha.get('/api/admin/audit?pageSize=10&page=2');
    assert.equal(p1.body.items.length, 10);
    assert.equal(p1.body.total, 12);
    assert.equal(p2.body.items.length, 2);
    assert.notEqual(p1.body.items[0].id, p2.body.items[0].id);
  });

  test('the detail carries before and after; the export is itself logged', async () => {
    const w = await world();
    const company = await w.newCompany();
    await w.ha.patch(`/api/admin/companies/${company.id}`, {
      updatedAt: company.updatedAt,
      nameEn: 'Renamed',
    });
    const row = audits(w).at(-1);
    const detail = await w.ha.get(`/api/admin/audit/${row.id}`);
    assert.equal(detail.body.before.nameEn, 'Test Co');
    assert.equal(detail.body.after.nameEn, 'Renamed');

    const { result, written } = await auditCount(w, () =>
      w.ha.get('/api/admin/audit/export.csv?action=company.update')
    );
    assert.equal(result.status, 200);
    assert.match(result.headers['content-type'], /text\/csv/);
    assert.match(result.headers['content-disposition'], /attachment/);
    assert.equal(written, 1);
    const logged = audits(w).at(-1);
    assert.equal(logged.action, 'audit.export');
    assert.equal(JSON.parse(logged.after).filter.action, 'company.update');
    assert.equal(JSON.parse(logged.after).rows, 1);
  });

  test('a spreadsheet formula in a name stays text in the export', async () => {
    const w = await world();
    await w.ha.post('/api/admin/companies', {
      code: 'EVL',
      nameEn: '=HYPERLINK("http://evil.example")',
      nameAr: 'س',
      domains: ['evil.example'],
      accentColor: '#1c7a4a',
    });
    const csv = (await w.ha.get('/api/admin/audit/export.csv?action=company.create')).text;
    // The name sits inside the JSON in the "after" column, which starts with {.
    assert.ok(csv.includes('HYPERLINK'));
    assert.ok(!/(^|,)"=/.test(csv.replaceAll('\r\n', '\n')));
  });

  test('facets list what the person may filter by', async () => {
    const w = await world();
    await activity(w);
    const ha = await w.ha.get('/api/admin/audit/facets');
    assert.ok(ha.body.actions.includes('company.create'));
    assert.ok(ha.body.entities.includes('Department'));
    assert.ok(ha.body.actors.length >= 3);

    const gen = await w.caGen.get('/api/admin/audit/facets');
    assert.deepEqual(
      gen.body.actors.map((a) => a.id),
      [w.caGen.user.id]
    );
    assert.deepEqual(
      gen.body.companies.map((c) => c.code),
      ['GEN']
    );
  });
});

describe('every write creates exactly one audit entry', () => {
  test('writes that are refused create none', async () => {
    const w = await world();
    const gen = w.company('GEN');

    const attempts = await auditCount(w, async () => [
      await w.user.post('/api/admin/companies', {}),
      await w.caGen.post('/api/admin/companies', {}),
      await w.ha.post('/api/admin/companies', { code: 'x' }),
      await w.caMsr.post('/api/admin/departments', {
        companyId: gen.id,
        nameEn: 'No',
        nameAr: 'لا',
      }),
      await w.ha.post('/api/admin/admins', { role: 'HoldingAdmin' }),
    ]);
    assert.equal(attempts.written, 0);
    assert.deepEqual(
      attempts.result.map((r) => r.status),
      [403, 403, 400, 404, 400]
    );
  });
});
