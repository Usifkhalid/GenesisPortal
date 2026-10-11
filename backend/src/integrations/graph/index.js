/**
 * integrations/graph — the only door to Microsoft Graph.
 *
 * No module outside this folder may call Graph or hold a Graph token. Callers
 * import `graph()` and get whichever implementation GRAPH_MODE selects, so a
 * feature written against the mock works unchanged against the real tenant.
 *
 * Real tenant access is not granted yet, so `mock` is the dev default and the
 * real client is proven only in session 19.
 */

import { env } from '../../config/env.js';

/**
 * A user as Graph returns it, limited to the fields the portal reads.
 * @typedef {object} GraphUser
 * @property {string} id  the Entra object id
 * @property {string | null} displayName
 * @property {string | null} mail
 * @property {string | null} userPrincipalName
 * @property {string | null} jobTitle
 * @property {string | null} department
 * @property {string | null} companyName
 * @property {string | null} officeLocation
 * @property {string[]} businessPhones
 * @property {string | null} mobilePhone
 * @property {boolean} accountEnabled
 */

/**
 * @typedef {object} GraphClient
 * @property {string} mode
 * @property {() => Promise<GraphUser[]>} listUsers  every user, all pages
 * @property {(userId: string) => Promise<{ id: string } | null>} getManager
 *   the user's manager, or null when they have none
 */

/** @type {GraphClient | undefined} */
let instance;

/** @returns {Promise<GraphClient>} */
export async function graph() {
  if (!instance) {
    const module =
      env.GRAPH_MODE === 'real' ? await import('./real.js') : await import('./mock.js');
    instance = module.createClient();
  }
  return instance;
}
