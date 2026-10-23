/**
 * routes.js — notifications. See docs/API.md.
 *
 * For every signed-in person (their own, always):
 *   GET  /api/notifications?unread=&page=&pageSize=   in-app notifications, newest first
 *   GET  /api/notifications/unread-count               the number on the bell
 *   POST /api/notifications/read          { ids }      mark some read
 *   POST /api/notifications/read-all                   mark every one read
 *   GET  /api/notifications/preferences                category × channel switches
 *   PUT  /api/notifications/preferences   { items }    save the ones that changed
 *
 * Development only, with the mocked Graph:
 *   GET  /api/dev/outbox            the mail the portal "sent" (backend/mock/outbox/)
 *   GET  /api/dev/outbox/:id/html   one mail's HTML, for the preview frame
 */

import { Router } from 'express';

import { HttpError } from '../../middleware/errors.js';
import { listQuery, preferencesBodyFor, readBody } from './schema.js';

/** @param {ReturnType<import('./service.js').createNotificationService>} service */
export function notificationRoutes(service) {
  const router = Router();
  const preferencesBody = preferencesBodyFor(service.categories);

  router.get('/', async (req, res) => {
    res.json(await service.list(req, listQuery.parse(req.query)));
  });

  router.get('/unread-count', async (req, res) => {
    res.json(await service.unreadCount(req));
  });

  router.post('/read', async (req, res) => {
    res.json(await service.markRead(req, readBody.parse(req.body).ids));
  });

  router.post('/read-all', async (req, res) => {
    res.json(await service.markAllRead(req));
  });

  router.get('/preferences', async (req, res) => {
    res.json(await service.preferences(req));
  });

  router.put('/preferences', async (req, res) => {
    res.json(await service.setPreferences(req, preferencesBody.parse(req.body).items));
  });

  return router;
}

/**
 * The dev page's data. Not mounted in production; and even where mounted it
 * answers only when the Graph client is the mock (the real one keeps no copy).
 * @param {() => Promise<import('../../integrations/graph/index.js').GraphClient>} getGraph
 */
export function devOutboxRoutes(getGraph) {
  const router = Router();

  router.get('/outbox', async (req, res) => {
    const graph = await getGraph();
    if (typeof graph.listOutbox !== 'function') throw new HttpError(404, 'not_found');
    res.json({ items: await graph.listOutbox() });
  });

  // One mail's HTML, for the preview frame. Email markup is all inline styles,
  // which the portal's own policy forbids, so this answer carries a policy of
  // its own: styles and embedded images only, no script, sandboxed, and
  // framed by this site alone.
  router.get('/outbox/:id/html', async (req, res) => {
    const graph = await getGraph();
    if (typeof graph.listOutbox !== 'function') throw new HttpError(404, 'not_found');
    const mail = (await graph.listOutbox()).find((m) => m.id === req.params.id);
    if (!mail) throw new HttpError(404, 'not_found');
    res
      .set(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox"
      )
      .set('X-Frame-Options', 'SAMEORIGIN')
      .type('html')
      .send(String(mail.html ?? ''));
  });

  return router;
}
