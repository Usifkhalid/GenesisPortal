/**
 * pages.js — the IT Helpdesk's page is for the IT team (D135).
 *
 *   GET /helpdesk(.html)   not signed in → the login page; signed in but not on
 *                          the IT team → 403 with no-access.html; IT → the page
 *
 * The portal's own page (/) is left alone: reading the session there would
 * cost every navigation a database round trip. An IT team member who opens it
 * is sent to /helpdesk by the portal's script (GET /api/me says `home`), and
 * every portal API refuses them (middleware/auth.js `helpdeskOnly`).
 *
 * The page files are static and hold no data, so this is courtesy for the
 * browser: every API route behind them checks for itself (`requireIt`).
 * These are pages, not API routes, so they are not in app.locals.routes;
 * backend/tests/helpdesk.test.js covers them.
 */

import path from 'node:path';

import { Router } from 'express';

export const HELPDESK_PAGES = ['/helpdesk', '/helpdesk.html'];

/**
 * @param {object} deps
 * @param {string} deps.frontendDir
 * @param {import('express').RequestHandler[]} deps.session  what reads the
 *   session and sets req.user (the session, its lifetime and loadUser)
 */
export function helpdeskPages({ frontendDir, session }) {
  const router = Router();
  const noAccess = path.join(frontendDir, 'no-access.html');

  router.get(HELPDESK_PAGES, ...session, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) {
      res.redirect(302, '/login.html');
      return;
    }
    if (!req.user.it) {
      res.status(403).sendFile(noAccess);
      return;
    }
    next();
  });

  return router;
}
