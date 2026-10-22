/**
 * roles.js — the role names stored in RoleAssignment.role. SQL Server has no
 * enum type, so this list and the zod schema built from it are the constraint.
 */

import { z } from 'zod';

export const ROLES = Object.freeze({
  /** Every company. Its assignment has scopeCompanyId NULL. */
  HOLDING_ADMIN: 'HoldingAdmin',
  /** One company, named by scopeCompanyId. */
  COMPANY_ADMIN: 'CompanyAdmin',
  USER: 'User',
});

export const roleSchema = z.enum(Object.values(ROLES));

/**
 * The IT side a person works on, from their memberships of active support
 * teams: 'Lead' when they lead any, 'Agent' when they are only an agent, null
 * when they are on none. IT team members work in /helpdesk only and have no
 * main-portal access (docs/DECISIONS.md D135).
 * @param {{ role: string }[]} memberships
 * @returns {'Lead' | 'Agent' | null}
 */
export function itRoleOf(memberships) {
  if (memberships.some((m) => m.role === 'Lead')) return 'Lead';
  return memberships.length > 0 ? 'Agent' : null;
}
