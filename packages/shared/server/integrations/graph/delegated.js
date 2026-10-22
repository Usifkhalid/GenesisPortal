/**
 * delegated.js — Graph as the signed-in person, with the access token from
 * their own sign-in (User.Read). Used once per Entra sign-in to refresh that
 * person's profile (modules/auth/refresh.js).
 *
 * This is not the GRAPH_MODE client: the token is a real one from the real
 * tenant, so the call is always made, mock mode or not. The token is passed
 * in, used for these two requests and never stored or logged.
 *
 *   getMe(token)         GET /me with the profile fields the portal keeps
 *   getMyManager(token)  GET /me/manager; null when the person has none.
 *                        Throws code 'forbidden' when the token may not read it
 *                        (User.Read alone does not cover /me/manager).
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ME_FIELDS = [
  'id',
  'displayName',
  'jobTitle',
  'department',
  'companyName',
  'officeLocation',
  'businessPhones',
  'mobilePhone',
].join(',');
/** Sign-in waits for this, so a slow site connection must not hold it long. */
const TIMEOUT_MS = 5000;

/** A refusal in terms the caller acts on; never carries the token or the body. */
export class DelegatedGraphError extends Error {
  /** @param {'forbidden' | 'unauthorized' | 'failed'} code  @param {number} [status] */
  constructor(code, status) {
    super(`Graph request failed: ${status ?? code}`);
    this.name = 'DelegatedGraphError';
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetch]  a stand-in, for tests
 * @param {number} [deps.timeoutMs]
 */
export function createDelegatedGraph({ fetch: doFetch = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  async function get(path, token) {
    const response = await doFetch(`${GRAPH}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) return response.json();
    if (response.status === 404) return null;
    if (response.status === 403) throw new DelegatedGraphError('forbidden', 403);
    if (response.status === 401) throw new DelegatedGraphError('unauthorized', 401);
    throw new DelegatedGraphError('failed', response.status);
  }

  return {
    /** @returns {Promise<Partial<import('./index.js').GraphUser> | null>} */
    getMe: (token) => get(`/me?$select=${ME_FIELDS}`, token),

    /** @returns {Promise<{ id: string } | null>} */
    async getMyManager(token) {
      const manager = await get('/me/manager?$select=id', token);
      return manager?.id ? { id: String(manager.id) } : null;
    },
  };
}
