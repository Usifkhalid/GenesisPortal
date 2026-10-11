/**
 * service.js — the admin module's rules, apart from HTTP and from storage.
 *
 * Who may do what is decided here, through lib/scope.js, from req.user; a
 * companyId or an id from the client is only ever a request. Every write is
 * one transaction holding the change and its single audit row (lib/audit.js).
 *
 * Errors a form can act on carry a stable code (docs/API.md):
 *   stale_record, code_taken, domain_taken, department_name_taken,
 *   accent_not_accessible, already_assigned, cannot_remove_own_role,
 *   last_holding_admin, unsupported_image, logo_too_large.
 */

import { randomUUID } from 'node:crypto';

import { checkAccent } from '../../../../frontend/assets/js/accent.js';
import { writeAudit } from '../../lib/audit.js';
import { detectImage } from '../../lib/image-type.js';
import { ROLES } from '../../lib/roles.js';
import {
  adminCompanyIdsFor,
  assertCompanyAdmin,
  assertHoldingAdmin,
  isHoldingAdmin,
  requireUser,
} from '../../lib/scope.js';
import { cairoDayEnd, cairoDayStart, formatCairo } from '../../lib/time.js';
import { HttpError } from '../../middleware/errors.js';
import { toCsv } from './csv.js';

export const MAX_LOGO_BYTES = 512 * 1024;
const MAX_EXPORT_ROWS = 10_000;

const notFound = () => new HttpError(404, 'not_found');
const stale = () =>
  new HttpError(409, 'stale_record', 'This record was changed by someone else. Reload it.');

/** The company as the API returns it: the storage key stays inside. */
const publicCompany = ({ logoKey: _logoKey, ...company }) => company;

const companySnapshot = (c) => ({
  code: c.code,
  nameEn: c.nameEn,
  nameAr: c.nameAr,
  domains: c.domains,
  accentColor: c.accentColor,
  logoUrl: c.logoUrl,
  showMobileInDirectory: c.showMobileInDirectory,
  isActive: c.isActive,
});

const departmentSnapshot = (d) => ({
  companyId: d.companyId,
  nameEn: d.nameEn,
  nameAr: d.nameAr,
  isActive: d.isActive,
});

const assignmentSnapshot = (a) => ({
  userId: a.user.id,
  userEmail: a.user.email,
  role: a.role,
  scopeCompanyId: a.scopeCompanyId,
});

const minimalCompany = (c) => ({
  id: c.id,
  code: c.code,
  nameEn: c.nameEn,
  nameAr: c.nameAr,
  isActive: c.isActive,
});

const publicAssignment = (a) => ({
  id: a.id,
  role: a.role,
  createdAt: a.createdAt,
  user: {
    id: a.user.id,
    displayNameEn: a.user.displayNameEn,
    displayNameAr: a.user.displayNameAr,
    email: a.user.email,
    companyCode: a.user.companyCode,
    isActive: a.user.isActive,
  },
});

function assertAccent(color) {
  const verdict = checkAccent(color);
  if (!verdict.ok) {
    throw new HttpError(
      400,
      'accent_not_accessible',
      'This colour cannot be made accessible by the design system.',
      { failed: verdict.failed }
    );
  }
  return verdict.normalized;
}

/** Throws domain_taken for the first domain another company already owns. */
async function assertDomainsFree(store, domains, companyId = null) {
  const owners = await store.domainOwners(domains);
  const clash = owners.find((o) => o.companyId !== companyId);
  if (clash) {
    throw new HttpError(409, 'domain_taken', 'That mail domain belongs to another company.', {
      domain: clash.domain,
    });
  }
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./store-prisma.js').createPrismaAdminStore>} deps.store
 * @param {ReturnType<import('../../lib/storage.js').createLocalStorage>} deps.storage
 */
export function createAdminService({ store, storage }) {
  /* ---------------------------------------------------------------- scope */

  /** The companies this person administers; a holding admin gets them all. */
  async function adminScope(req) {
    const holdingAdmin = isHoldingAdmin(req);
    const ids = adminCompanyIdsFor(req);
    const all = await store.listCompanies();
    const companies = ids === null ? all : all.filter((c) => ids.includes(c.id));
    return { holdingAdmin, companies: companies.map(minimalCompany) };
  }

  /* ------------------------------------------------------------ companies */

  async function listCompanies(req, { status }) {
    assertHoldingAdmin(req);
    const active = status === 'all' ? undefined : status === 'active';
    const items = await store.listCompanies({ active });
    return { items: items.map(publicCompany) };
  }

  async function getCompany(req, id) {
    assertHoldingAdmin(req);
    const company = await store.getCompany(id);
    if (!company) throw notFound();
    return publicCompany(company);
  }

  async function createCompany(req, body) {
    assertHoldingAdmin(req);
    const accentColor = assertAccent(body.accentColor);

    return store.transaction(async (tx) => {
      if (await tx.getCompanyByCode(body.code)) {
        throw new HttpError(409, 'code_taken', 'That company code is already in use.');
      }
      await assertDomainsFree(tx, body.domains);

      const created = await tx.createCompany({ ...body, accentColor });
      await writeAudit(req, 'company.create', 'Company', null, companySnapshot(created), {
        tx,
        entityId: created.id,
        companyId: created.id,
      });
      return publicCompany(created);
    });
  }

  async function updateCompany(req, id, { updatedAt, ...changes }) {
    assertHoldingAdmin(req);
    if (Object.keys(changes).length === 0) {
      throw new HttpError(400, 'nothing_to_change', 'Nothing to change.');
    }
    if (changes.accentColor !== undefined)
      changes.accentColor = assertAccent(changes.accentColor);

    return store.transaction(async (tx) => {
      const before = await tx.getCompany(id);
      if (!before) throw notFound();

      const differs = Object.entries(changes).some(
        ([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])
      );
      if (!differs) {
        if (new Date(updatedAt).getTime() !== new Date(before.updatedAt).getTime()) {
          throw stale();
        }
        return publicCompany(before);
      }

      if (changes.domains) await assertDomainsFree(tx, changes.domains, id);

      const after = await tx.updateCompany(id, changes, new Date(updatedAt));
      if (!after) throw stale();

      await writeAudit(
        req,
        'company.update',
        'Company',
        companySnapshot(before),
        companySnapshot(after),
        {
          tx,
          entityId: id,
          companyId: id,
        }
      );
      return publicCompany(after);
    });
  }

  async function setActive(req, id, isActive, updatedAt) {
    assertHoldingAdmin(req);

    return store.transaction(async (tx) => {
      const before = await tx.getCompany(id);
      if (!before) throw notFound();
      if (before.isActive === isActive) {
        if (new Date(updatedAt).getTime() !== new Date(before.updatedAt).getTime()) {
          throw stale();
        }
        return publicCompany(before);
      }

      const after = await tx.updateCompany(id, { isActive }, new Date(updatedAt));
      if (!after) throw stale();

      const action = isActive ? 'company.reactivate' : 'company.deactivate';
      await writeAudit(
        req,
        action,
        'Company',
        companySnapshot(before),
        companySnapshot(after),
        {
          tx,
          entityId: id,
          companyId: id,
        }
      );
      return publicCompany(after);
    });
  }

  /* ----------------------------------------------------------------- logo */

  async function setLogo(req, id, buffer, updatedAt) {
    assertHoldingAdmin(req);

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new HttpError(400, 'empty_upload', 'No file was sent.');
    }
    if (buffer.length > MAX_LOGO_BYTES) {
      throw new HttpError(413, 'logo_too_large', 'The logo is larger than 512 KB.');
    }
    const kind = detectImage(buffer);
    if (!kind) {
      throw new HttpError(
        415,
        'unsupported_image',
        'The logo must be a PNG, JPEG or WebP image.'
      );
    }

    const existing = await store.getCompany(id);
    if (!existing) throw notFound();

    const token = randomUUID();
    const logoKey = `logo-${id}-${token}.${kind.ext}`;
    const logoUrl = `/api/companies/${id}/logo?v=${token}`;

    await storage.put(logoKey, buffer);
    let after;
    try {
      after = await store.transaction(async (tx) => {
        const before = await tx.getCompany(id);
        const updated = await tx.updateCompany(id, { logoKey, logoUrl }, new Date(updatedAt));
        if (!updated) throw stale();
        await writeAudit(
          req,
          'company.logo.update',
          'Company',
          companySnapshot(before),
          companySnapshot(updated),
          { tx, entityId: id, companyId: id }
        );
        return updated;
      });
    } catch (err) {
      // The new file is not referenced by anything: do not leave it behind.
      await storage.remove(logoKey);
      throw err;
    }

    // Replacing a logo removes the old file.
    if (existing.logoKey && existing.logoKey !== logoKey) {
      await storage.remove(existing.logoKey);
    }
    return publicCompany(after);
  }

  async function removeLogo(req, id, updatedAt) {
    assertHoldingAdmin(req);

    const { before, after } = await store.transaction(async (tx) => {
      const current = await tx.getCompany(id);
      if (!current) throw notFound();
      if (!current.logoUrl && !current.logoKey) return { before: current, after: current };

      const updated = await tx.updateCompany(
        id,
        { logoKey: null, logoUrl: null },
        new Date(updatedAt)
      );
      if (!updated) throw stale();
      await writeAudit(
        req,
        'company.logo.remove',
        'Company',
        companySnapshot(current),
        companySnapshot(updated),
        { tx, entityId: id, companyId: id }
      );
      return { before: current, after: updated };
    });

    if (before.logoKey && before.logoKey !== after.logoKey)
      await storage.remove(before.logoKey);
    return publicCompany(after);
  }

  /** The bytes and type of a company's uploaded logo, for the serving route. */
  async function readLogo(id) {
    const company = await store.getCompany(id);
    if (!company?.logoKey) return null;
    const buffer = await storage.get(company.logoKey);
    const kind = buffer && detectImage(buffer);
    return kind ? { buffer, type: kind.type } : null;
  }

  /* ---------------------------------------------------------- departments */

  /** The company a department request is about, which the person must administer. */
  function departmentCompanyId(req, requested) {
    if (requested) return requested;
    const admin = adminCompanyIdsFor(req);
    return admin?.[0] ?? requireUser(req).companyId;
  }

  async function listDepartments(req, { companyId, status }) {
    const id = departmentCompanyId(req, companyId);
    assertCompanyAdmin(req, id);
    if (!(await store.getCompany(id))) throw notFound();

    const active = status === 'all' ? undefined : status === 'active';
    return { companyId: id, items: await store.listDepartments(id, { active }) };
  }

  async function createDepartment(req, { companyId, nameEn, nameAr }) {
    assertCompanyAdmin(req, companyId);

    return store.transaction(async (tx) => {
      if (!(await tx.getCompany(companyId))) throw notFound();
      await assertNamesFree(tx, companyId, { nameEn, nameAr });

      const created = await tx.createDepartment({ companyId, nameEn, nameAr });
      await writeAudit(
        req,
        'department.create',
        'Department',
        null,
        departmentSnapshot(created),
        {
          tx,
          entityId: created.id,
          companyId,
        }
      );
      return created;
    });
  }

  async function assertNamesFree(tx, companyId, names, exceptId = null) {
    const field = await tx.departmentNameTaken(companyId, names, exceptId);
    if (field) {
      throw new HttpError(409, 'department_name_taken', 'A department already has that name.', {
        field,
      });
    }
  }

  /** The department, once the person is known to administer its company. */
  async function ownDepartment(req, tx, id) {
    const department = await tx.getDepartment(id);
    // A department of a company outside the person's reach does not exist for them.
    if (!department) throw notFound();
    assertCompanyAdmin(req, department.companyId);
    return department;
  }

  async function updateDepartment(req, id, { updatedAt, ...changes }) {
    if (Object.keys(changes).length === 0) {
      throw new HttpError(400, 'nothing_to_change', 'Nothing to change.');
    }

    return store.transaction(async (tx) => {
      const before = await ownDepartment(req, tx, id);
      const differs = Object.entries(changes).some(([key, value]) => before[key] !== value);
      if (!differs) {
        if (new Date(updatedAt).getTime() !== new Date(before.updatedAt).getTime()) {
          throw stale();
        }
        return before;
      }
      await assertNamesFree(tx, before.companyId, changes, id);

      const after = await tx.updateDepartment(id, changes, new Date(updatedAt));
      if (!after) throw stale();
      await writeAudit(
        req,
        'department.update',
        'Department',
        departmentSnapshot(before),
        departmentSnapshot(after),
        { tx, entityId: id, companyId: before.companyId }
      );
      return after;
    });
  }

  async function setDepartmentActive(req, id, isActive, updatedAt) {
    return store.transaction(async (tx) => {
      const before = await ownDepartment(req, tx, id);
      if (before.isActive === isActive) {
        if (new Date(updatedAt).getTime() !== new Date(before.updatedAt).getTime()) {
          throw stale();
        }
        return before;
      }

      const after = await tx.updateDepartment(id, { isActive }, new Date(updatedAt));
      if (!after) throw stale();
      await writeAudit(
        req,
        isActive ? 'department.reactivate' : 'department.deactivate',
        'Department',
        departmentSnapshot(before),
        departmentSnapshot(after),
        { tx, entityId: id, companyId: before.companyId }
      );
      return after;
    });
  }

  /* --------------------------------------------------------------- admins */

  async function listAdmins(req) {
    assertHoldingAdmin(req);
    const [companies, assignments] = await Promise.all([
      store.listCompanies(),
      store.listAssignments(),
    ]);

    return {
      holding: assignments.filter((a) => a.role === ROLES.HOLDING_ADMIN).map(publicAssignment),
      companies: companies.map((company) => ({
        company: minimalCompany(company),
        admins: assignments
          .filter((a) => a.role === ROLES.COMPANY_ADMIN && a.scopeCompanyId === company.id)
          .map(publicAssignment),
      })),
    };
  }

  async function searchPeople(req, { q }) {
    assertHoldingAdmin(req);
    return { items: await store.searchUsers(q) };
  }

  async function assignRole(req, { userId, role, companyId }) {
    assertHoldingAdmin(req);
    const scopeCompanyId = role === ROLES.HOLDING_ADMIN ? null : companyId;

    return store.transaction(async (tx) => {
      const user = await tx.getUser(userId);
      if (!user?.isActive) throw notFound();
      if (scopeCompanyId && !(await tx.getCompany(scopeCompanyId))) throw notFound();

      if (await tx.findAssignment(userId, role, scopeCompanyId)) {
        throw new HttpError(409, 'already_assigned', 'This person already holds that role.');
      }

      const created = await tx.createAssignment({ userId, role, scopeCompanyId });
      await writeAudit(
        req,
        'role.assign',
        'RoleAssignment',
        null,
        assignmentSnapshot(created),
        {
          tx,
          entityId: created.id,
          companyId: scopeCompanyId,
        }
      );
      return publicAssignment(created);
    });
  }

  async function removeRole(req, id) {
    assertHoldingAdmin(req);

    return store.transaction(async (tx) => {
      const assignment = await tx.getAssignment(id);
      if (!assignment) throw notFound();

      if (assignment.role === ROLES.HOLDING_ADMIN) {
        if (assignment.user.id === req.user.id) {
          throw new HttpError(
            409,
            'cannot_remove_own_role',
            'You cannot remove your own holding admin role.'
          );
        }
        if ((await tx.countOtherActiveHoldingAdmins(id)) === 0) {
          throw new HttpError(
            409,
            'last_holding_admin',
            'The last active holding admin cannot be removed.'
          );
        }
      }

      await tx.deleteAssignment(id);
      await writeAudit(
        req,
        'role.remove',
        'RoleAssignment',
        assignmentSnapshot(assignment),
        null,
        {
          tx,
          entityId: id,
          companyId: assignment.scopeCompanyId,
        }
      );
      return { removed: true };
    });
  }

  /* ---------------------------------------------------------------- audit */

  /**
   * The store filter for a request: the person's own reach first, then what
   * they asked to narrow it to. A holding admin reaches every entry; a company
   * admin only those of the companies they administer.
   */
  function auditFilter(req, query = {}) {
    const holdingAdmin = isHoldingAdmin(req);
    const admin = adminCompanyIdsFor(req);
    if (!holdingAdmin && (!admin || admin.length === 0)) throw new HttpError(403, 'forbidden');

    const filter = {
      from: query.from ? cairoDayStart(query.from) : undefined,
      to: query.to ? cairoDayEnd(query.to) : undefined,
      actorId: query.actorId,
      action: query.action,
      entity: query.entity,
      companyIds: holdingAdmin ? null : admin,
      includeHolding: false,
    };

    if (query.companyId === 'holding') {
      if (!holdingAdmin) throw notFound();
      filter.includeHolding = true;
    } else if (query.companyId) {
      if (!holdingAdmin && !admin.includes(query.companyId)) throw notFound();
      filter.companyIds = [query.companyId];
    }
    return filter;
  }

  async function listAudit(req, query) {
    const { page, pageSize, ...rest } = query;
    const filter = auditFilter(req, rest);
    const { items, total } = await store.queryAudit(filter, {
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, page, pageSize, total };
  }

  async function auditFacets(req) {
    const scope = auditFilter(req);
    const [facets, companies] = await Promise.all([store.auditFacets(scope), adminScope(req)]);
    return {
      ...facets,
      holdingAdmin: companies.holdingAdmin,
      companies: companies.companies,
    };
  }

  async function getAudit(req, id) {
    const filter = auditFilter(req);
    const row = await store.getAudit(id);
    if (!row) throw notFound();
    const inReach = filter.companyIds === null || filter.companyIds.includes(row.companyId);
    if (!inReach) throw notFound();
    return row;
  }

  /** The current filter as CSV. The export is itself an audit entry. */
  async function exportAudit(req, query) {
    const filter = auditFilter(req, query);
    const rows = await store.exportAudit(filter, { take: MAX_EXPORT_ROWS });

    const header = [
      'at (Africa/Cairo)',
      'at (UTC)',
      'actor',
      'actor email',
      'company',
      'action',
      'entity',
      'entity id',
      'ip',
      'before',
      'after',
    ];
    const table = rows.map((r) => [
      formatCairo(new Date(r.at)),
      new Date(r.at).toISOString(),
      r.actor?.displayNameEn ?? '',
      r.actor?.email ?? '',
      r.companyCode ?? '',
      r.action,
      r.entity,
      r.entityId ?? '',
      r.ip ?? '',
      r.before ?? '',
      r.after ?? '',
    ]);

    // Filed under the company when the export is of exactly one, so that
    // company's admin can see that their log was exported.
    const companyId = filter.companyIds?.length === 1 ? filter.companyIds[0] : null;
    await store.transaction((tx) =>
      writeAudit(
        req,
        'audit.export',
        'AuditLog',
        null,
        { filter: query, rows: rows.length, truncated: rows.length >= MAX_EXPORT_ROWS },
        { tx, entityId: null, companyId }
      )
    );

    return toCsv([header, ...table]);
  }

  return {
    adminScope,
    listCompanies,
    getCompany,
    createCompany,
    updateCompany,
    setActive,
    setLogo,
    removeLogo,
    readLogo,
    listDepartments,
    createDepartment,
    updateDepartment,
    setDepartmentActive,
    listAdmins,
    searchPeople,
    assignRole,
    removeRole,
    listAudit,
    auditFacets,
    getAudit,
    exportAudit,
  };
}
