import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';

const app = createApp();

test('GET /api/health reports ok', async () => {
  const res = await request(app).get('/api/health');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('an /api path answers in JSON, not with the frontend', async () => {
  const res = await request(app).get('/api/nothing-here');

  // Closed by default: without a session even a path that does not exist is 401.
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'unauthenticated');
});

test('the frontend is served as static files', async () => {
  const res = await request(app).get('/styleguide.html');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
});
