import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import {
  isSafeUrl,
  plainText,
  renderMarkdown,
  sanitizeMarkdown,
} from '@mg/shared/web/assets/js/markdown.js';
import { createApp } from '../src/app.js';
import { createMemoryStorage } from '@mg/shared/server/lib/storage.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
]);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
);

const HOUR = 3_600_000;

function build() {
  const repo = createMemoryUserRepo();
  const storage = createMemoryStorage();
  const clock = { at: new Date('2026-10-12T09:00:00Z') };
  const app = createApp({
    config: DEV,
    userRepo: repo,
    storage,
    now: () => new Date(clock.at),
    authRateLimit: { limit: 100_000 },
    rateLimit: { limit: 100_000 },
  });
  const company = (code) => repo.companies.find((c) => c.code === code);
  const userOf = (code, role) =>
    repo.users.find((u) => u.company.code === code && u.roles.some((r) => r.role === role));
  return { app, repo, storage, clock, company, userOf };
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
    del: (path) => send('delete', path),
    upload: (path, bytes) =>
      agent.put(path).set('X-CSRF-Token', csrf).set('Content-Type', 'image/png').send(bytes),
  };
}

async function world() {
  const w = build();
  w.ha = await signIn(w.app, w.userOf('HLD', 'HoldingAdmin'));
  w.caGen = await signIn(w.app, w.userOf('GEN', 'CompanyAdmin'));
  w.caMsr = await signIn(w.app, w.userOf('MSR', 'CompanyAdmin'));
  w.gen = await signIn(w.app, w.userOf('GEN', 'User'));
  w.msr = await signIn(w.app, w.userOf('MSR', 'User'));
  w.genId = w.company('GEN').id;
  w.msrId = w.company('MSR').id;

  /** Creates and publishes a post, returns it. */
  w.post = async (admin, overrides = {}, { publish = true } = {}) => {
    const res = await admin.post('/api/admin/announcements', {
      companyId: w.genId,
      titleEn: 'Safety week',
      bodyEn: 'Wear your **helmet**.',
      category: 'HSE',
      ...overrides,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    if (!publish) return res.body;
    const out = await admin.post(`/api/admin/announcements/${res.body.id}/publish`, {
      updatedAt: res.body.updatedAt,
    });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    return out.body;
  };
  const ids = async (person, query = '') =>
    (await person.get(`/api/announcements${query}`)).body.items.map((i) => i.id);
  w.ids = ids;
  return w;
}

describe('markdown', () => {
  test('renders the supported subset', () => {
    const html = renderMarkdown(
      '# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two\n\n1. first\n2. second\n\n[site](https://example.com/a?b=1&c=2)'
    );
    assert.match(html, /<h2>Title<\/h2>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
    assert.match(
      html,
      /<a href="https:\/\/example.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site<\/a>/
    );
  });

  test('markup is text, never markup', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>**'
    );
    assert.doesNotMatch(html, /<script|<img|<b>/i);
    assert.match(html, /&lt;script&gt;/);
  });

  test('unsafe link addresses are reduced to their text, in every spelling', () => {
    const attempts = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      '&#106;avascript:alert(1)',
      'java%0ascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      '//evil.example/x',
    ];
    for (const url of attempts) {
      const html = renderMarkdown(`[click](${url})`);
      assert.doesNotMatch(html, /<a\b/i, url);
      assert.match(html, /click/);
      assert.equal(isSafeUrl(url), false, url);
    }
  });

  test('a quote in an address cannot leave the attribute', () => {
    const html = renderMarkdown('[x](https://e.example/"onmouseover="alert(1))');
    assert.doesNotMatch(html, /onmouseover="alert/);
  });

  test('sanitising on save strips tags, comments and control characters', () => {
    const nul = String.fromCharCode(0);
    const bidiOverride = String.fromCharCode(0x202e);
    const saved = sanitizeMarkdown(
      `Hi <script>alert(1)</script><!-- c --> [bad](javascript:x) [ok](https://a.example)${nul}${bidiOverride}`
    );
    assert.doesNotMatch(saved, /<|javascript/);
    assert.equal(saved.includes(nul), false);
    assert.equal(saved.includes(bidiOverride), false);
    assert.ok(saved.includes('[ok](https://a.example)'));
    assert.match(saved, /bad/);
  });

  test('plain text drops the syntax', () => {
    assert.equal(plainText('# Hi\n\n**bold** [link](https://a.example)'), 'Hi bold link');
  });
});

describe('visibility', () => {
  test('company and holding-wide posts reach the right readers', async () => {
    const w = await world();
    const genPost = await w.post(w.caGen, { titleEn: 'Genesis only' });
    const msrPost = await w.post(w.caMsr, { companyId: w.msrId, titleEn: 'Masar only' });
    const holding = await w.post(w.ha, { companyId: null, titleEn: 'Everyone' });

    assert.deepEqual((await w.ids(w.gen)).sort(), [genPost.id, holding.id].sort());
    assert.deepEqual((await w.ids(w.msr)).sort(), [msrPost.id, holding.id].sort());
    assert.deepEqual((await w.ids(w.caGen)).sort(), [genPost.id, holding.id].sort());
    // The holding admin reads as a person of HLD: their own company and the group's.
    assert.deepEqual(await w.ids(w.ha), [holding.id]);

    // Opening someone else's post is a 404, not a 403: it is not disclosed.
    assert.equal((await w.msr.get(`/api/announcements/${genPost.id}`)).status, 404);
    assert.equal((await w.gen.get(`/api/announcements/${msrPost.id}`)).status, 404);
    assert.equal((await w.gen.get(`/api/announcements/${holding.id}`)).status, 200);
  });

  test('a client cannot widen the audience with a companyId query', async () => {
    const w = await world();
    const msrPost = await w.post(w.caMsr, { companyId: w.msrId });
    const res = await w.gen.get(`/api/announcements?companyId=${w.msrId}`);
    assert.equal(res.status, 400);
    assert.deepEqual(await w.ids(w.gen), []);
    assert.equal((await w.gen.get(`/api/announcements/${msrPost.id}/cover`)).status, 404);
  });

  test('drafts and scheduled posts are invisible to readers until their time', async () => {
    const w = await world();
    const draft = await w.post(w.caGen, { titleEn: 'Draft' }, { publish: false });
    const soon = new Date(w.clock.at.getTime() + 2 * HOUR).toISOString();
    const created = await w.post(
      w.caGen,
      { titleEn: 'Scheduled', publishAt: soon },
      { publish: false }
    );
    assert.equal(created.status, 'Scheduled');

    assert.deepEqual(await w.ids(w.gen), []);
    assert.equal((await w.gen.get(`/api/announcements/${draft.id}`)).status, 404);
    assert.equal((await w.gen.get(`/api/announcements/${created.id}`)).status, 404);

    w.clock.at = new Date(w.clock.at.getTime() + 3 * HOUR);
    assert.deepEqual(await w.ids(w.gen), [created.id]);
  });

  test('an expired post disappears for readers and stays for admins', async () => {
    const w = await world();
    const expires = new Date(w.clock.at.getTime() + HOUR).toISOString();
    const post = await w.post(w.caGen, { expiresAt: expires });
    assert.deepEqual(await w.ids(w.gen), [post.id]);

    w.clock.at = new Date(w.clock.at.getTime() + 2 * HOUR);
    assert.deepEqual(await w.ids(w.gen), []);
    assert.equal((await w.gen.get(`/api/announcements/${post.id}`)).status, 404);

    const list = await w.caGen.get('/api/admin/announcements?status=Expired');
    assert.deepEqual(
      list.body.items.map((i) => i.id),
      [post.id]
    );
    assert.equal(list.body.items[0].status, 'Expired');
  });

  test('unpublishing takes a post away at once, and nothing is deleted', async () => {
    const w = await world();
    const post = await w.post(w.caGen);
    assert.deepEqual(await w.ids(w.gen), [post.id]);

    const res = await w.caGen.post(`/api/admin/announcements/${post.id}/unpublish`, {
      updatedAt: post.updatedAt,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'Draft');
    assert.deepEqual(await w.ids(w.gen), []);
  });

  test('pinned first, then newest; filters and paging', async () => {
    const w = await world();
    const a = await w.post(w.caGen, { titleEn: 'A', category: 'IT' });
    w.clock.at = new Date(w.clock.at.getTime() + HOUR);
    const b = await w.post(w.caGen, { titleEn: 'B', category: 'HR' });
    w.clock.at = new Date(w.clock.at.getTime() + HOUR);
    const c = await w.post(w.caGen, { titleEn: 'C', category: 'IT', isPinned: true });
    w.clock.at = new Date(w.clock.at.getTime() + HOUR);

    assert.deepEqual(await w.ids(w.gen), [c.id, b.id, a.id]);
    assert.deepEqual(await w.ids(w.gen, '?category=IT'), [c.id, a.id]);

    const page = await w.gen.get('/api/announcements?pageSize=2&page=2');
    assert.deepEqual(
      page.body.items.map((i) => i.id),
      [a.id]
    );
    assert.equal(page.body.total, 3);
  });
});

describe('reading', () => {
  test('opening marks read once; unread count and the unread filter follow', async () => {
    const w = await world();
    const one = await w.post(w.caGen, { titleEn: 'One' });
    const two = await w.post(w.caGen, { titleEn: 'Two' });

    assert.equal((await w.gen.get('/api/announcements/unread-count')).body.count, 2);
    const before = await w.gen.get('/api/announcements');
    assert.equal(before.body.unreadCount, 2);
    assert.ok(before.body.items.every((i) => i.isRead === false));

    const opened = await w.gen.get(`/api/announcements/${one.id}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.isRead, true);
    await w.gen.get(`/api/announcements/${one.id}`);

    assert.equal((await w.gen.get('/api/announcements/unread-count')).body.count, 1);
    assert.deepEqual(await w.ids(w.gen, '?unread=true'), [two.id]);

    // Reading is per person.
    assert.equal((await w.caGen.get('/api/announcements/unread-count')).body.count, 2);
    assert.equal(w.repo.announcementReads.length, 1);
  });

  test('admins see "read by X of Y" for the audience', async () => {
    const w = await world();
    const genUsers = w.repo.users.filter((u) => u.companyId === w.genId && u.isActive).length;
    const post = await w.post(w.caGen);
    await w.gen.get(`/api/announcements/${post.id}`);

    const detail = await w.caGen.get(`/api/admin/announcements/${post.id}`);
    assert.deepEqual(detail.body.readStats, { read: 1, audience: genUsers });
    const list = await w.caGen.get('/api/admin/announcements');
    assert.deepEqual(list.body.items[0].readStats, { read: 1, audience: genUsers });

    const everyone = w.repo.users.filter((u) => u.isActive).length;
    const wide = await w.post(w.ha, { companyId: null });
    const wideDetail = await w.ha.get(`/api/admin/announcements/${wide.id}`);
    assert.deepEqual(wideDetail.body.readStats, { read: 0, audience: everyone });
  });
});

describe('languages', () => {
  test('one complete language is enough; the other is flagged for admins', async () => {
    const w = await world();
    const post = await w.post(w.caGen, {
      titleEn: '',
      bodyEn: '',
      titleAr: 'أسبوع السلامة',
      bodyAr: 'ارتدِ **الخوذة**.',
    });
    assert.deepEqual(post.translationMissing, { en: true, ar: false });

    const read = await w.gen.get(`/api/announcements/${post.id}`);
    assert.deepEqual(read.body.languages, { en: false, ar: true });
    assert.match(read.body.bodyHtmlAr, /<strong>الخوذة<\/strong>/);
    assert.equal(read.body.bodyHtmlEn, '');
  });

  test('a post with no complete language cannot be published; a draft needs a title', async () => {
    const w = await world();
    const none = await w.caGen.post('/api/admin/announcements', { companyId: w.genId });
    assert.equal(none.status, 400);
    assert.equal(none.body.error.code, 'title_required');

    const half = await w.post(
      w.caGen,
      { titleEn: 'Title only', bodyEn: '' },
      { publish: false }
    );
    const res = await w.caGen.post(`/api/admin/announcements/${half.id}/publish`, {
      updatedAt: half.updatedAt,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'language_incomplete');
  });

  test('a summary left empty falls back to the start of the body', async () => {
    const w = await world();
    const post = await w.post(w.caGen, { bodyEn: '# Heading\n\nFirst **line** here.' });
    const list = await w.gen.get('/api/announcements');
    assert.equal(list.body.items[0].summaryEn, 'Heading First line here.');
    assert.equal(list.body.items[0].id, post.id);
  });
});

describe('hostile content', () => {
  test('script and javascript: links never come back as markup', async () => {
    const w = await world();
    const post = await w.post(w.caGen, {
      titleEn: '<img src=x onerror=alert(1)>Title',
      bodyEn:
        '<script>alert(1)</script>\n\n[a](javascript:alert(1)) [b](data:text/html,x) [c](https://ok.example)',
      summaryEn: '<b onmouseover=alert(1)>sum</b>',
    });
    const res = await w.gen.get(`/api/announcements/${post.id}`);
    const all = JSON.stringify(res.body);
    assert.doesNotMatch(res.body.bodyHtmlEn, /<script|javascript:|data:/i);
    assert.doesNotMatch(all, /<img|<b |<script/i);
    assert.match(res.body.bodyHtmlEn, /href="https:\/\/ok.example"/);

    // The stored text is clean too, not only the render.
    const stored = await w.caGen.get(`/api/admin/announcements/${post.id}`);
    assert.doesNotMatch(stored.body.bodyEn, /<script|javascript:/i);
  });
});

describe('writing', () => {
  test('a company admin writes for their company only; holding-wide is the holding admin’s', async () => {
    const w = await world();
    const msr = await w.caGen.post('/api/admin/announcements', {
      companyId: w.msrId,
      titleEn: 'Nope',
    });
    assert.equal(msr.status, 404);

    const wide = await w.caGen.post('/api/admin/announcements', {
      companyId: null,
      titleEn: 'Nope',
    });
    assert.equal(wide.status, 403);

    const anyCompany = await w.ha.post('/api/admin/announcements', {
      companyId: w.msrId,
      titleEn: 'Fine',
    });
    assert.equal(anyCompany.status, 201);

    const unknown = await w.ha.post('/api/admin/announcements', {
      companyId: '11111111-1111-4111-8111-111111111111',
      titleEn: 'Fine',
    });
    assert.equal(unknown.status, 400);
  });

  test('people of another company cannot read, change or delete a post', async () => {
    const w = await world();
    const post = await w.post(w.caGen, {}, { publish: false });
    const path = `/api/admin/announcements/${post.id}`;

    assert.equal((await w.caMsr.get(path)).status, 404);
    assert.equal(
      (await w.caMsr.patch(path, { updatedAt: post.updatedAt, titleEn: 'x' })).status,
      404
    );
    assert.equal((await w.caMsr.del(path)).status, 404);
    assert.equal((await w.caMsr.post(`${path}/duplicate`)).status, 404);
    assert.equal(
      (await w.caMsr.post(`${path}/publish`, { updatedAt: post.updatedAt })).status,
      404
    );

    // Ordinary users have no admin surface at all.
    assert.equal((await w.gen.get('/api/admin/announcements')).status, 403);
    assert.equal(
      (await w.gen.post('/api/admin/announcements', { companyId: w.genId })).status,
      403
    );

    const list = await w.caMsr.get('/api/admin/announcements');
    assert.deepEqual(list.body.items, []);
    assert.equal(
      (await w.ha.get('/api/admin/announcements')).body.items.length,
      1,
      'the holding admin sees every company'
    );
  });

  test('a company admin can read a holding-wide post but not run it', async () => {
    const w = await world();
    const wide = await w.post(w.ha, { companyId: null });
    const path = `/api/admin/announcements/${wide.id}`;
    assert.equal((await w.caGen.get(path)).status, 403);
    assert.equal(
      (await w.caGen.post(`${path}/unpublish`, { updatedAt: wide.updatedAt })).status,
      403
    );
    assert.equal((await w.gen.get(`/api/announcements/${wide.id}`)).status, 200);
    assert.deepEqual((await w.caGen.get('/api/admin/announcements')).body.items, []);
  });

  test('a concurrent edit is a 409 and changes nothing', async () => {
    const w = await world();
    const post = await w.post(w.caGen, {}, { publish: false });
    const path = `/api/admin/announcements/${post.id}`;

    const first = await w.caGen.patch(path, { updatedAt: post.updatedAt, titleEn: 'First' });
    assert.equal(first.status, 200);

    const second = await w.ha.patch(path, { updatedAt: post.updatedAt, titleEn: 'Second' });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'stale_record');
    assert.equal((await w.caGen.get(path)).body.titleEn, 'First');

    const staleDelete = await w.caGen.post(`${path}/publish`, { updatedAt: post.updatedAt });
    assert.equal(staleDelete.status, 409);
  });

  test('only drafts are deleted; the rest are unpublished', async () => {
    const w = await world();
    const live = await w.post(w.caGen);
    const refused = await w.caGen.del(`/api/admin/announcements/${live.id}`);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'not_a_draft');

    const draft = await w.post(w.caGen, {}, { publish: false });
    const gone = await w.caGen.del(`/api/admin/announcements/${draft.id}`);
    assert.equal(gone.status, 200);
    assert.equal((await w.caGen.get(`/api/admin/announcements/${draft.id}`)).status, 404);
  });

  test('expiry must follow publishing and lie ahead', async () => {
    const w = await world();
    const past = new Date(w.clock.at.getTime() - HOUR).toISOString();
    const res = await w.caGen.post('/api/admin/announcements', {
      companyId: w.genId,
      titleEn: 'T',
      bodyEn: 'B',
      publishAt: new Date(w.clock.at.getTime() + 2 * HOUR).toISOString(),
      expiresAt: new Date(w.clock.at.getTime() + HOUR).toISOString(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'expiry_before_publish');

    const post = await w.post(w.caGen, {}, { publish: false });
    const patched = await w.caGen.patch(`/api/admin/announcements/${post.id}`, {
      updatedAt: post.updatedAt,
      publishAt: new Date(w.clock.at.getTime() - 2 * HOUR).toISOString(),
      expiresAt: past,
    });
    assert.equal(patched.status, 400);
    assert.equal(patched.body.error.code, 'expiry_in_past');
  });

  test('duplicate makes an unpinned draft with its own cover file', async () => {
    const w = await world();
    const post = await w.post(w.caGen, {
      isPinned: true,
      titleEn: 'Original',
      coverAltEn: 'A site',
    });
    const withCover = await w.caGen.upload(
      `/api/admin/announcements/${post.id}/cover?updatedAt=${encodeURIComponent(post.updatedAt)}`,
      PNG
    );
    assert.equal(withCover.status, 200, JSON.stringify(withCover.body));

    const copy = await w.caGen.post(`/api/admin/announcements/${post.id}/duplicate`);
    assert.equal(copy.status, 201);
    assert.equal(copy.body.status, 'Draft');
    assert.equal(copy.body.isPinned, false);
    assert.equal(copy.body.titleEn, 'Original (copy)');
    assert.ok(copy.body.coverUrl && copy.body.coverUrl !== withCover.body.coverUrl);
    assert.equal(w.storage.files.size, 2);
  });
});

describe('cover images', () => {
  async function draftWithAlt(w, extra = {}) {
    return w.post(w.caGen, { coverAltEn: 'Safety briefing', ...extra }, { publish: false });
  }
  const coverPath = (post) =>
    `/api/admin/announcements/${post.id}/cover?updatedAt=${encodeURIComponent(post.updatedAt)}`;

  test('a PNG is accepted, served to readers who may see the post, and replaced cleanly', async () => {
    const w = await world();
    const post = await draftWithAlt(w);
    const res = await w.caGen.upload(coverPath(post), PNG);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.coverUrl, /^\/api\/announcements\/.+\/cover\?v=/);
    assert.equal(res.body.coverKey, undefined, 'the storage key stays inside');

    // Drafts: admins only.
    assert.equal((await w.gen.get(res.body.coverUrl)).status, 404);
    const admin = await w.caGen.get(res.body.coverUrl);
    assert.equal(admin.status, 200);
    assert.equal(admin.headers['content-type'], 'image/png');

    const published = await w.caGen.post(`/api/admin/announcements/${post.id}/publish`, {
      updatedAt: res.body.updatedAt,
    });
    assert.equal((await w.gen.get(res.body.coverUrl)).status, 200);
    assert.equal((await w.msr.get(res.body.coverUrl)).status, 404);

    const again = await w.caGen.upload(coverPath(published.body), PNG);
    assert.equal(again.status, 200);
    assert.equal(w.storage.files.size, 1, 'the replaced file is removed');
  });

  test('svg, html and a renamed text file are refused by signature', async () => {
    const w = await world();
    const post = await draftWithAlt(w);
    for (const bytes of [
      SVG,
      Buffer.from('<html><script>1</script></html>'),
      Buffer.alloc(64, 65),
    ]) {
      const res = await w.caGen.upload(coverPath(post), bytes);
      assert.equal(res.status, 415);
      assert.equal(res.body.error.code, 'unsupported_image');
    }
    assert.equal(w.storage.files.size, 0);
  });

  test('more than 2 MB is refused', async () => {
    const w = await world();
    const post = await draftWithAlt(w);
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    const res = await w.caGen.upload(coverPath(post), big);
    assert.equal(res.status, 413);
    assert.equal(w.storage.files.size, 0);
  });

  test('alt text is required for each language that has a title', async () => {
    const w = await world();
    const post = await w.post(w.caGen, { titleAr: 'عنوان', bodyAr: 'نص' }, { publish: false });
    const res = await w.caGen.upload(coverPath(post), PNG);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'cover_alt_required');
    assert.deepEqual(res.body.error.details.languages.sort(), ['ar', 'en']);
    assert.equal(w.storage.files.size, 0);

    const fixed = await w.caGen.patch(`/api/admin/announcements/${post.id}`, {
      updatedAt: post.updatedAt,
      coverAltEn: 'Briefing',
      coverAltAr: 'إحاطة',
    });
    const ok = await w.caGen.upload(coverPath(fixed.body), PNG);
    assert.equal(ok.status, 200);

    // And the alt cannot be blanked while the image is there.
    const blank = await w.caGen.patch(`/api/admin/announcements/${post.id}`, {
      updatedAt: ok.body.updatedAt,
      coverAltAr: '',
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error.code, 'cover_alt_required');
  });

  test('removing the cover deletes the file', async () => {
    const w = await world();
    const post = await draftWithAlt(w);
    const set = await w.caGen.upload(coverPath(post), PNG);
    const res = await w.caGen.del(
      `/api/admin/announcements/${post.id}/cover?updatedAt=${encodeURIComponent(set.body.updatedAt)}`
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.coverUrl, null);
    assert.equal(w.storage.files.size, 0);
  });
});

describe('audit', () => {
  test('every admin write leaves exactly one audit row, filed under its company', async () => {
    const w = await world();
    const count = () => w.repo.auditLogs.filter((r) => r.entity === 'Announcement').length;
    const actions = () =>
      w.repo.auditLogs.filter((r) => r.entity === 'Announcement').map((r) => r.action);

    const post = await w.post(w.caGen, { coverAltEn: 'x' }, { publish: false });
    assert.equal(count(), 1);

    const patched = await w.caGen.patch(`/api/admin/announcements/${post.id}`, {
      updatedAt: post.updatedAt,
      titleEn: 'Changed',
    });
    assert.equal(count(), 2);

    const cover = await w.caGen.upload(
      `/api/admin/announcements/${post.id}/cover?updatedAt=${encodeURIComponent(patched.body.updatedAt)}`,
      PNG
    );
    assert.equal(count(), 3);

    const published = await w.caGen.post(`/api/admin/announcements/${post.id}/publish`, {
      updatedAt: cover.body.updatedAt,
    });
    const unpublished = await w.caGen.post(`/api/admin/announcements/${post.id}/unpublish`, {
      updatedAt: published.body.updatedAt,
    });
    const copy = await w.caGen.post(`/api/admin/announcements/${post.id}/duplicate`);
    await w.caGen.del(`/api/admin/announcements/${copy.body.id}`);
    assert.equal(unpublished.status, 200);

    assert.deepEqual(actions(), [
      'announcement.create',
      'announcement.update',
      'announcement.cover.update',
      'announcement.publish',
      'announcement.unpublish',
      'announcement.duplicate',
      'announcement.delete',
    ]);

    const update = w.repo.auditLogs.find((r) => r.action === 'announcement.update');
    assert.equal(update.companyId, w.genId);
    assert.equal(update.actorId, w.caGen.user.id);
    assert.equal(JSON.parse(update.before).titleEn, 'Safety week');
    assert.equal(JSON.parse(update.after).titleEn, 'Changed');

    // A holding-wide post belongs to no company.
    await w.post(w.ha, { companyId: null });
    const wide = w.repo.auditLogs.filter((r) => r.entity === 'Announcement').at(-2);
    assert.equal(wide.companyId, null);
  });

  test('refused and stale writes leave no audit row', async () => {
    const w = await world();
    const post = await w.post(w.caGen, {}, { publish: false });
    const before = w.repo.auditLogs.length;

    await w.caMsr.patch(`/api/admin/announcements/${post.id}`, {
      updatedAt: post.updatedAt,
      titleEn: 'x',
    });
    await w.caGen.patch(`/api/admin/announcements/${post.id}`, {
      updatedAt: '2020-01-01T00:00:00.000Z',
      titleEn: 'x',
    });
    await w.caGen.upload(
      `/api/admin/announcements/${post.id}/cover?updatedAt=${encodeURIComponent(post.updatedAt)}`,
      SVG
    );
    assert.equal(w.repo.auditLogs.length, before);
  });
});
