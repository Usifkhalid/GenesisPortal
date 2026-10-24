/**
 * schema.js — what the sign-in routes accept.
 */

import { z } from 'zod';

export const mockLoginBody = z.strictObject({
  userId: z.guid(),
  /** The link the person opened before signing in; checked by safeReturnPath. */
  next: z.string().max(500).optional(),
});

/** GET /api/auth/config and /auth/login: where to go back to after sign-in. */
export const returnQuery = z.object({
  next: z.string().max(500).optional(),
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
