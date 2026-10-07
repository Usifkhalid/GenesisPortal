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
