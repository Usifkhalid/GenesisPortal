/**
 * provision.js — what an Entra sign-in does for a person the portal does not
 * know yet, and the one-time way in for the first HoldingAdmin (D136).
 *
 * Just-in-time profile: the ID token names the person (object id, name,
 * email); the email's domain places them in a company through Company.domain
 * or CompanyDomain. A domain no company owns creates nothing. Directory sync
 * fills in the rest of the profile later (job title, department, manager).
 *
 * Bootstrap: an email listed in INITIAL_HOLDING_ADMINS becomes HoldingAdmin at
 * sign-in while no active HoldingAdmin with a real Entra account exists. The
 * seeded stand-ins carry made-up object ids and do not count, so a database
 * seeded for development still lets the first real administrator in.
 */

import { parseEmailList } from '../../config/env.js';
import { writeAudit } from '../../lib/audit.js';

/** Every made-up object id in prisma/seed-data.js starts so. Entra's never do. */
const STAND_IN_OID_PREFIX = '00000000-0000-4000-';

const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

/** The domain of an address, or null when it is not one. */
export const domainOf = (email) => EMAIL.exec(email ?? '')?.[1]?.toLowerCase() ?? null;

/** The audit trail's view of a person acting on their own behalf at sign-in. */
const asSelf = (req, userId) => ({ user: { id: userId }, ip: req.ip });

/**
 * Creates a profile for someone Entra has vouched for.
 * @returns {Promise<{ person: { id: string, isActive: boolean } } | { refused: string }>}
 */
export async function createProfileFromToken(req, repo, { oid, email, name }) {
  const domain = domainOf(email);
  if (!GUID.test(oid ?? '') || !domain || email.length > 320) {
    return { refused: 'signin_failed' };
  }

  const company = await repo.findCompanyByDomain(domain);
  if (!company) return { refused: 'company_not_set_up' };
  if (!company.isActive) return { refused: 'not_provisioned' };

  // No Arabic name is known yet; sync replaces both with the directory's.
  const displayName = (name || email.split('@')[0]).trim().slice(0, 200);
  const person = await repo.createEntraProfile(
    {
      entraObjectId: oid,
      email,
      companyId: company.id,
      displayNameEn: displayName,
      displayNameAr: displayName,
    },
    (tx, created) =>
      writeAudit(asSelf(req, created.id), 'user.jit_create', 'UserProfile', null, created, {
        tx,
      })
  );
  req.log?.info({ userId: person.id, companyId: company.id }, 'profile created at sign-in');
  return { person };
}

/**
 * Makes `person` HoldingAdmin if their email is listed and no real one exists.
 * Returns whether it did.
 */
export async function bootstrapHoldingAdmin(req, repo, config, person, email) {
  if (!parseEmailList(config.INITIAL_HOLDING_ADMINS).includes(email)) return false;
  if (await repo.hasRealHoldingAdmin(STAND_IN_OID_PREFIX)) return false;

  const granted = await repo.grantHoldingAdmin(person.id, (tx, assignment) =>
    writeAudit(asSelf(req, person.id), 'role.bootstrap', 'RoleAssignment', null, assignment, {
      tx,
      companyId: null,
    })
  );
  if (granted)
    req.log?.warn({ userId: person.id }, 'HoldingAdmin granted by INITIAL_HOLDING_ADMINS');
  return granted;
}
