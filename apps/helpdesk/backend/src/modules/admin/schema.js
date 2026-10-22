/**
 * schema.js — what the helpdesk's Administration routes accept. Every body and
 * query is a strictObject: a field this module does not know is an error.
 */

import { z } from 'zod';

import { domainsSchema } from '@mg/shared/server/lib/domains.js';
import { HEX_COLOUR } from '@mg/shared/web/assets/js/accent.js';

const trimmed = (max) => z.string().trim().min(1).max(max);
const accent = z.string().regex(HEX_COLOUR, 'A colour like #1c7a4a');

export const idParam = z.strictObject({ id: z.guid() });

export const companyCreateBody = z.strictObject({
  code: z.string().regex(/^[A-Z]{2,5}$/, '2 to 5 capital letters'),
  nameEn: trimmed(200),
  nameAr: trimmed(200),
  domains: domainsSchema,
  accentColor: accent,
});

export const companyUpdateBody = z.strictObject({
  /** The ISO timestamp the form was loaded with, for optimistic concurrency. */
  updatedAt: z.iso.datetime({ offset: true }),
  nameEn: trimmed(200).optional(),
  nameAr: trimmed(200).optional(),
  domains: domainsSchema.optional(),
  accentColor: accent.optional(),
  isActive: z.boolean().optional(),
});

export { peopleQuery } from '@mg/shared/server/modules/directory/schema.js';
