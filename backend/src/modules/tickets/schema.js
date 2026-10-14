/**
 * schema.js — what the ticket and helpdesk-admin routes accept. Every query
 * and body is a strictObject: a field this module does not know is an error.
 */

import { z } from 'zod';

import { isTimeZone } from '../../lib/sla.js';
import {
  MEMBER_ROLES,
  PRIORITIES,
  SETTABLE_STATUSES,
  SLA_FILTERS,
  SOURCES,
  STATUSES,
} from './rules.js';

const id = z.guid();
const text = (max) => z.string().trim().min(1).max(max);
const priority = z.enum(PRIORITIES);

export const idParam = z.strictObject({ id });
export const attachmentParams = z.strictObject({ id, attachmentId: id });
export const memberParams = z.strictObject({ id, userId: id });

const paging = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

/** `active` is New, Open and WaitingOnRequester together. */
const statusFilter = z.enum([...STATUSES, 'active', 'all']).default('active');

const search = z.string().trim().min(1).max(100).optional();

/* ------------------------------------------------------------- requesters */

export const createBody = z.strictObject({
  subject: text(200),
  description: text(10_000),
  categoryId: id,
  locationId: id.nullish(),
  assetTag: z.string().trim().max(100).nullish(),
  /** How urgent the requester says it is; the category's default when left out. */
  priority: priority.optional(),
  // The two below are for agents logging a ticket for someone else.
  requesterId: id.optional(),
  source: z.enum(SOURCES).optional(),
});

export const mineQuery = z.strictObject({ status: statusFilter, q: search, ...paging });

export const commentBody = z.strictObject({
  body: text(10_000),
  isInternal: z.boolean().default(false),
});

export const attachmentQuery = z.strictObject({
  /** The file's name; its extension must be on the allow-list. */
  name: text(200),
  /** The comment it belongs to; without it, the ticket's description. */
  commentId: id.optional(),
});

/* ----------------------------------------------------------------- agents */

export const queueQuery = z.strictObject({
  status: statusFilter,
  priority: priority.optional(),
  /** `unassigned`, `me`, or an agent's id. */
  assignee: z.union([z.enum(['unassigned', 'me']), id]).optional(),
  teamId: id.optional(),
  companyId: id.optional(),
  locationId: id.optional(),
  categoryId: id.optional(),
  sla: z.enum(SLA_FILTERS).optional(),
  q: search,
  ...paging,
});

export const updateBody = z
  .strictObject({
    /** null takes the ticket off whoever has it. */
    assigneeId: id.nullable().optional(),
    status: z.enum(SETTABLE_STATUSES).optional(),
    priority: priority.optional(),
    categoryId: id.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');

export const teamQuery = z.strictObject({ teamId: id.optional() });

/* ------------------------------------------------------------------ admin */

const companyIds = z
  .array(id)
  .max(100)
  .transform((value) => [...new Set(value)]);

/**
 * What a Lead may change about their team. Making or retiring a team is not
 * a screen's job (D135): a team without members would have no Lead to run it.
 */
export const teamUpdateBody = z
  .strictObject({
    nameEn: text(200).optional(),
    nameAr: text(200).optional(),
    servesAllCompanies: z.boolean().optional(),
    /** Read only when servesAllCompanies is false. */
    companyIds: companyIds.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');

export const memberBody = z.strictObject({ role: z.enum(MEMBER_ROLES) });

const categoryFields = {
  nameEn: text(200),
  nameAr: text(200),
  defaultPriority: priority,
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
};

export const categoryCreateBody = z.strictObject({
  teamId: id,
  nameEn: categoryFields.nameEn,
  nameAr: categoryFields.nameAr,
  defaultPriority: categoryFields.defaultPriority.default('P3'),
  sortOrder: categoryFields.sortOrder.default(0),
});

const partial = (fields) =>
  z
    .strictObject(
      Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, type.optional()]))
    )
    .refine((body) => Object.keys(body).length > 0, 'nothing to change');

export const categoryUpdateBody = partial(categoryFields);

const locationFields = {
  nameEn: text(200),
  nameAr: text(200),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
};

export const locationCreateBody = z.strictObject({
  nameEn: locationFields.nameEn,
  nameAr: locationFields.nameAr,
  sortOrder: locationFields.sortOrder.default(0),
});

export const locationUpdateBody = partial(locationFields);

/** Business minutes; a week of hours is the most a target may be. */
const minutes = z
  .number()
  .int()
  .min(1)
  .max(60 * 24 * 60);

export const slaBody = z.strictObject({
  policies: z
    .array(
      z
        .strictObject({ priority, firstResponseMinutes: minutes, resolveMinutes: minutes })
        .refine((p) => p.firstResponseMinutes <= p.resolveMinutes, {
          message: 'the first response cannot be due after the resolution',
        })
    )
    .length(PRIORITIES.length)
    .refine((list) => new Set(list.map((p) => p.priority)).size === PRIORITIES.length, {
      message: 'one policy for each priority',
    }),
});

const minuteOfDay = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);

export const calendarBody = z
  .strictObject({
    timeZone: z.string().trim().min(1).max(64).refine(isTimeZone, 'an IANA time zone'),
    workingDays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .transform((value) => [...new Set(value)].sort((a, b) => a - b)),
    startMin: minuteOfDay,
    endMin: minuteOfDay,
  })
  .refine((body) => body.endMin > body.startMin, {
    message: 'the day must end after it starts',
  });

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'a real calendar date');

export const holidayCreateBody = z.strictObject({
  date: day,
  nameEn: text(200),
  nameAr: text(200),
});

export const holidayUpdateBody = partial({ date: day, nameEn: text(200), nameAr: text(200) });

/** The Helpdesk's reports: Cairo calendar days, both ends included (reports.js). */
export const reportQuery = z.strictObject({
  from: day.optional(),
  to: day.optional(),
});

export const holidayQuery = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

const cannedFields = {
  titleEn: text(200),
  titleAr: text(200),
  bodyEn: text(5000),
  bodyAr: text(5000),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
};

export const cannedCreateBody = z.strictObject({
  teamId: id,
  titleEn: cannedFields.titleEn,
  titleAr: cannedFields.titleAr,
  bodyEn: cannedFields.bodyEn,
  bodyAr: cannedFields.bodyAr,
  sortOrder: cannedFields.sortOrder.default(0),
});

export const cannedUpdateBody = partial(cannedFields);
