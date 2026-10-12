/**
 * schema.js — what the room and booking routes accept. Every query and body is
 * a strictObject: a field this module does not know is an error, not ignored.
 *
 * Instants arrive as ISO 8601 with an offset or Z and are stored in UTC. A
 * calendar day ("2026-10-25") or a clock time ("10:30") is always Cairo's.
 */

import { z } from 'zod';

import { EQUIPMENT } from './rules.js';

export const idParam = z.strictObject({ id: z.guid() });

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'a real calendar date');

const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const equipment = z.array(z.enum(EQUIPMENT)).max(EQUIPMENT.length);

/** "screen,phone" in a query string. */
const equipmentQuery = z
  .string()
  .transform((value) => [...new Set(value.split(',').filter(Boolean))])
  .pipe(equipment)
  .optional();

const roomFilters = {
  /** At least this many seats. */
  capacity: z.coerce.number().int().min(1).max(500).optional(),
  /** Has every one of these. */
  equipment: equipmentQuery,
  floor: z.string().trim().min(1).max(50).optional(),
};

export const roomListQuery = z.strictObject(roomFilters);

export const availabilityQuery = z.strictObject({
  ...roomFilters,
  date: day,
  /** `week` is Cairo's Sunday-to-Saturday week that holds `date`. */
  view: z.enum(['day', 'week']).default('day'),
  roomId: z.guid().optional(),
});

export const findQuery = z.strictObject({
  date: day,
  /** Cairo clock time, "10:30". */
  start: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time as HH:MM')
    .transform((value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))),
  /** Minutes. */
  duration: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  people: z.coerce.number().int().min(1).max(500).default(1),
  equipment: equipmentQuery,
});

const subject = z.string().trim().min(1).max(200);

const recurrence = z.discriminatedUnion('type', [
  /** Every working day. */
  z.strictObject({ type: z.literal('daily'), until: day }),
  /** The chosen weekdays; 0 is Sunday. */
  z.strictObject({
    type: z.literal('weekly'),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    until: day,
  }),
]);

export const bookingCreateBody = z.strictObject({
  roomId: z.guid(),
  subject,
  start: instant,
  end: instant,
  /** People expected, the organiser included. Defaults to the attendees plus one. */
  attendeeCount: z.number().int().min(1).max(500).optional(),
  /** Portal users to invite. They may read the subject. */
  attendeeIds: z.array(z.guid()).max(50).default([]),
  recurrence: recurrence.nullish(),
});

export const bookingUpdateBody = z
  .strictObject({
    subject: subject.optional(),
    start: instant.optional(),
    end: instant.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')
  .refine((body) => (body.start === undefined) === (body.end === undefined), {
    message: 'send start and end together',
  });

export const bookingCancelBody = z.strictObject({
  /** `series` cancels this occurrence and every later one of its series. */
  scope: z.enum(['one', 'series']).default('one'),
  /** Why. Required of an administrator cancelling someone else's meeting. */
  reason: z.string().trim().min(1).max(500).optional(),
});

export const adminBookingQuery = z.strictObject({
  roomId: z.guid().optional(),
  companyId: z.guid().optional(),
  /** Cairo calendar days, inclusive. */
  from: day.optional(),
  to: day.optional(),
  status: z.enum(['confirmed', 'cancelled', 'all']).default('confirmed'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/* ------------------------------------------------------------- admin rooms */

const text = (max) => z.string().trim().min(1).max(max);
const updatedAt = z.iso.datetime({ offset: true });

const roomFields = {
  nameEn: text(200),
  nameAr: text(200),
  floor: z.string().trim().max(50).nullable(),
  capacity: z.number().int().min(1).max(500),
  equipment: equipment.transform((value) => [...new Set(value)]),
  notes: z.string().trim().max(1000),
  /** Empty: shared by every company. Otherwise only these companies. */
  companyIds: z
    .array(z.guid())
    .max(50)
    .transform((value) => [...new Set(value)]),
};

export const roomCreateBody = z.strictObject({
  mailboxEmail: z
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
  nameEn: roomFields.nameEn,
  nameAr: roomFields.nameAr,
  floor: roomFields.floor.default(null),
  capacity: roomFields.capacity,
  equipment: roomFields.equipment.default([]),
  notes: roomFields.notes.default(''),
  companyIds: roomFields.companyIds.default([]),
});

export const roomUpdateBody = z.strictObject({
  updatedAt,
  nameEn: roomFields.nameEn.optional(),
  nameAr: roomFields.nameAr.optional(),
  floor: roomFields.floor.optional(),
  capacity: roomFields.capacity.optional(),
  equipment: roomFields.equipment.optional(),
  notes: roomFields.notes.optional(),
  companyIds: roomFields.companyIds.optional(),
  isActive: z.boolean().optional(),
});

export const concurrencyQuery = z.strictObject({ updatedAt });
