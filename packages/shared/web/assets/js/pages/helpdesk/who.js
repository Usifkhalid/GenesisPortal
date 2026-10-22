/**
 * pages/helpdesk/who.js — what the IT team's views need to know about the
 * reader (tickets/queue.js, tickets/detail.js): their role and the queue's
 * filters and agents.
 *
 * The options are configuration, so they are kept for a minute rather than
 * asked for on every page: a site phone pays for each request. The queue
 * fetches its own numbers when it loads (counts: null here).
 */

import { api } from '../../api.js';

const OPTIONS_TTL_MS = 60_000;
let options = null;
let optionsAt = 0;

/**
 * @param {{ helpdesk: { role: 'Lead' | 'Agent' } }} ctx
 * @returns {Promise<{ staff: true, isLead: boolean, queueOptions: object, counts: null }>}
 */
export async function loadWho(ctx) {
  if (!options || Date.now() - optionsAt > OPTIONS_TTL_MS) {
    optionsAt = Date.now();
    options = api('/api/tickets/queue/options', { quiet: true }).catch((err) => {
      options = null;
      throw err;
    });
  }
  return {
    staff: true,
    isLead: ctx.helpdesk.role === 'Lead',
    queueOptions: await options,
    counts: null,
  };
}
