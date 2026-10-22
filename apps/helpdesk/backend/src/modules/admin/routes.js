/**
 * routes.js — the helpdesk's Administration API, HoldingAdmin only (D144).
 * See docs/API.md.
 *
 *   GET    /api/admin/companies         every company, its domains and head count
 *   POST   /api/admin/companies         { code, nameEn, nameAr, domains, accentColor }
 *   PATCH  /api/admin/companies/:id     { updatedAt, nameEn?, nameAr?, domains?,
 *                                         accentColor?, isActive? }
 *   GET    /api/admin/people?q=…        the directory, to pick an IT team member
 *
 * Who is on the IT team is /api/admin/it-team (modules/helpdesk/routes.js,
 * shared with the portal).
 */

import { Router } from 'express';

import { ROLES } from '@mg/shared/server/lib/roles.js';
import { requireRole } from '@mg/shared/server/middleware/auth.js';
import { companyCreateBody, companyUpdateBody, idParam, peopleQuery } from './schema.js';

/**
 * @param {object} deps
 * @param {ReturnType<import('./service.js').createCompanyService>} deps.companies
 * @param {ReturnType<import('@mg/shared/server/modules/directory/service.js').createDirectoryService>} deps.directory
 */
export function adminRoutes({ companies, directory }) {
  const router = Router();
  router.use(requireRole(ROLES.HOLDING_ADMIN));

  router.get('/companies', async (req, res) => {
    res.json(await companies.listCompanies(req));
  });

  router.post('/companies', async (req, res) => {
    res.status(201).json(await companies.createCompany(req, companyCreateBody.parse(req.body)));
  });

  router.patch('/companies/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await companies.updateCompany(req, id, companyUpdateBody.parse(req.body)));
  });

  router.get('/people', async (req, res) => {
    res.json(await directory.searchPeople(req, peopleQuery.parse(req.query)));
  });

  return router;
}
