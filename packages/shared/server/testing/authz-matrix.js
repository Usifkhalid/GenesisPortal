/**
 * authz-matrix.js — the authorisation matrix's runner, for either app's
 * backend/tests/authz-matrix.test.js: every route the app answers, asked by
 * every kind of person, with the answer the product's rules call for.
 *
 * The route list is not written in the test: it is app.locals.routes,
 * recorded as app.js mounts each router (lib/http-app.js). A route with no
 * row fails the first test, so a new endpoint cannot ship without saying who
 * may use it.
 *
 * What counts:
 *   allowed  2xx (or a 4xx about the content of the request: 400, 409, 415 —
 *            the request got past the permission check)
 *   denied   403, or 404 where the record's existence is not theirs to learn
 *   nobody   401 on everything that is not public
 * Each person asks in a world of their own (a fresh in-memory app), so one
 * person's delete cannot turn the next person's answer into a 404.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';

import request from 'supertest';

import { client } from './clients.js';

/** Marks a route anyone may call without a session. */
export const PUBLIC = 'public';

const PASSED_THE_CHECK = new Set([200, 201, 202, 204, 400, 409, 415]);
const REFUSED = new Set([403, 404]);

/**
 * @param {object} spec
 * @param {() => { app: import('express').Express, person: (key: string) => object }} spec.world
 * @param {Record<string, [string[] | 'public', ((actor: object, f: object) => Promise<object>) | null]>} spec.matrix
 *   "METHOD /path" → [who is allowed, the request]
 * @param {string[]} spec.actors  every kind of person, keys of world().person
 * @param {number} spec.minRoutes  fewer recorded routes than this is a mistake
 * @param {() => import('express').Express} spec.entraApp  the app in Entra mode
 */
export function runAuthzMatrix({ world, matrix, actors, minRoutes, entraApp }) {
  describe('authorisation matrix', () => {
    test('every route the app answers has a row, and every row is a real route', () => {
      const routes = world().app.locals.routes;
      assert.ok(routes.length >= minRoutes, `only ${routes.length} routes were recorded`);
      assert.equal(new Set(routes).size, routes.length, 'a route is mounted twice');

      const untested = routes.filter((route) => !matrix[route]);
      const stale = Object.keys(matrix).filter((route) => !routes.includes(route));
      assert.deepEqual(untested, [], 'routes with no row in the authorisation matrix');
      assert.deepEqual(stale, [], 'matrix rows for routes that no longer exist');
    });

    test('Entra mode adds only the three sign-in routes, all public by design', () => {
      const extra = entraApp().locals.routes.filter((route) => !matrix[route]);
      assert.deepEqual(extra.sort(), [
        'GET /auth/callback',
        'GET /auth/login',
        'POST /auth/logout',
      ]);
    });

    for (const [route, [allowed, call]] of Object.entries(matrix)) {
      if (!call) continue;

      test(route, async () => {
        // Not signed in.
        const f0 = world();
        const nobody = await call(client(f0.app, null), f0);
        if (allowed === PUBLIC) {
          assert.equal(nobody.status, 200, `nobody: ${JSON.stringify(nobody.body)}`);
          return;
        }
        // A write without a session has no CSRF token either: 401 or 403, never served.
        assert.ok(
          nobody.status === 401 ||
            (nobody.status === 403 && nobody.body.error?.code === 'csrf_invalid'),
          `nobody got ${nobody.status}`
        );

        for (const who of actors) {
          const f = world();
          const actor = await client(f.app, f.person(who)).signIn();
          const res = await call(actor, f);
          const say = `${who} got ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`;
          if (allowed.includes(who)) {
            assert.ok(PASSED_THE_CHECK.has(res.status), `should be allowed: ${say}`);
          } else {
            assert.ok(REFUSED.has(res.status), `should be denied: ${say}`);
          }
        }
      });
    }

    test('a signed-out reader gets 401 from a read on every protected route', async () => {
      const f = world();
      for (const route of f.app.locals.routes) {
        if (matrix[route]?.[0] === PUBLIC || !route.startsWith('GET ')) continue;
        const path = route.slice(4).replace(/:\w+/g, randomUUID());
        const res = await request(f.app).get(path);
        assert.equal(res.status, 401, route);
      }
    });
  });
}
