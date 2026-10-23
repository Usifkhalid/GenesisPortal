/**
 * routes.js — the helpdesk's HTTP surface. See docs/API.md.
 *
 * For every signed-in person (their own tickets):
 *   GET    /api/tickets/options              what the "new ticket" form needs
 *   POST   /api/tickets                      raise one (agents: for someone else)
 *   GET    /api/tickets/mine?status=&q=
 *   GET    /api/tickets/counts               the numbers beside "Tickets"
 *   GET    /api/tickets/by-number/:number    the id of IT-2026-00042 (links by number, D146)
 *   GET    /api/tickets/:id                  with its timeline
 *   POST   /api/tickets/:id/comments         { body, isInternal }
 *   POST   /api/tickets/:id/attachments?name=&commentId=   the raw file, 10 MB
 *   GET    /api/tickets/:id/attachments/:attachmentId
 *   POST   /api/tickets/:id/reopen
 *   POST   /api/tickets/:id/solved           the requester: { rating?, feedback? } → Closed
 *   POST   /api/tickets/:id/not-solved       the requester: { reason } → back to Open
 *
 * For the IT team only (agents and leads; never an administrator who is not
 * on it, D135), used by the IT Helpdesk at /helpdesk:
 *   GET    /api/tickets/queue?status=&priority=&assignee=&companyId=&…
 *   GET    /api/tickets/queue/options
 *   GET    /api/tickets/canned-replies?teamId=
 *   PATCH  /api/tickets/:id                  { assigneeId, status, priority, categoryId }
 *   POST   /api/tickets/:id/close            leads only: { reason }, without the requester's confirmation
 *
 * IT settings and the reports are modules/helpdesk/routes.js. Which ticket a
 * person may read or change is the service's question (rules.js); the gate
 * here only keeps the IT side to the IT team.
 */

import express, { Router } from 'express';

import { requireIt } from '../../middleware/auth.js';
import { MAX_ATTACHMENT_BYTES } from './rules.js';
import {
  attachmentParams,
  attachmentQuery,
  commentBody,
  confirmBody,
  createBody,
  idParam,
  numberParam,
  mineQuery,
  queueQuery,
  reasonBody,
  teamQuery,
  updateBody,
} from './schema.js';

/** A file name in a Content-Disposition header, for any script (RFC 5987). */
function attachmentHeader(fileName) {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** @param {ReturnType<import('./service.js').createTicketService>} service */
export function ticketRoutes(service) {
  const router = Router();
  const it = requireIt();

  router.get('/options', async (req, res) => {
    res.json(await service.options(req));
  });

  router.get('/mine', async (req, res) => {
    res.json(await service.listMine(req, mineQuery.parse(req.query)));
  });

  router.get('/counts', async (req, res) => {
    res.json(await service.counts(req));
  });

  router.get('/queue', it, async (req, res) => {
    res.json(await service.queue(req, queueQuery.parse(req.query)));
  });

  router.get('/queue/options', it, async (req, res) => {
    res.json(await service.queueOptions(req));
  });

  router.get('/canned-replies', it, async (req, res) => {
    res.json(await service.cannedReplies(req, teamQuery.parse(req.query)));
  });

  router.post('/', async (req, res) => {
    res.status(201).json(await service.create(req, createBody.parse(req.body)));
  });

  // A link by number (IT-2026-00042): the id to open it by.
  router.get('/by-number/:number', async (req, res) => {
    const { number } = numberParam.parse(req.params);
    res.json(await service.idByNumber(req, number));
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.get(req, id));
  });

  router.patch('/:id', it, async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.update(req, id, updateBody.parse(req.body)));
  });

  router.post('/:id/comments', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.status(201).json(await service.comment(req, id, commentBody.parse(req.body)));
  });

  router.post('/:id/reopen', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.reopen(req, id));
  });

  router.post('/:id/solved', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.confirm(req, id, confirmBody.parse(req.body)));
  });

  router.post('/:id/not-solved', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.notSolved(req, id, reasonBody.parse(req.body)));
  });

  router.post('/:id/close', it, async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.closeWithoutConfirmation(req, id, reasonBody.parse(req.body)));
  });

  router.post(
    '/:id/attachments',
    // Any content type: the file's own signature decides what it is.
    express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
    async (req, res) => {
      const { id } = idParam.parse(req.params);
      const query = attachmentQuery.parse(req.query);
      res.status(201).json(await service.addAttachment(req, id, query, req.body));
    }
  );

  // Always a download, never rendered: the bytes came from a user.
  router.get('/:id/attachments/:attachmentId', async (req, res) => {
    const { id, attachmentId } = attachmentParams.parse(req.params);
    const file = await service.readAttachment(req, id, attachmentId);
    res
      .set('Cache-Control', 'private, no-store')
      .set('Content-Security-Policy', "default-src 'none'; sandbox")
      .set('Content-Disposition', attachmentHeader(file.fileName))
      .type(file.type)
      .send(file.buffer);
  });

  return router;
}
