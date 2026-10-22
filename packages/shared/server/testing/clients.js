/**
 * clients.js — signed-in test clients for either app (node:test + supertest).
 * Mock sign-in, then every write carries the session's CSRF token.
 */

import assert from 'node:assert/strict';

import request from 'supertest';

import { zoneWallToUtc } from '../lib/sla.js';

/** An instant from a Cairo day and clock time: cairo('2026-10-11', '11:00'). */
export const cairo = (ymd, hhmm) =>
  new Date(
    zoneWallToUtc(ymd, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), 'Africa/Cairo')
  );

export const iso = (value) => new Date(value).toISOString();

/**
 * A client for `user` that has not signed in yet (null: nobody). signIn()
 * signs in through mock sign-in and returns the same client.
 * @param {import('express').Express} app
 * @param {{ id: string, email?: string } | null} user
 */
export function client(app, user) {
  const agent = request.agent(app);
  let csrf = '';
  const write = (method, path) => agent[method](path).set('X-CSRF-Token', csrf);
  return {
    user,
    agent,
    async signIn() {
      const config = await agent.get('/api/auth/config');
      const login = await agent
        .post('/api/auth/mock-login')
        .set('X-CSRF-Token', config.body.csrfToken)
        .send({ userId: user.id });
      assert.equal(login.status, 200, `sign-in as ${user.email ?? user.id}`);
      csrf = login.body.csrfToken;
      this.redirectTo = login.body.redirectTo;
      return this;
    },
    get: (path) => agent.get(path),
    post: (path, body = {}) => write('post', path).send(body),
    patch: (path, body = {}) => write('patch', path).send(body),
    put: (path, body = {}) => write('put', path).send(body),
    del: (path) => write('delete', path),
    /** Bytes as the body: an upload. */
    raw: (method, path, bytes) =>
      write(method, path).set('Content-Type', 'application/octet-stream').send(bytes),
    upload: (path, bytes) =>
      write('post', path).set('Content-Type', 'application/octet-stream').send(bytes),
  };
}

/** Signs `user` in and returns their client. */
export const signIn = (app, user) => client(app, user).signIn();
