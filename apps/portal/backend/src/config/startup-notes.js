/**
 * startup-notes.js — what the portal says once at boot about its link to the
 * IT Helpdesk (D146). Pure, so a test can read the lines.
 */

/**
 * @param {object} options
 * @param {{ HELPDESK_URL?: string }} options.env
 * @param {Record<string, string | undefined>} options.source  process.env
 * @param {{ info: Function, warn: Function }} options.log
 */
export function logHelpdeskLinkNotes({ env, source, log }) {
  if (source.PORTAL_HELPDESK_JOBS !== undefined) {
    log.info(
      'PORTAL_HELPDESK_JOBS is ignored: the portal has no helpdesk jobs. Remove it from .env.'
    );
  }
  if (!env.HELPDESK_URL) {
    log.warn(
      'HELPDESK_URL is not set: the "IT Support" link is hidden and old ticket links go nowhere. ' +
        'Set it to the IT Helpdesk address (for example https://helpdesk.example.com).'
    );
  }
}
