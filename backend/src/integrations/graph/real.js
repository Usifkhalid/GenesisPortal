/**
 * Graph, live. Talks to the "mgholding" tenant with the client-credentials
 * flow through @azure/msal-node, using ENTRA_*.
 *
 * Tenant access has not been granted yet: this is written to the documented
 * Graph contract and is proven against the real tenant only in session 19.
 * Paging follows @odata.nextLink; a 429 or 503 waits for Retry-After and tries
 * again, a bounded number of times.
 */

import { ConfidentialClientApplication } from '@azure/msal-node';

import { env } from '../../config/env.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SELECT = [
  'id',
  'displayName',
  'mail',
  'userPrincipalName',
  'jobTitle',
  'department',
  'companyName',
  'officeLocation',
  'businessPhones',
  'mobilePhone',
  'accountEnabled',
].join(',');
const MAX_ATTEMPTS = 5;
const DEFAULT_WAIT_MS = 2000;
const MAX_WAIT_MS = 120_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds, or an HTTP date, from a Retry-After header. */
export function retryAfterMs(header, fallback = DEFAULT_WAIT_MS) {
  if (!header) return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), MAX_WAIT_MS);
  const at = Date.parse(header);
  return Number.isNaN(at) ? fallback : Math.min(Math.max(at - Date.now(), 0), MAX_WAIT_MS);
}

/**
 * @param {object} [deps]  replacements for tests
 * @param {typeof fetch} [deps.fetch]
 * @param {() => Promise<string>} [deps.getToken]
 * @param {(ms: number) => Promise<void>} [deps.wait]
 * @returns {import('./index.js').GraphClient}
 */
export function createClient(deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const wait = deps.wait ?? sleep;

  let msal;
  const getToken =
    deps.getToken ??
    (async () => {
      msal ??= new ConfidentialClientApplication({
        auth: {
          clientId: env.ENTRA_CLIENT_ID,
          clientSecret: env.ENTRA_CLIENT_SECRET,
          authority: `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}`,
        },
      });
      const result = await msal.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default'],
      });
      return result.accessToken;
    });

  /** GET with 429/503 handling. Returns the parsed body, or null for a 404. */
  async function get(url) {
    for (let attempt = 1; ; attempt += 1) {
      const response = await doFetch(url, {
        headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' },
      });
      if (response.ok) return response.json();
      if (response.status === 404) return null;
      const retryable = response.status === 429 || response.status === 503;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new Error(`Graph request failed: ${response.status}`);
      }
      await wait(retryAfterMs(response.headers.get('Retry-After')));
    }
  }

  return {
    mode: 'real',

    async listUsers() {
      const users = [];
      let url = `${GRAPH}/users?$select=${SELECT}&$top=100`;
      while (url) {
        const page = await get(url);
        if (!page) throw new Error('Graph returned no user page');
        users.push(...page.value);
        url = page['@odata.nextLink'] ?? null;
      }
      return users;
    },

    async getManager(userId) {
      const manager = await get(
        `${GRAPH}/users/${encodeURIComponent(userId)}/manager?$select=id,displayName,mail`
      );
      return manager?.id ? manager : null;
    },
  };
}
