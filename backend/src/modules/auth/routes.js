/**
 * routes.js — sign-in, sign-out and "who am I".
 *
 * publicAuthRoutes are reachable without a session:
 *   GET  /api/auth/config       mode, whether signed in, the CSRF token
 *   GET  /api/auth/mock-users   AUTH_MODE=mock in development only
 *   POST /api/auth/mock-login   AUTH_MODE=mock in development only
 *   POST /api/auth/logout
 *   GET  /auth/login            AUTH_MODE=entra
 *   GET  /auth/callback         AUTH_MODE=entra
 *   POST /auth/logout           AUTH_MODE=entra
 *
 * meRoutes sit behind requireAuth:
 *   GET  /api/me
 */

import { Router } from 'express';

import { destroySession, sessionCookie } from '../../lib/session.js';
import { workerEnabledFor } from '../../lib/service-worker.js';
import { csrfToken } from '../../middleware/csrf.js';
import { HttpError } from '../../middleware/errors.js';
import { createEntraHandlers, entraLogoutUrl } from './entra.js';
import { mockLoginBody } from './schema.js';
import { describeMe, listMockUsers, startSession } from './service.js';

/**
 * @param {object} deps
 * @param {object} deps.config  the environment (config/env.js), or a test's version of it
 * @param {object} deps.repo  see repo.js
 * @param {object} [deps.msalClient]  a stand-in for the MSAL client, for tests
 */
export function publicAuthRoutes({ config, repo, msalClient }) {
  const router = Router();
  const cookie = sessionCookie(config);
  const entra = config.AUTH_MODE === 'entra';

  // Mock sign-in lets anyone become anyone. It answers in development and
  // nowhere else, whatever AUTH_MODE says.
  const mockOnly = (req, res, next) => {
    if (config.AUTH_MODE !== 'mock' || config.NODE_ENV !== 'development') {
      throw new HttpError(404, 'not_found', 'Mock sign-in is only available in development.');
    }
    next();
  };

  router.get('/api/auth/config', (req, res) => {
    res.json({
      mode: config.AUTH_MODE,
      signedIn: Boolean(req.session.userId),
      csrfToken: csrfToken(req),
      // Whether the page should install the offline worker (frontend/sw.js).
      serviceWorker: workerEnabledFor(req, config),
    });
  });

  router.get('/api/auth/mock-users', mockOnly, async (req, res) => {
    res.json({ companies: await listMockUsers(repo) });
  });

  router.post('/api/auth/mock-login', mockOnly, async (req, res) => {
    const { userId } = mockLoginBody.parse(req.body);

    const person = await repo.getSessionUser(userId);
    if (!person?.isActive || !person.company?.isActive) {
      throw new HttpError(404, 'not_found', 'No such user.');
    }

    const token = await startSession(req, person.id);
    req.log?.info({ userId: person.id }, 'mock sign-in');
    res.json({ redirectTo: '/', csrfToken: token });
  });

  /** Ends the session here and says where the browser should go next. */
  const logout = async (req, res) => {
    // Whatever goes wrong with the stored session, the browser still leaves.
    try {
      await destroySession(req);
    } catch (err) {
      req.log?.warn({ err }, 'sign-out: session could not be destroyed');
    }
    res.clearCookie(cookie.name, cookie.options);
    // In Entra mode the browser also leaves its Entra session, or the next
    // visit to the login page would sign straight back in.
    res.json({ redirectTo: entra ? entraLogoutUrl(config) : '/login.html' });
  };

  router.post('/api/auth/logout', logout);

  if (entra) {
    const handlers = createEntraHandlers({ config, repo, msalClient });
    router.get('/auth/login', handlers.login);
    router.get('/auth/callback', handlers.callback);
    router.post('/auth/logout', logout);
  }

  return router;
}

/** Mounted after requireAuth. */
export function meRoutes({ config, repo }) {
  const router = Router();

  router.get('/api/me', async (req, res) => {
    res.json(await describeMe(req, repo, config));
  });

  return router;
}
