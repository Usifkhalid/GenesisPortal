/**
 * api.js — the one way the frontend talks to the backend.
 *
 * The session is an httpOnly cookie the browser sends by itself; this module
 * never sees it and holds no token of the user's. What it does hold is the
 * CSRF token, which the server hands out with GET /api/me and
 * GET /api/auth/config and expects back on every request that changes state.
 *
 * A 401 means the session is gone (signed out, timed out after eight idle
 * hours, or the person was deactivated): the browser goes to the login page.
 */

const LOGIN_PAGE = 'login.html';
const SAFE_METHODS = new Set(['GET', 'HEAD']);

let csrfToken = null;

/** A failed request. `code` is the server's stable token, to pick a string by. */
export class ApiError extends Error {
  /**
   * @param {number} status  0 when the request never reached the server
   * @param {string} code
   */
  constructor(status, code) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function setCsrfToken(token) {
  csrfToken = token ?? null;
}

async function send(path, method, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!SAFE_METHODS.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  try {
    return await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // No signal, DNS, a dropped connection: common on site.
    throw new ApiError(0, 'network');
  }
}

async function readError(res) {
  try {
    return (await res.json())?.error?.code ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Fetches a fresh CSRF token for the current session. */
async function refreshCsrfToken() {
  const res = await send('/api/auth/config', 'GET');
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  setCsrfToken((await res.json()).csrfToken);
}

/**
 * @param {string} path  e.g. '/api/me'
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {unknown} [options.body]  sent as JSON
 * @param {boolean} [options.redirectOn401]  false on the login page itself
 * @returns {Promise<any>} the parsed JSON body, or null for an empty one
 */
export async function api(path, { method = 'GET', body, redirectOn401 = true } = {}) {
  const changesState = !SAFE_METHODS.has(method);
  if (changesState && !csrfToken) await refreshCsrfToken();

  let res = await send(path, method, body);

  // The token belongs to a session that has since been replaced: get the
  // current one and try once more.
  if (changesState && res.status === 403) {
    const code = await readError(res.clone());
    if (code === 'csrf_invalid') {
      await refreshCsrfToken();
      res = await send(path, method, body);
    }
  }

  if (res.status === 401 && redirectOn401) {
    location.replace(LOGIN_PAGE);
    // The page is leaving; nothing after this call should run.
    return new Promise(() => {});
  }

  if (!res.ok) throw new ApiError(res.status, await readError(res));
  if (res.status === 204) return null;
  return res.json();
}
