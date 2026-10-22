/**
 * routes.js — the IT Helpdesk's own API (D135). See docs/API.md.
 *
 * IT team members only (agents and leads); everyone else, administrators
 * included, gets 403:
 *   GET  /api/helpdesk/reports?from=&to=             counts, SLA, averages
 *   GET  /api/helpdesk/reports/export.csv?from=&to=  one row per ticket
 *   GET  /api/helpdesk/people?q=…                     the directory, for "log a
 *   GET  /api/helpdesk/people/:id                     ticket for someone" and the
 *                                                     requester's contact card
 *
 * IT settings, IT Leads only, every write audited (tickets/admin-service.js):
 *   GET         /api/helpdesk/settings/teams         PATCH /teams/:id
 *   PUT         /api/helpdesk/settings/teams/:id/sla
 *   PUT         /api/helpdesk/settings/teams/:id/calendar
 *   GET/POST    /api/helpdesk/settings/categories       PATCH /categories/:id
 *   GET/POST    /api/helpdesk/settings/canned-replies   PATCH /canned-replies/:id
 *   GET/POST    /api/helpdesk/settings/locations        PATCH /locations/:id
 *   GET/POST    /api/helpdesk/settings/holidays         PATCH, DELETE /holidays/:id
 *
 * Who is on the IT team, HoldingAdmin only, in the main portal's
 * Administration, with no ticket contents:
 *   GET     /api/admin/it-team/teams
 *   PUT     /api/admin/it-team/teams/:id/members/:userId   { role: Agent | Lead }
 *   DELETE  /api/admin/it-team/teams/:id/members/:userId
 */

import { Router } from 'express';

import { ROLES } from '../../lib/roles.js';
import { requireIt, requireRole } from '../../middleware/auth.js';
import { idParam as personParam, peopleQuery } from '../directory/schema.js';
import {
  calendarBody,
  cannedCreateBody,
  cannedUpdateBody,
  categoryCreateBody,
  categoryUpdateBody,
  holidayCreateBody,
  holidayQuery,
  holidayUpdateBody,
  idParam,
  locationCreateBody,
  locationUpdateBody,
  memberBody,
  memberParams,
  reportQuery,
  slaBody,
  teamQuery,
  teamUpdateBody,
} from '../tickets/schema.js';

/**
 * @param {object} deps
 * @param {ReturnType<import('../tickets/reports.js').createReportService>} deps.reports
 * @param {ReturnType<import('../directory/service.js').createDirectoryService>} deps.directory
 */
export function helpdeskRoutes({ reports, directory }) {
  const router = Router();
  router.use(requireIt());

  router.get('/reports', async (req, res) => {
    res.json(await reports.report(req, reportQuery.parse(req.query)));
  });

  router.get('/reports/export.csv', async (req, res) => {
    const { fileName, csv } = await reports.exportCsv(req, reportQuery.parse(req.query));
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(csv);
  });

  router.get('/people', async (req, res) => {
    res.json(await directory.searchPeople(req, peopleQuery.parse(req.query)));
  });

  router.get('/people/:id', async (req, res) => {
    const { id } = personParam.parse(req.params);
    res.json(await directory.getPerson(req, id));
  });

  return router;
}

/** @param {ReturnType<import('../tickets/admin-service.js').createHelpdeskAdminService>} admin */
export function helpdeskSettingsRoutes(admin) {
  const router = Router();
  router.use(requireIt({ lead: true }));

  /* ---- the team's own settings: name, served companies, targets, hours */
  router.get('/teams', async (req, res) => {
    res.json(await admin.listTeams(req));
  });

  router.patch('/teams/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await admin.updateTeam(req, id, teamUpdateBody.parse(req.body)));
  });

  router.put('/teams/:id/sla', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await admin.setSla(req, id, slaBody.parse(req.body)));
  });

  router.put('/teams/:id/calendar', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await admin.setCalendar(req, id, calendarBody.parse(req.body)));
  });

  /* ---- categories and canned replies */
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

  /* ---- locations and holidays, shared by every team */
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

/** @param {ReturnType<import('../tickets/admin-service.js').createHelpdeskAdminService>} admin */
export function itTeamRoutes(admin) {
  const router = Router();
  router.use(requireRole(ROLES.HOLDING_ADMIN));

  router.get('/teams', async (req, res) => {
    res.json(await admin.listMembership(req));
  });

  router.put('/teams/:id/members/:userId', async (req, res) => {
    const { id, userId } = memberParams.parse(req.params);
    res.json(await admin.setMember(req, id, userId, memberBody.parse(req.body)));
  });

  router.delete('/teams/:id/members/:userId', async (req, res) => {
    const { id, userId } = memberParams.parse(req.params);
    res.json(await admin.removeMember(req, id, userId));
  });

  return router;
}
