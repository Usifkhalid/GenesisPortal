/**
 * routes.js — the admin module's HTTP surface. See docs/API.md.
 *
 *   GET    /api/admin/scope                         companies this person administers
 *
 *   GET    /api/admin/companies                     HoldingAdmin
 *   POST   /api/admin/companies
 *   GET    /api/admin/companies/:id
 *   PATCH  /api/admin/companies/:id
 *   POST   /api/admin/companies/:id/deactivate
 *   POST   /api/admin/companies/:id/reactivate
 *   PUT    /api/admin/companies/:id/logo            raw PNG, JPEG or WebP, 512 KB
 *   DELETE /api/admin/companies/:id/logo
 *
 *   GET    /api/admin/departments                   HoldingAdmin, or CompanyAdmin of that company
 *   POST   /api/admin/departments
 *   PATCH  /api/admin/departments/:id
 *   POST   /api/admin/departments/:id/deactivate
 *   POST   /api/admin/departments/:id/reactivate
 *
 *   GET    /api/admin/admins                        HoldingAdmin
 *   POST   /api/admin/admins
 *   DELETE /api/admin/admins/:id
 *   GET    /api/admin/people?q=
 *
 *   GET    /api/admin/audit                         HoldingAdmin all, CompanyAdmin theirs
 *   GET    /api/admin/audit/facets
 *   GET    /api/admin/audit/export.csv
 *   GET    /api/admin/audit/:id
 *
 * and, for any signed-in person who may see the company:
 *   GET    /api/companies/:id/logo
 */

import express, { Router } from 'express';

import { ROLES } from '../../lib/roles.js';
import { assertCompanyAccess } from '../../lib/scope.js';
import { requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import {
  assignBody,
  auditFilter,
  auditListQuery,
  companyCreateBody,
  companyListQuery,
  companyUpdateBody,
  concurrencyBody,
  concurrencyQuery,
  departmentCreateBody,
  departmentListQuery,
  departmentUpdateBody,
  idParam,
  peopleQuery,
} from './schema.js';
import { MAX_LOGO_BYTES } from './service.js';

const { HOLDING_ADMIN, COMPANY_ADMIN } = ROLES;
const anyAdmin = requireRole(HOLDING_ADMIN, COMPANY_ADMIN);
const holdingOnly = requireRole(HOLDING_ADMIN);

/**
 * @param {ReturnType<import('./service.js').createAdminService>} service
 */
export function adminRoutes(service) {
  const router = Router();

  router.get('/scope', anyAdmin, async (req, res) => {
    res.json(await service.adminScope(req));
  });

  /* ------------------------------------------------------------ companies */
  router.get('/companies', holdingOnly, async (req, res) => {
    res.json(await service.listCompanies(req, companyListQuery.parse(req.query)));
  });

  router.post('/companies', holdingOnly, async (req, res) => {
    res.status(201).json(await service.createCompany(req, companyCreateBody.parse(req.body)));
  });

  router.get('/companies/:id', holdingOnly, async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.getCompany(req, id));
  });

  router.patch('/companies/:id', holdingOnly, async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.updateCompany(req, id, companyUpdateBody.parse(req.body)));
  });

  for (const [action, isActive] of [
    ['deactivate', false],
    ['reactivate', true],
  ]) {
    router.post(`/companies/:id/${action}`, holdingOnly, async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { updatedAt } = concurrencyBody.parse(req.body);
      res.json(await service.setActive(req, id, isActive, updatedAt));
    });
  }

  router.put(
    '/companies/:id/logo',
    holdingOnly,
    // Any content type: the file's own signature decides what it is.
    express.raw({ type: () => true, limit: MAX_LOGO_BYTES }),
    async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { updatedAt } = concurrencyQuery.parse(req.query);
      res.json(await service.setLogo(req, id, req.body, updatedAt));
    }
  );

  router.delete('/companies/:id/logo', holdingOnly, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { updatedAt } = concurrencyQuery.parse(req.query);
    res.json(await service.removeLogo(req, id, updatedAt));
  });

  /* ---------------------------------------------------------- departments */
  router.get('/departments', anyAdmin, async (req, res) => {
    res.json(await service.listDepartments(req, departmentListQuery.parse(req.query)));
  });

  router.post('/departments', anyAdmin, async (req, res) => {
    res
      .status(201)
      .json(await service.createDepartment(req, departmentCreateBody.parse(req.body)));
  });

  router.patch('/departments/:id', anyAdmin, async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.updateDepartment(req, id, departmentUpdateBody.parse(req.body)));
  });

  for (const [action, isActive] of [
    ['deactivate', false],
    ['reactivate', true],
  ]) {
    router.post(`/departments/:id/${action}`, anyAdmin, async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { updatedAt } = concurrencyBody.parse(req.body);
      res.json(await service.setDepartmentActive(req, id, isActive, updatedAt));
    });
  }

  /* --------------------------------------------------------------- admins */
  router.get('/admins', holdingOnly, async (req, res) => {
    res.json(await service.listAdmins(req));
  });

  router.post('/admins', holdingOnly, async (req, res) => {
    res.status(201).json(await service.assignRole(req, assignBody.parse(req.body)));
  });

  router.delete('/admins/:id', holdingOnly, async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.removeRole(req, id));
  });

  router.get('/people', holdingOnly, async (req, res) => {
    res.json(await service.searchPeople(req, peopleQuery.parse(req.query)));
  });

  /* ---------------------------------------------------------------- audit */
  router.get('/audit', anyAdmin, async (req, res) => {
    res.json(await service.listAudit(req, auditListQuery.parse(req.query)));
  });

  router.get('/audit/facets', anyAdmin, async (req, res) => {
    res.json(await service.auditFacets(req));
  });

  router.get('/audit/export.csv', anyAdmin, async (req, res) => {
    const csv = await service.exportAudit(req, auditFilter.parse(req.query));
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="audit-log.csv"')
      .send(csv);
  });

  router.get('/audit/:id', anyAdmin, async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.getAudit(req, id));
  });

  return router;
}

/**
 * The uploaded logo, for whoever may see the company. The address carries a
 * version (?v=), so the browser may keep it for a year: replacing the logo
 * changes the address, never the bytes behind one.
 */
export function logoRoutes(service) {
  const router = Router();

  router.get('/api/companies/:id/logo', async (req, res) => {
    const { id } = idParam.parse(req.params);
    assertCompanyAccess(req, id);

    const logo = await service.readLogo(id);
    if (!logo) throw new HttpError(404, 'not_found');

    res
      .set('Cache-Control', 'private, max-age=31536000, immutable')
      .set('Content-Security-Policy', "default-src 'none'")
      .type(logo.type)
      .send(logo.buffer);
  });

  return router;
}
