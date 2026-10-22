/**
 * routes.js — the announcements module's HTTP surface. See docs/API.md.
 *
 * For every signed-in person (mounted at /api/announcements):
 *   GET    /                    published, unexpired, own company + holding-wide
 *   GET    /unread-count
 *   GET    /:id                 one post; opening it marks it read
 *   GET    /:id/cover
 *
 * For administrators (mounted at /api/admin/announcements):
 *   GET    /                    drafts, scheduled and expired too, within scope
 *   POST   /
 *   GET    /:id
 *   PATCH  /:id
 *   POST   /:id/publish         now, or at a future publishAt
 *   POST   /:id/unpublish
 *   POST   /:id/duplicate
 *   DELETE /:id                 drafts only
 *   PUT    /:id/cover           raw PNG, JPEG or WebP, 2 MB
 *   DELETE /:id/cover
 */

import express, { Router } from 'express';

import { ROLES } from '@mg/shared/server/lib/roles.js';
import { requireRole } from '@mg/shared/server/middleware/auth.js';
import {
  adminListQuery,
  concurrencyBody,
  concurrencyQuery,
  createBody,
  idParam,
  publishBody,
  readerListQuery,
  updateBody,
} from './schema.js';
import { MAX_COVER_BYTES } from './rules.js';

const anyAdmin = requireRole(ROLES.HOLDING_ADMIN, ROLES.COMPANY_ADMIN);

/** @param {ReturnType<import('./service.js').createAnnouncementService>} service */
export function readerRoutes(service) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await service.listForReader(req, readerListQuery.parse(req.query)));
  });

  router.get('/unread-count', async (req, res) => {
    res.json(await service.unreadCount(req));
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.getForReader(req, id));
  });

  // The address carries a version (?v=), so the browser may keep the bytes: a
  // replaced cover is a new address, never new bytes behind an old one.
  router.get('/:id/cover', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const cover = await service.readCover(req, id);
    res
      .set('Cache-Control', 'private, max-age=31536000, immutable')
      .set('Content-Security-Policy', "default-src 'none'")
      .type(cover.type)
      .send(cover.buffer);
  });

  return router;
}

/** @param {ReturnType<import('./service.js').createAnnouncementService>} service */
export function adminAnnouncementRoutes(service) {
  const router = Router();
  router.use(anyAdmin);

  router.get('/', async (req, res) => {
    res.json(await service.listForAdmin(req, adminListQuery.parse(req.query)));
  });

  router.post('/', async (req, res) => {
    res.status(201).json(await service.create(req, createBody.parse(req.body)));
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.getForAdmin(req, id));
  });

  router.patch('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.update(req, id, updateBody.parse(req.body)));
  });

  router.post('/:id/publish', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.publish(req, id, publishBody.parse(req.body)));
  });

  router.post('/:id/unpublish', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { updatedAt } = concurrencyBody.parse(req.body);
    res.json(await service.unpublish(req, id, updatedAt));
  });

  router.post('/:id/duplicate', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.status(201).json(await service.duplicate(req, id));
  });

  router.delete('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.remove(req, id));
  });

  router.put(
    '/:id/cover',
    // Any content type: the file's own signature decides what it is.
    express.raw({ type: () => true, limit: MAX_COVER_BYTES }),
    async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { updatedAt } = concurrencyQuery.parse(req.query);
      res.json(await service.setCover(req, id, req.body, updatedAt));
    }
  );

  router.delete('/:id/cover', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { updatedAt } = concurrencyQuery.parse(req.query);
    res.json(await service.removeCover(req, id, updatedAt));
  });

  return router;
}
