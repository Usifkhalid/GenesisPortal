/**
 * redirects.js — the old IT workspace's addresses lead to the IT Helpdesk app
 * (D146). The helpdesk used to be a page of the portal at /helpdesk, and
 * earlier notification emails link to it, or to a ticket in the portal
 * (/#tickets/<id>, which the portal's script sends on, see app.js).
 *
 *   GET /helpdesk, /helpdesk.html, /helpdesk/...   → 302 to HELPDESK_URL
 *
 * Nothing is sent along but the address: a browser keeps the part after the
 * "#" over a redirect, so /helpdesk#tickets/IT-2026-00004 arrives as
 * <helpdesk>/#tickets/IT-2026-00004 and the helpdesk finds the ticket by its
 * number or id. There is no session and no data here, so it is not an API
 * route (it is in no authorisation matrix); backend/tests/itsupport.test.js
 * covers it. Without HELPDESK_URL the address is simply not found.
 */

import { Router } from 'express';

export const OLD_HELPDESK_PATHS = ['/helpdesk', '/helpdesk.html', '/helpdesk/*rest'];

/** @param {{ helpdeskUrl?: string }} options */
export function helpdeskRedirects({ helpdeskUrl }) {
  const router = Router();
  if (!helpdeskUrl) return router;
  const target = helpdeskUrl.replace(/\/+$/, '') + '/';
  router.get(OLD_HELPDESK_PATHS, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.redirect(302, target);
  });
  return router;
}
