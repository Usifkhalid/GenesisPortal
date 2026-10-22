/**
 * schema.js — what the announcement routes accept. Strict objects: an unknown
 * field is an error. Markdown is sanitised by the service, not here.
 */

import { z } from 'zod';

import { CATEGORIES, STATUSES } from './rules.js';

const text = (max) => z.string().trim().max(max);
const instant = z.iso.datetime({ offset: true });

export const idParam = z.strictObject({ id: z.guid() });

const content = {
  titleEn: text(200),
  titleAr: text(200),
  summaryEn: text(400),
  summaryAr: text(400),
  bodyEn: z.string().max(20_000),
  bodyAr: z.string().max(20_000),
  category: z.enum(CATEGORIES),
  coverAltEn: text(300),
  coverAltAr: text(300),
  isPinned: z.boolean(),
  publishAt: instant.nullable(),
  expiresAt: instant.nullable(),
};

/** companyId is explicit: a GUID, or null for a holding-wide post. */
export const createBody = z.strictObject({
  companyId: z.guid().nullable(),
  titleEn: content.titleEn.default(''),
  titleAr: content.titleAr.default(''),
  summaryEn: content.summaryEn.default(''),
  summaryAr: content.summaryAr.default(''),
  bodyEn: content.bodyEn.default(''),
  bodyAr: content.bodyAr.default(''),
  category: content.category.default('General'),
  coverAltEn: content.coverAltEn.default(''),
  coverAltAr: content.coverAltAr.default(''),
  isPinned: content.isPinned.default(false),
  publishAt: content.publishAt.default(null),
  expiresAt: content.expiresAt.default(null),
});

export const updateBody = z.strictObject({
  updatedAt: instant,
  companyId: z.guid().nullable().optional(),
  ...Object.fromEntries(Object.entries(content).map(([k, v]) => [k, v.optional()])),
});

export const publishBody = z.strictObject({
  updatedAt: instant,
  /** Omitted: now. A future instant schedules instead. */
  publishAt: instant.optional(),
});

export const concurrencyBody = z.strictObject({ updatedAt: instant });
export const concurrencyQuery = z.strictObject({ updatedAt: instant });

const paging = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
};

export const readerListQuery = z.strictObject({
  category: z.enum(CATEGORIES).optional(),
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  ...paging,
});

export const adminListQuery = z.strictObject({
  status: z.enum(STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  /** A company id, or "holding" for holding-wide posts. */
  companyId: z.union([z.guid(), z.literal('holding')]).optional(),
  ...paging,
});
