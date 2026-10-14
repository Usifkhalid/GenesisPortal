/**
 * schema.js — what the sign-in routes accept.
 */

import { z } from 'zod';

export const mockLoginBody = z.strictObject({
  userId: z.guid(),
});

/**
 * The query Entra redirects back with. Not strict, unlike every other schema:
 * the identity provider adds parameters of its own (session_state,
 * client_info) and may add more.
 */
export const entraCallbackQuery = z.object({
  code: z.string().min(1).max(8192).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(200).optional(),
  /** Entra's own words, with an AADSTS code; read for the code, never shown. */
  error_description: z.string().max(4000).optional(),
});
