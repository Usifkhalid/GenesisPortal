/**
 * defaults.js — the IT helpdesk's default team and settings (D141), unless
 * they came from the portal (D145).
 *
 * Once `npm run migrate:from-portal` has copied the portal's IT team, its
 * hours, SLA, categories, locations, holidays and canned replies are the ones
 * the IT leads chose there; adding a default beside them (a category the
 * portal renamed comes back under its old name) would duplicate them. So the
 * team is still made sure of, with the companies it serves, and nothing else.
 * Used by `npm run db:setup-live` and by creating a company in Administration.
 */

import { ensureHelpdeskDefaults } from '@mg/shared/server/modules/tickets/defaults.js';

/** True once the IT team was copied from the portal. */
export async function settingsFromPortal(db) {
  return (await db.portalImport.count({ where: { entity: 'SupportTeam' } })) > 0;
}

/** Companies copied from the portal: db:setup-live leaves their names and domains alone. */
export async function companiesFromPortal(db) {
  return (await db.portalImport.count({ where: { entity: 'Company' } })) > 0;
}

/**
 * @param {object} db  a client or a transaction
 * @param {{ req?: object | null }} [options]
 */
export async function ensureDefaults(db, { req = null } = {}) {
  return ensureHelpdeskDefaults(db, { req, settings: !(await settingsFromPortal(db)) });
}
