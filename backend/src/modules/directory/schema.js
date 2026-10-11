/**
 * schema.js — what the directory routes accept. Every query and body is a
 * strictObject: a field this module does not know is an error, not ignored.
 */

import { z } from 'zod';

export const idParam = z.strictObject({ id: z.guid() });

export const peopleQuery = z.strictObject({
  q: z.string().trim().max(100).default(''),
  companyId: z.guid().optional(),
  departmentId: z.guid().optional(),
  /** The language the list is sorted in; the profile's own when omitted. */
  lang: z.enum(['en', 'ar']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

export const qualityQuery = z.strictObject({
  companyId: z.guid().optional(),
});

export const syncRunBody = z.strictObject({
  /** Confirms a run that would deactivate more than 20% of active people. */
  allowLargeDeactivation: z.boolean().default(false),
});
