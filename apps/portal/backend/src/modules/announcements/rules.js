/**
 * rules.js — what an announcement is, independent of storage: the category
 * list, the derived status, and which languages are usable. Shared by both
 * stores and the service so they cannot disagree.
 */

export const CATEGORIES = Object.freeze(['General', 'HR', 'IT', 'HSE', 'Events', 'Policy']);
export const STATUSES = Object.freeze(['Draft', 'Scheduled', 'Published', 'Expired']);

export const MAX_COVER_BYTES = 2 * 1024 * 1024;

/**
 * Draft until it has a publishAt; Expired once expiresAt has passed;
 * Scheduled while publishAt lies ahead; otherwise Published. Never stored.
 * @param {{ publishAt: Date | null, expiresAt: Date | null }} row
 * @param {Date} now
 */
export function statusOf(row, now) {
  if (!row.publishAt) return 'Draft';
  if (row.expiresAt && row.expiresAt <= now) return 'Expired';
  if (row.publishAt > now) return 'Scheduled';
  return 'Published';
}

/** Is the post on the board for readers right now? */
export const isLive = (row, now) => statusOf(row, now) === 'Published';

/** A language is complete when it has both a title and a body. */
export function completeLanguages(row) {
  return {
    en: Boolean(row.titleEn?.trim() && row.bodyEn?.trim()),
    ar: Boolean(row.titleAr?.trim() && row.bodyAr?.trim()),
  };
}
