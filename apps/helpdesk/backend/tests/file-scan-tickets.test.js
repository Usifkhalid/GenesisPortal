import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { DEFENDER_TAG, createDefenderScanner } from '@mg/shared/server/lib/file-scan.js';
import { createMemoryStorage } from '@mg/shared/server/lib/storage.js';
import { createMemoryUserRepo } from '@mg/shared/server/modules/auth/repo-memory.js';

/**
 * A ticket's attachments go through the malware-scan gate (lib/file-scan.js):
 * served only once clean. The gate itself is tested in the portal's
 * file-scan.test.js; this is the helpdesk's use of it.
 */

const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };
const EICAR = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'latin1'
);
const TEXT = Buffer.from('printer log\nline two\n');

/** A memory storage that also holds index tags, as a blob container does. */
function taggedStorage() {
  const storage = createMemoryStorage();
  const tags = new Map();
  return {
    ...storage,
    tagMap: tags,
    tags: async (key) => tags.get(key) ?? {},
    verdict: (key, value) => tags.set(key, { [DEFENDER_TAG]: value }),
  };
}

describe('ticket attachments and the scan', () => {
  async function world(options = {}) {
    const repo = createMemoryUserRepo();
    const storage = options.storage ?? createMemoryStorage();
    const app = createApp({
      config: DEV,
      userRepo: repo,
      storage,
      scanner: options.scanner,
      authRateLimit: { limit: 100_000, accountLimit: 100_000 },
      rateLimit: { limit: 100_000 },
    });
    const signIn = async (email) => {
      const user = repo.users.find((u) => u.email === email);
      const agent = request.agent(app);
      const config = await agent.get('/api/auth/config');
      const login = await agent
        .post('/api/auth/mock-login')
        .set('X-CSRF-Token', config.body.csrfToken)
        .send({ userId: user.id });
      const csrf = login.body.csrfToken;
      return {
        user,
        get: (path) => agent.get(path),
        post: (path, body) => agent.post(path).set('X-CSRF-Token', csrf).send(body),
        upload: (path, bytes) =>
          agent
            .post(path)
            .set('X-CSRF-Token', csrf)
            .set('Content-Type', 'application/octet-stream')
            .send(bytes),
      };
    };
    const requester = await signIn('salma.ibrahim@genesismining-eg.com');
    const lead = await signIn('omar.fahmy@mgholding.example');
    const category = repo.helpdesk.category.find((c) => c.nameEn === 'Laptop / PC');
    const made = await requester.post('/api/tickets', {
      subject: 'Laptop will not start',
      description: 'It shows the logo and then a black screen.',
      categoryId: category.id,
    });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    return { app, repo, storage, requester, lead, ticket: made.body.ticket };
  }

  test('an infected attachment is refused to everyone, and people are notified', async () => {
    const w = await world();
    const up = await w.requester.upload(
      `/api/tickets/${w.ticket.id}/attachments?name=readme.txt`,
      EICAR
    );
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.scan, 'infected');

    for (const who of [w.requester, w.lead]) {
      const res = await who.get(up.body.url);
      assert.equal(res.status, 410);
      assert.equal(res.body.error.code, 'file_blocked');
    }
    assert.equal(w.storage.files.size, 0, 'nothing infected is kept');

    const detail = await w.lead.get(`/api/tickets/${w.ticket.id}`);
    assert.equal(detail.body.attachments[0].scan, 'infected');

    const inbox = async (who) =>
      (await who.get('/api/notifications')).body.items.filter(
        (n) => n.templateKey === 'file.infected'
      );
    assert.equal((await inbox(w.requester)).length, 1, 'the uploader');
    assert.equal((await inbox(w.lead)).length, 1, 'the IT lead');
    const mail = w.app.locals.mailOutbox.messages ?? w.app.locals.mailOutbox;
    assert.ok(mail);
  });

  test('a clean attachment downloads; one still being scanned does not', async () => {
    const storage = taggedStorage();
    const w = await world({ storage, scanner: createDefenderScanner() });
    const up = await w.requester.upload(
      `/api/tickets/${w.ticket.id}/attachments?name=notes.txt`,
      TEXT
    );
    assert.equal(up.status, 201);
    assert.equal(up.body.scan, 'pending');

    const early = await w.requester.get(up.body.url);
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'file_scan_pending');

    const key = [...storage.files.keys()][0];
    storage.verdict(key, 'No threats found');
    const later = await w.requester.get(up.body.url);
    assert.equal(later.status, 200);
    assert.match(later.headers['content-disposition'], /^attachment/);
    const detail = await w.requester.get(`/api/tickets/${w.ticket.id}`);
    assert.equal(detail.body.attachments[0].scan, 'clean');
  });
});
