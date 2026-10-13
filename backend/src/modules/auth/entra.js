/**
 * entra.js — Entra ID sign-in: the OAuth 2.0 authorization-code flow with
 * PKCE, run entirely on the server with @azure/msal-node.
 *
 *   GET /auth/login     → redirect to Entra with a state, a nonce and a PKCE
 *                         challenge; their secrets stay in the session
 *   GET /auth/callback  → check state, redeem the code with the PKCE verifier,
 *                         check nonce and tenant, find the UserProfile, start
 *                         the session
 *
 * The tokens Entra returns are read once for their claims and dropped. The
 * browser never sees one, and none is kept in the session.
 *
 * NOT YET RUN AGAINST THE REAL TENANT (access has not been granted). The flow
 * is covered by tests with a stand-in for the MSAL client.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { entraCallbackQuery } from './schema.js';
import { startSession } from './service.js';

const SCOPES = ['openid', 'profile', 'email'];
const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const random = () => randomBytes(32).toString('base64url');

const same = (a, b) => {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
};

export const authorityFor = (config) =>
  `https://login.microsoftonline.com/${encodeURIComponent(config.ENTRA_TENANT_ID)}`;

/** Where Entra ends its own session, returning the browser to our login page. */
export function entraLogoutUrl(config) {
  const back = encodeURIComponent(`${config.APP_BASE_URL}/login.html`);
  return `${authorityFor(config)}/oauth2/v2.0/logout?post_logout_redirect_uri=${back}`;
}

/** The real MSAL client. Imported on first use, so mock mode never loads it. */
async function createMsalClient(config) {
  const { ConfidentialClientApplication } = await import('@azure/msal-node');
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.ENTRA_CLIENT_ID,
      authority: authorityFor(config),
      clientSecret: config.ENTRA_CLIENT_SECRET,
    },
  });
}

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {object} deps.repo  see repo.js
 * @param {object} [deps.msalClient]  a stand-in, for tests
 * @param {{ hit: (account: string) => void }} [deps.accounts]  per-account sign-in cap
 */
export function createEntraHandlers({ config, repo, msalClient, accounts }) {
  const redirectUri = `${config.APP_BASE_URL}/auth/callback`;

  let client = msalClient;
  const getClient = async () => (client ??= await createMsalClient(config));

  /** Back to the login page with a reason it can put into words. */
  const fail = (req, res, reason, detail) => {
    req.log?.warn({ reason, ...detail }, 'entra sign-in refused');
    res.redirect(`/login.html?error=${reason}`);
  };

  async function login(req, res) {
    const verifier = random();
    const state = random();
    const nonce = random();
    req.session.entra = { verifier, state, nonce };

    const url = await (
      await getClient()
    ).getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri,
      responseMode: 'query',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
      state,
      nonce,
    });
    res.redirect(url);
  }

  async function callback(req, res) {
    const query = entraCallbackQuery.parse(req.query);

    // One use only, whatever happens next.
    const pending = req.session.entra;
    delete req.session.entra;

    if (query.error || !query.code) {
      return fail(req, res, 'signin_failed', { entraError: query.error });
    }
    if (!pending || !same(query.state, pending.state)) {
      return fail(req, res, 'signin_failed', { cause: 'state mismatch' });
    }

    let claims;
    try {
      const msal = await getClient();
      const result = await msal.acquireTokenByCode({
        code: query.code,
        scopes: SCOPES,
        redirectUri,
        codeVerifier: pending.verifier,
      });
      claims = result?.idTokenClaims ?? {};
      // Nothing here calls an API as the user, so no token is worth keeping.
      msal.clearCache?.();
    } catch (err) {
      return fail(req, res, 'signin_failed', { cause: err?.errorCode ?? err?.name });
    }

    if (!same(claims.nonce, pending.nonce)) {
      return fail(req, res, 'signin_failed', { cause: 'nonce mismatch' });
    }
    // The authority already limits sign-in to one tenant; this says so twice.
    if (GUID.test(config.ENTRA_TENANT_ID) && !same(claims.tid, config.ENTRA_TENANT_ID)) {
      return fail(req, res, 'signin_failed', { cause: 'wrong tenant' });
    }

    // By the immutable object id first; by address only for a profile that
    // has not been tied to its Entra account yet, which is then tied to it.
    const oid = typeof claims.oid === 'string' ? claims.oid.toLowerCase() : null;
    const email = String(claims.preferred_username ?? claims.email ?? '').toLowerCase();

    // Entra has vouched for the account; this caps how often one account may
    // open a session here, wherever the attempts come from.
    try {
      accounts?.hit(oid ?? email);
    } catch {
      return fail(req, res, 'too_many_attempts', { oid });
    }

    let person = oid ? await repo.findByEntraObjectId(oid) : null;
    if (!person && email) {
      person = await repo.findByEmail(email);
      if (person && oid) {
        await repo.linkEntraObjectId(person.id, oid);
        req.log?.info({ userId: person.id }, 'profile linked to its Entra object id');
      }
    }

    if (!person?.isActive || person.company?.isActive === false) {
      return fail(req, res, 'not_provisioned', { oid });
    }

    await startSession(req, person.id);
    res.redirect('/');
  }

  return { login, callback };
}
