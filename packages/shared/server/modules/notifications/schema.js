/**
 * schema.js — what the notification routes accept. Every query and body is a
 * strictObject: a field this module does not know is an error.
 */

import { z } from 'zod';

import { CATEGORIES, CHANNELS } from '../../../web/assets/js/notification-text.js';

export const listQuery = z.strictObject({
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const readBody = z.strictObject({
  ids: z.array(z.guid()).min(1).max(100),
});

export const preferencesBody = z.strictObject({
  items: z
    .array(
      z.strictObject({
        category: z.enum(CATEGORIES),
        channel: z.enum(CHANNELS),
        enabled: z.boolean(),
      })
    )
    .min(1)
    .max(CATEGORIES.length * CHANNELS.length),
});
