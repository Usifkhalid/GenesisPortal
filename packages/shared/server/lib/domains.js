/**
 * domains.js — a company's mail domain, as both apps accept it (zod): the
 * portal's Company admin and the helpdesk's Administration > Companies.
 */

import { z } from 'zod';

/** A mail domain: dotted lower-case labels, e.g. masar.eg. */
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(DOMAIN, 'A mail domain such as example.com');

/** One to five domains, each once. The first is the company's main one. */
export const domainsSchema = z
  .array(domainSchema)
  .min(1)
  .max(5)
  .refine((list) => new Set(list).size === list.length, 'Each domain once');
