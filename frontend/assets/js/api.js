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
 *
 * A read that never reached the server is tried once more, because on site a
 * dropped packet is ordinary. A write is not: it may have arrived.
 *
 * Any other failure is said in a toast, in the language in use, and then
 * thrown, so the caller can still put its own screen right. A caller that
 * shows the failure in place passes `quiet: true`.
 */

import { showToast } from './components/toast.js';

const LOGIN_PAGE = 'login.html';
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const RETRY_AFTER_MS = 600;

let csrfToken = null;

/** A failed request. `code` is the server's stable token, to pick a string by. */
export class ApiError extends Error {
  /**
   * @param {number} status  0 when the request never reached the server
   * @param {string} code
   * @param {unknown} [details]  the server's structured extras, e.g. which field
   */
  constructor(status, code, details) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setCsrfToken(token) {
  csrfToken = token ?? null;
}

/* ---------------------------------------------------------------- messages */

/** Where a status has a sentence of its own, under "error." in the strings. */
const MESSAGE_BY_STATUS = {
  0: 'network',
  400: 'invalid',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
  413: 'tooLarge',
  422: 'invalid',
  429: 'rateLimited',
};

/**
 * The i18n key stem for a failure: `${stem}.title` and `${stem}.text`.
 * Exported for callers that show the failure in place instead of in a toast.
 *
 * @param {unknown} err
 */
export function errorKey(err) {
  const status = err instanceof ApiError ? err.status : -1;
  const name = MESSAGE_BY_STATUS[status] ?? (status >= 500 ? 'server' : 'unknown');
  return `error.${name}`;
}

function announce(err) {
  const key = errorKey(err);
  showToast({
    // No signal is the site's weather, not a fault: a warning, not an alarm.
    tone: err.status === 0 ? 'warning' : 'danger',
    titleKey: `${key}.title`,
    textKey: `${key}.text`,
  });
}

/* ---------------------------------------------------------------- requests */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(path, method, body) {
  const headers = { Accept: 'application/json' };
  // A Blob (a logo) goes as its own bytes; anything else as JSON.
  const raw = typeof Blob !== 'undefined' && body instanceof Blob;
  if (raw) headers['Content-Type'] = body.type || 'application/octet-stream';
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!SAFE_METHODS.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const attempt = () =>
    fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });

  try {
    return await attempt();
  } catch {
    // No signal, DNS, a dropped connection: common on site.
    if (method !== 'GET') throw new ApiError(0, 'network');
  }

  await wait(RETRY_AFTER_MS);
  try {
    return await attempt();
  } catch {
    throw new ApiError(0, 'network');
  }
}

async function readErrorBody(res) {
  try {
    const error = (await res.json())?.error;
    return { code: error?.code ?? 'unknown', details: error?.details };
  } catch {
    return { code: 'unknown', details: undefined };
  }
}

async function readError(res) {
  return (await readErrorBody(res)).code;
}

/** Fetches a fresh CSRF token for the current session. */
async function refreshCsrfToken() {
  const res = await send('/api/auth/config', 'GET');
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  setCsrfToken((await res.json()).csrfToken);
}

async function request(path, { method, body, redirectOn401 }) {
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

  if (!res.ok) {
    const { code, details } = await readErrorBody(res);
    throw new ApiError(res.status, code, details);
  }
  if (res.status === 204) return null;

  try {
    return await res.json();
  } catch {
    // A 200 that is not JSON: a captive portal or a proxy answered for us.
    throw new ApiError(res.status, 'unknown');
  }
}

/**
 * @param {string} path  e.g. '/api/me'
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {unknown} [options.body]  sent as JSON
 * @param {boolean} [options.redirectOn401]  false on the login page itself
 * @param {boolean} [options.quiet]  true when the caller shows the failure itself
 * @returns {Promise<any>} the parsed JSON body, or null for an empty one
 */
export async function api(
  path,
  { method = 'GET', body, redirectOn401 = true, quiet = false } = {}
) {
  try {
    return await request(path, { method, body, redirectOn401 });
  } catch (err) {
    if (!quiet && err instanceof ApiError) announce(err);
    throw err;
  }
}
