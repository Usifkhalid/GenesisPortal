/**
 * pwa.test.js — the server's half of the offline portal: /sw.js carries a
 * version and a precache list that follow the files, a disabled worker retires
 * itself, and static text is served precompressed with a stable ETag.
 */

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { SHARED_WEB_DIR } from '../src/config/env.js';
import { describeFrontend } from '@mg/shared/server/lib/service-worker.js';

const folders = [];
after(() => folders.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A small frontend folder with the files the worker lists and some it must not. */
function fakeFrontend() {
  const dir = mkdtempSync(join(tmpdir(), 'portal-fe-'));
  folders.push(dir);
  const files = {
    'index.html': '<html></html>',
    'login.html': '<html></html>',
    'offline.html': '<html></html>',
    'manifest.webmanifest': '{}',
    'sw.js': 'const VERSION = "__VERSION__";',
    'styleguide.html': '<html></html>',
    'assets/css/tokens.css': 'a{}',
    'assets/css/pages/home.css': 'a{}',
    'assets/css/pages/styleguide.css': 'a{}',
    'assets/js/app.js': '//',
    'assets/js/components/toast.js': '//',
    'assets/js/pages/tickets.js': '//',
    'assets/i18n/en.json': '{}',
    'assets/fonts/fonts.css': '/**/',
    'assets/fonts/plex-sans-latin.woff2': 'x',
    'assets/img/icons/icon-192.png': 'x',
    'assets/img/companies/gen.svg': '<svg/>',
  };
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

describe('describeFrontend', () => {
  test('lists the shell and leaves page modules, fonts and the styleguide out', () => {
    const { precache } = describeFrontend(fakeFrontend());

    for (const url of [
      '/',
      '/login.html',
      '/offline.html',
      '/manifest.webmanifest',
      '/assets/css/tokens.css',
      '/assets/css/pages/home.css',
      '/assets/js/app.js',
      '/assets/js/components/toast.js',
      '/assets/i18n/en.json',
      '/assets/fonts/fonts.css',
      '/assets/img/icons/icon-192.png',
    ]) {
      assert.ok(precache.includes(url), `${url} is precached`);
    }
    for (const url of [
      '/assets/js/pages/tickets.js',
      '/assets/css/pages/styleguide.css',
      '/assets/fonts/plex-sans-latin.woff2',
      '/styleguide.html',
      '/sw.js',
    ]) {
      assert.ok(!precache.includes(url), `${url} is not precached`);
    }
  });

  test('the version follows the files', () => {
    const dir = fakeFrontend();
    const before = describeFrontend(dir).version;
    assert.match(before, /^[0-9a-f]{12}$/);
    assert.equal(describeFrontend(dir).version, before, 'unchanged files, same version');

    writeFileSync(join(dir, 'assets/css/tokens.css'), 'a{color:red}');
    const edited = describeFrontend(dir).version;
    assert.notEqual(edited, before, 'an edited file is a new version');

    const touched = new Date(Date.now() + 60_000);
    utimesSync(join(dir, 'assets/js/app.js'), touched, touched);
    assert.notEqual(describeFrontend(dir).version, edited, 'a newer file is a new version');
  });
});

describe('GET /sw.js', () => {
  test('on: the worker with its version and precache list filled in', async () => {
    const app = createApp({ config: { serviceWorkerEnabled: true } });
    const res = await request(app).get('/sw.js');

    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
    assert.match(res.headers['cache-control'], /no-cache/);
    assert.equal(res.headers['service-worker-allowed'], '/');
    assert.match(res.text, /const VERSION = "[0-9a-f]{12}"/);
    assert.ok(!res.text.includes('__VERSION__'));
    assert.ok(!res.text.includes('__PRECACHE__'));

    const list = res.text.match(/const PRECACHE = (\[.*?\]);/s)?.[1];
    const urls = JSON.parse(list);
    assert.ok(urls.includes('/') && urls.includes('/offline.html'));
    assert.ok(urls.every((url) => url.startsWith('/')));
  });

  test('off: a worker that deletes its caches and removes itself', async () => {
    const app = createApp({ config: { serviceWorkerEnabled: false } });
    const res = await request(app).get('/sw.js');

    assert.equal(res.status, 200);
    assert.match(res.text, /unregister\(\)/);
    assert.ok(!res.text.includes('PRECACHE'));
  });
});

describe('the worker is opt-in outside production', () => {
  const asked = { Cookie: 'a=b; portal_sw=on' };

  test('a development server serves it to a browser that sends the cookie', async () => {
    const app = createApp({ config: { NODE_ENV: 'development', serviceWorkerEnabled: false } });

    const plain = await request(app).get('/sw.js');
    assert.match(plain.text, /unregister()/);
    const opted = await request(app).get('/sw.js').set(asked);
    assert.match(opted.text, /const VERSION = "[0-9a-f]{12}"/);

    const config = await request(app).get('/api/auth/config').set(asked);
    assert.equal(config.body.serviceWorker, true);
    const without = await request(app).get('/api/auth/config');
    assert.equal(without.body.serviceWorker, false);
  });

  test('production ignores the cookie', async () => {
    const app = createApp({ config: { NODE_ENV: 'production', serviceWorkerEnabled: false } });
    const res = await request(app).get('/sw.js').set(asked);
    assert.match(res.text, /unregister()/);
  });
});

describe('precompressed static files', () => {
  const app = createApp({ config: { staticPrecompress: true } });
  const file = join(SHARED_WEB_DIR, 'assets/css/base.css');

  /**
   * The file is compressed in the background and served as a plain file until
   * it is ready: ask until the answer is ours (a strong ETag, not express's weak one).
   */
  async function ours(path, encoding) {
    for (let i = 0; i < 100; i++) {
      const res = await request(app).get(path).set('Accept-Encoding', encoding);
      if (res.headers.etag && !res.headers.etag.startsWith('W/')) return res;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${path} was never served precompressed`);
  }

  test('a text file is served compressed, and is the file', async () => {
    const res = await ours('/assets/css/base.css', 'gzip');

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.headers.vary, 'Accept-Encoding');
    assert.match(res.headers['content-type'], /text\/css/);
    assert.equal(res.text, readFileSync(file, 'utf8'));
  });

  test('Brotli is chosen when the client accepts it', async () => {
    const res = await request(app)
      .get('/assets/css/base.css')
      .set('Accept-Encoding', 'br, gzip');
    assert.equal(res.headers['content-encoding'], 'br');
  });

  test('a repeat request with the ETag is a 304', async () => {
    const first = await ours('/assets/css/base.css', 'gzip');
    const again = await request(app)
      .get('/assets/css/base.css')
      .set('Accept-Encoding', 'gzip')
      .set('If-None-Match', first.headers.etag);
    assert.equal(again.status, 304);
  });

  test('the shell address and an extension-less page resolve', async () => {
    const home = await request(app).get('/').set('Accept-Encoding', 'gzip');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-type'], /text\/html/);

    const login = await request(app).get('/login').set('Accept-Encoding', 'gzip');
    assert.equal(login.status, 200);
  });

  test('a client that accepts nothing, and a path outside the folder, fall through', async () => {
    const plain = await request(app)
      .get('/assets/css/base.css')
      .set('Accept-Encoding', 'identity');
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined);

    const escape = await request(app)
      .get('/..%2f..%2fpackage.json')
      .set('Accept-Encoding', 'gzip');
    assert.notEqual(escape.status, 200);
  });
});
