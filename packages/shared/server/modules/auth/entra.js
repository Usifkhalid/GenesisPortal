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
 * The tokens Entra returns are used during the callback and dropped: the ID
 * token for its claims, the access token (User.Read) to refresh the person's
 * own profile from Graph (refresh.js, D138). The browser never sees one, and
 * none is kept in the session.
 *
 * A person the portal does not know yet gets a profile from the ID token
 * (provision.js). When Microsoft refuses, the login page is told why in terms
 * of what to ask the Global Administrator for (D136).
 *
 * Tests use a stand-in for the MSAL client.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { createDelegatedGraph } from '../../integrations/graph/delegated.js';
import { bootstrapHoldingAdmin, createProfileFromToken } from './provision.js';
import { createProfileRefresher } from './refresh.js';
import { entraCallbackQuery } from './schema.js';
import { startSession } from './service.js';

// User.Read: the profile refresh at sign-in reads /me with this token (refresh.js).
const SCOPES = ['openid', 'profile', 'email', 'User.Read'];
const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const random = () => randomBytes(32).toString('base64url');

const same = (a, b) => {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Entra's answer, put as one of the login page's reasons. AADSTS codes come
 * in error_description on the redirect, and in the message of an MSAL error
 * when the code is redeemed.
 */
const AADSTS_REASONS = [
  // Consent: not granted for the tenant, declined, or admin-only.
  [/AADSTS(65001|65004|90094|90095|90099)\b/, 'consent_required'],
  // "Assignment required" is on and this person is not assigned to the app.
  [/AADSTS50105\b/, 'not_assigned'],
  // The registration: not in this tenant, wrong or expired secret, redirect URI.
  [/AADSTS(700016|7000215|7000222|50011|500113|700054|50194)\b/, 'app_setup'],
];
const ERROR_REASONS = {
  consent_required: 'consent_required',
  interaction_required: 'consent_required',
  access_denied: 'cancelled',
  invalid_client: 'app_setup',
  unauthorized_client: 'app_setup',
  invalid_request: 'app_setup',
  unsupported_response_type: 'app_setup',
};

export function reasonForEntraError(code, description) {
  const text = String(description ?? '');
  for (const [pattern, reason] of AADSTS_REASONS) if (pattern.test(text)) return reason;
  return ERROR_REASONS[code] ?? 'signin_failed';
}

const aadstsOf = (text) => /AADSTS\d+/.exec(String(text ?? ''))?.[0];

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
 * @param {object} [deps.profileGraph]  a stand-in for integrations/graph/delegated.js, for tests
 */
export function createEntraHandlers({ config, repo, msalClient, accounts, profileGraph }) {
  const refreshProfile = createProfileRefresher({
    repo,
    graph: profileGraph ?? createDelegatedGraph(),
  });
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
      const reason = reasonForEntraError(query.error, query.error_description);
      return fail(req, res, reason, {
        entraError: query.error,
        aadsts: aadstsOf(query.error_description),
      });
    }
    if (!pending || !same(query.state, pending.state)) {
      return fail(req, res, 'signin_failed', { cause: 'state mismatch' });
    }

    let claims;
    let accessToken;
    try {
      const msal = await getClient();
      const result = await msal.acquireTokenByCode({
        code: query.code,
        scopes: SCOPES,
        redirectUri,
        codeVerifier: pending.verifier,
        // msal-node 7 refuses an ID token whose nonce it was not given.
        nonce: pending.nonce,
      });
      claims = result?.idTokenClaims ?? {};
      accessToken = result?.accessToken;
      // The access token is used once below, then dropped with this request.
      msal.clearCache?.();
    } catch (err) {
      const reason = reasonForEntraError(err?.errorCode, err?.errorMessage ?? err?.message);
      return fail(req, res, reason, {
        cause: err?.errorCode ?? err?.name,
        aadsts: aadstsOf(err?.errorMessage ?? err?.message),
      });
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

    // Known to Entra, new here: a profile from the token, placed by email domain.
    if (!person) {
      const name = typeof claims.name === 'string' ? claims.name : '';
      const made = await createProfileFromToken(req, repo, { oid, email, name });
      if (made.refused) return fail(req, res, made.refused, { oid });
      person = made.person;
    }

    if (!person?.isActive || person.company?.isActive === false) {
      return fail(req, res, 'not_provisioned', { oid });
    }

    // Job title, department, phones, manager: from Graph now, not tomorrow night.
    await refreshProfile(req, person.id, accessToken);
    accessToken = undefined;

    await bootstrapHoldingAdmin(req, repo, config, person, email);

    await startSession(req, person.id);
    res.redirect('/');
  }

  return { login, callback };
}
