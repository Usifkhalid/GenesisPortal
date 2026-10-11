/**
 * routes.js — the directory module's HTTP surface. See docs/API.md.
 *
 *   GET  /api/directory/people?q=&companyId=&departmentId=&lang=&page=&pageSize=
 *   GET  /api/directory/people/:id
 *   GET  /api/directory/filters
 *
 *   GET  /api/admin/directory/quality?companyId=         any administrator
 *   GET  /api/admin/directory/quality/export.csv?companyId=
 *   PATCH /api/admin/directory/people/:id                Arabic name; an admin of that person's company
 *   POST /api/admin/directory/arabic-names/preview       raw CSV (email, arabicName), 1 MB
 *   POST /api/admin/directory/arabic-names/apply         the same file again
 *   GET  /api/admin/directory/sync                       HoldingAdmin
 *   POST /api/admin/directory/sync                       HoldingAdmin, 202
 */

import express, { Router } from 'express';

import { ROLES } from '../../lib/roles.js';
import { requireRole } from '../../middleware/auth.js';
import { arabicNameBody, idParam, peopleQuery, qualityQuery, syncRunBody } from './schema.js';
import { MAX_IMPORT_BYTES } from './service.js';

const { HOLDING_ADMIN, COMPANY_ADMIN } = ROLES;
const anyAdmin = requireRole(HOLDING_ADMIN, COMPANY_ADMIN);
const holdingOnly = requireRole(HOLDING_ADMIN);

/** @param {ReturnType<import('./service.js').createDirectoryService>} service */
export function readerRoutes(service) {
  const router = Router();

  router.get('/people', async (req, res) => {
    res.json(await service.searchPeople(req, peopleQuery.parse(req.query)));
  });

  router.get('/people/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.getPerson(req, id));
  });

  router.get('/filters', async (req, res) => {
    res.json(await service.filters(req));
  });

  return router;
}

/** @param {ReturnType<import('./service.js').createDirectoryService>} service */
export function adminDirectoryRoutes(service) {
  const router = Router();

  router.get('/quality', anyAdmin, async (req, res) => {
    res.json(await service.qualityReport(req, qualityQuery.parse(req.query)));
  });

  router.get('/quality/export.csv', anyAdmin, async (req, res) => {
    const csv = await service.exportQuality(req, qualityQuery.parse(req.query));
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="directory-data-quality.csv"')
      .send(csv);
  });

  router.patch('/people/:id', anyAdmin, async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.setArabicName(req, id, arabicNameBody.parse(req.body)));
  });

  // The file itself is the body, whatever content type the browser gave it.
  const csvBody = express.raw({ type: () => true, limit: MAX_IMPORT_BYTES });

  router.post('/arabic-names/preview', anyAdmin, csvBody, async (req, res) => {
    res.json(await service.previewArabicNames(req, req.body));
  });

  router.post('/arabic-names/apply', anyAdmin, csvBody, async (req, res) => {
    res.json(await service.applyArabicNames(req, req.body));
  });

  router.get('/sync', holdingOnly, async (req, res) => {
    res.json(await service.syncHistory(req));
  });

  router.post('/sync', holdingOnly, async (req, res) => {
    const body = syncRunBody.parse(req.body ?? {});
    res.status(202).json(await service.runSync(req, body));
  });

  return router;
}
