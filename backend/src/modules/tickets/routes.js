/**
 * routes.js — the helpdesk's HTTP surface. See docs/API.md.
 *
 * For every signed-in person (their own tickets):
 *   GET    /api/tickets/options              what the "new ticket" form needs
 *   POST   /api/tickets                      raise one (agents: for someone else)
 *   GET    /api/tickets/mine?status=&q=
 *   GET    /api/tickets/counts               the numbers beside "Tickets"
 *   GET    /api/tickets/:id                  with its timeline
 *   POST   /api/tickets/:id/comments         { body, isInternal }
 *   POST   /api/tickets/:id/attachments?name=&commentId=   the raw file, 10 MB
 *   GET    /api/tickets/:id/attachments/:attachmentId
 *   POST   /api/tickets/:id/reopen
 *
 * For the support team (and a HoldingAdmin):
 *   GET    /api/tickets/queue?status=&priority=&assignee=&companyId=&…
 *   GET    /api/tickets/queue/options
 *   GET    /api/tickets/canned-replies?teamId=
 *   PATCH  /api/tickets/:id                  { assigneeId, status, priority, categoryId }
 *
 * Configuration (HoldingAdmin; a team's Lead for its categories and canned
 * replies), every write audited:
 *   GET/POST    /api/admin/helpdesk/teams            PATCH /teams/:id
 *   PUT/DELETE  /api/admin/helpdesk/teams/:id/members/:userId
 *   PUT         /api/admin/helpdesk/teams/:id/sla
 *   PUT         /api/admin/helpdesk/teams/:id/calendar
 *   GET/POST    /api/admin/helpdesk/categories       PATCH /categories/:id
 *   GET/POST    /api/admin/helpdesk/canned-replies   PATCH /canned-replies/:id
 *   GET/POST    /api/admin/helpdesk/locations        PATCH /locations/:id
 *   GET/POST    /api/admin/helpdesk/holidays         PATCH, DELETE /holidays/:id
 *
 * Who may do what is the services' question, not the router's: there is no
 * role gate here, because helpdesk staff are team members, not role holders.
 */

import express, { Router } from 'express';

import { MAX_ATTACHMENT_BYTES } from './rules.js';
import {
  attachmentParams,
  attachmentQuery,
  calendarBody,
  cannedCreateBody,
  cannedUpdateBody,
  categoryCreateBody,
  categoryUpdateBody,
  commentBody,
  createBody,
  holidayCreateBody,
  holidayQuery,
  holidayUpdateBody,
  idParam,
  locationCreateBody,
  locationUpdateBody,
  memberBody,
  memberParams,
  mineQuery,
  queueQuery,
  slaBody,
  teamCreateBody,
  teamQuery,
  teamUpdateBody,
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

  router.get('/options', async (req, res) => {
    res.json(await service.options(req));
  });

  router.get('/mine', async (req, res) => {
    res.json(await service.listMine(req, mineQuery.parse(req.query)));
  });

  router.get('/counts', async (req, res) => {
    res.json(await service.counts(req));
  });

  router.get('/queue', async (req, res) => {
    res.json(await service.queue(req, queueQuery.parse(req.query)));
  });

  router.get('/queue/options', async (req, res) => {
    res.json(await service.queueOptions(req));
  });

  router.get('/canned-replies', async (req, res) => {
    res.json(await service.cannedReplies(req, teamQuery.parse(req.query)));
  });

  router.post('/', async (req, res) => {
    res.status(201).json(await service.create(req, createBody.parse(req.body)));
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.get(req, id));
  });

  router.patch('/:id', async (req, res) => {
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

/** @param {ReturnType<import('./admin-service.js').createHelpdeskAdminService>} admin */
export function helpdeskAdminRoutes(admin) {
  const router = Router();

  /* ---- teams, members, targets, hours */
  router.get('/teams', async (req, res) => {
    res.json(await admin.listTeams(req));
  });

  router.post('/teams', async (req, res) => {
    res.status(201).json(await admin.createTeam(req, teamCreateBody.parse(req.body)));
  });

  router.patch('/teams/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await admin.updateTeam(req, id, teamUpdateBody.parse(req.body)));
  });

  router.put('/teams/:id/members/:userId', async (req, res) => {
    const { id, userId } = memberParams.parse(req.params);
    res.json(await admin.setMember(req, id, userId, memberBody.parse(req.body)));
  });

  router.delete('/teams/:id/members/:userId', async (req, res) => {
    const { id, userId } = memberParams.parse(req.params);
    res.json(await admin.removeMember(req, id, userId));
  });

  router.put('/teams/:id/sla', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await admin.setSla(req, id, slaBody.parse(req.body)));
  });

  router.put('/teams/:id/calendar', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await admin.setCalendar(req, id, calendarBody.parse(req.body)));
  });

  /* ---- categories and canned replies (also a team's Lead) */
  router.get('/categories', async (req, res) => {
    res.json(await admin.listCategories(req, teamQuery.parse(req.query)));
  });

  router.post('/categories', async (req, res) => {
    res.status(201).json(await admin.createCategory(req, categoryCreateBody.parse(req.body)));
  });

  router.patch('/categories/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await admin.updateCategory(req, id, categoryUpdateBody.parse(req.body)));
  });

  router.get('/canned-replies', async (req, res) => {
    res.json(await admin.listCannedReplies(req, teamQuery.parse(req.query)));
  });

  router.post('/canned-replies', async (req, res) => {
    res.status(201).json(await admin.createCannedReply(req, cannedCreateBody.parse(req.body)));
  });

  router.patch('/canned-replies/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await admin.updateCannedReply(req, id, cannedUpdateBody.parse(req.body)));
  });

  /* ---- locations and holidays */
  router.get('/locations', async (req, res) => {
    res.json(await admin.listLocations(req));
  });

  router.post('/locations', async (req, res) => {
    res.status(201).json(await admin.createLocation(req, locationCreateBody.parse(req.body)));
  });

  router.patch('/locations/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await admin.updateLocation(req, id, locationUpdateBody.parse(req.body)));
  });

  router.get('/holidays', async (req, res) => {
    res.json(await admin.listHolidays(req, holidayQuery.parse(req.query)));
  });

  router.post('/holidays', async (req, res) => {
    res.status(201).json(await admin.createHoliday(req, holidayCreateBody.parse(req.body)));
  });

  router.patch('/holidays/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await admin.updateHoliday(req, id, holidayUpdateBody.parse(req.body)));
  });

  router.delete('/holidays/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    await admin.removeHoliday(req, id);
    res.status(204).end();
  });

  return router;
}
