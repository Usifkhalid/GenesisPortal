/**
 * schema.js — what the admin routes accept. Every body and query is a
 * strictObject: a field this module does not know is an error, not ignored.
 */

import { z } from 'zod';

import { HEX_COLOUR } from '../../../../frontend/assets/js/accent.js';

const trimmed = (max) => z.string().trim().min(1).max(max);

/** A mail domain: dotted lower-case labels, e.g. masar.eg. */
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(DOMAIN, 'A mail domain such as example.com');

const domains = z
  .array(domainSchema)
  .min(1)
  .max(5)
  .refine((list) => new Set(list).size === list.length, 'Each domain once');

const accent = z.string().regex(HEX_COLOUR, 'A colour like #1c7a4a');

export const idParam = z.strictObject({ id: z.guid() });

/** The ISO timestamp the form was loaded with, for optimistic concurrency. */
const updatedAt = z.iso.datetime({ offset: true });

/* ---------------------------------------------------------------- companies */

export const companyListQuery = z.strictObject({
  status: z.enum(['active', 'inactive', 'all']).default('all'),
});

export const companyCreateBody = z.strictObject({
  code: z.string().regex(/^[A-Z]{2,5}$/, '2 to 5 capital letters'),
  nameEn: trimmed(200),
  nameAr: trimmed(200),
  domains,
  accentColor: accent,
});

export const companyUpdateBody = z.strictObject({
  updatedAt,
  nameEn: trimmed(200).optional(),
  nameAr: trimmed(200).optional(),
  domains: domains.optional(),
  accentColor: accent.optional(),
  showMobileInDirectory: z.boolean().optional(),
  /**
   * Working hours for room bookings: minutes after midnight on Cairo's clock,
   * on a quarter hour, and the working weekdays (0 is Sunday).
   */
  workdayStartMin: z.number().int().min(0).max(1425).multipleOf(15).optional(),
  workdayEndMin: z.number().int().min(15).max(1440).multipleOf(15).optional(),
  workingDays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .transform((days) => [...new Set(days)].sort())
    .optional(),
});

/** Deactivate, reactivate and the logo carry only what they were loaded at. */
export const concurrencyBody = z.strictObject({ updatedAt });
export const concurrencyQuery = z.strictObject({ updatedAt });

/* -------------------------------------------------------------- departments */

export const departmentListQuery = z.strictObject({
  companyId: z.guid().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
});

export const departmentCreateBody = z.strictObject({
  companyId: z.guid(),
  nameEn: trimmed(200),
  nameAr: trimmed(200),
});

export const departmentUpdateBody = z.strictObject({
  updatedAt,
  nameEn: trimmed(200).optional(),
  nameAr: trimmed(200).optional(),
});

/* ------------------------------------------------------------------- admins */

export const assignBody = z
  .strictObject({
    userId: z.guid(),
    role: z.enum(['HoldingAdmin', 'CompanyAdmin']),
    companyId: z.guid().optional(),
  })
  .refine((v) => (v.role === 'CompanyAdmin') === Boolean(v.companyId), {
    path: ['companyId'],
    message: 'A company admin names one company; a holding admin names none',
  });

export const peopleQuery = z.strictObject({
  q: z.string().trim().min(2).max(100),
});

/* -------------------------------------------------------------------- audit */

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A date like 2026-10-11')
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v), {
    message: 'A real calendar date',
  });

export const auditFilter = z.strictObject({
  from: day.optional(),
  to: day.optional(),
  actorId: z.guid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  entity: z.string().trim().min(1).max(100).optional(),
  /** A company id, or "holding" for entries that belong to no company. */
  companyId: z.union([z.guid(), z.literal('holding')]).optional(),
});

export const auditListQuery = auditFilter.extend({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
