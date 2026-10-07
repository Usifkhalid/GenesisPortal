/**
 * integrations/graph — the only door to Microsoft Graph.
 *
 * No module outside this folder may call Graph or hold a Graph token. Callers
 * import `graph()` and get whichever implementation GRAPH_MODE selects, so a
 * feature written against the mock works unchanged against the real tenant.
 *
 * Real tenant access is not granted yet, so `mock` is the dev default and the
 * real client is a stub until it is.
 */

import { env } from '../../config/env.js';

/**
 * @typedef {object} GraphClient
 * @property {string} mode
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
