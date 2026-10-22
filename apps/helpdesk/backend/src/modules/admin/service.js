/**
 * service.js — the companies the helpdesk serves and their mail domains,
 * HoldingAdmin only (Administration > Companies). A person signing in is
 * placed in a company by their email's domain (modules/auth/provision.js), and
 * the directory sync does the same, so these rows decide who gets in.
 *
 * Every write is one transaction holding the change and its audit row
 * (lib/audit.js). Errors a form can act on carry a stable code (docs/API.md):
 *   code_taken, domain_taken, accent_not_accessible, stale_record,
 *   nothing_to_change.
 */

import { writeAudit } from '@mg/shared/server/lib/audit.js';
import { assertHoldingAdmin } from '@mg/shared/server/lib/scope.js';
import { HttpError } from '@mg/shared/server/middleware/errors.js';
import { checkAccent } from '@mg/shared/web/assets/js/accent.js';

const notFound = () => new HttpError(404, 'not_found');
const stale = () =>
  new HttpError(409, 'stale_record', 'This record was changed by someone else. Reload it.');

const snapshot = (c) => ({
  code: c.code,
  nameEn: c.nameEn,
  nameAr: c.nameAr,
  domains: c.domains,
  accentColor: c.accentColor,
  isActive: c.isActive,
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

/** @param {{ store: ReturnType<import('./store-prisma.js').createPrismaCompanyStore> }} deps */
export function createCompanyService({ store }) {
  async function listCompanies(req) {
    assertHoldingAdmin(req);
    return { items: await store.listCompanies() };
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
      await writeAudit(req, 'company.create', 'Company', null, snapshot(created), {
        tx,
        entityId: created.id,
        companyId: created.id,
      });
      // The IT team serves the new company at once; a database with no team
      // yet gets one (tickets/defaults.js, D141).
      await tx.ensureHelpdeskDefaults(req);
      return created;
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
        if (new Date(updatedAt).getTime() !== new Date(before.updatedAt).getTime())
          throw stale();
        return before;
      }
      if (changes.domains) await assertDomainsFree(tx, changes.domains, id);

      const after = await tx.updateCompany(id, changes, new Date(updatedAt));
      if (!after) throw stale();

      const action =
        changes.isActive === undefined || changes.isActive === before.isActive
          ? 'company.update'
          : changes.isActive
            ? 'company.reactivate'
            : 'company.deactivate';
      await writeAudit(req, action, 'Company', snapshot(before), snapshot(after), {
        tx,
        entityId: id,
        companyId: id,
      });
      return after;
    });
  }

  return { listCompanies, createCompany, updateCompany };
}
