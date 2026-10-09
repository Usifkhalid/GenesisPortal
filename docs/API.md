# API

Base path `/api`. JSON in, JSON out. Everything that is not under `/api` is the static
frontend.

## Conventions

**Authentication.** A server-side session, identified by an httpOnly, Secure, SameSite
cookie. The browser never holds a token. Unauthenticated requests to anything other than
the health check and the sign-in routes get `401 unauthenticated`.

**Company scope.** The caller's company comes from the session, never from the request. A
`companyId` in a path or body is accepted only after it has been checked against the
caller's scope; a HoldingAdmin may name any company, a CompanyAdmin only their own. A
request for another company's record answers `404 not_found`, not `403`, so that the
existence of other companies' records is not disclosed.

**Errors.** Every failure is

```json
{ "error": { "code": "not_found", "message": "No such endpoint.", "requestId": "…" } }
```

`requestId` matches the `X-Request-Id` response header and the server's log line. A
`validation_failed` error adds `details`: `[{ "path": "name", "message": "…" }]`, never the
rejected value. A 500 never carries the cause; outside production it adds `debug`.

`code` is a stable token to branch on; `message` is for logs and developers, never shown
to users — the frontend renders its own string from `assets/i18n` keyed on `code`.

**Rate limits.** Per IP: 300 requests a minute across `/api` (the health check is
exempt) and 20 per 15 minutes on `/api/auth`. Both are configurable; see `.env.example`.

Statuses in use: `400 validation_failed`, `400 bad_request`, `413 payload_too_large`,
`401 unauthenticated`, `403 forbidden`,
`404 not_found`, `409 conflict`, `429 rate_limited`, `500 internal_error`.

**Validation.** Every body, query and path parameter is parsed with a zod schema from the
module's `schema.js`. Unknown fields are rejected rather than ignored.

**Writes.** Mutations require a CSRF token, since the session is cookie-borne. Every
administrative action is written to `AuditLog`.

**Dates.** ISO 8601 with an explicit offset, always UTC (`2026-10-07T06:00:00Z`) on the
wire. The frontend renders them in Africa/Cairo.

**Lists.** Cursor paginated: `?limit=&cursor=`, answering
`{ "items": [...], "nextCursor": "…" | null }`.

## Endpoints

### `GET /api/health`

Liveness. No authentication, no database access, so it answers before migrations have run
and is safe as an Azure App Service health probe.

```
200 OK
{ "status": "ok" }
```

### Sign-in and session

`/api` is closed by default: everything below the sign-in routes needs a session, so an
unauthenticated request to a path that does not exist is `401`, not `404`.

The session cookie is `mgp.sid` (`__Host-mgp.sid` in production): httpOnly, SameSite=Lax,
Secure in production, eight hours idle, renewed by every request. The session row lives in
the `Session` table. `req.user` is rebuilt from `UserProfile` and `RoleAssignment` on every
request, so a revoked role or a deactivated person takes effect at once.

**CSRF.** Every `POST`, `PUT`, `PATCH` and `DELETE` under `/api` and `/auth` must send the
session's token in `X-CSRF-Token`, or gets `403 csrf_invalid`. The token comes from
`GET /api/auth/config` (before sign-in) and `GET /api/me` (after); signing in replaces it.

#### `GET /api/auth/config` (public)

```json
{ "mode": "mock", "signedIn": false, "csrfToken": "…" }
```

#### `GET /api/auth/mock-users` (public; `AUTH_MODE=mock` and `NODE_ENV=development` only)

The seeded users grouped by company, each under their highest role. Anywhere else: `404`.

```json
{ "companies": [{ "id": "…", "code": "GEN", "nameEn": "…", "nameAr": "…",
    "accentColor": "#1c7a4a", "logoUrl": "…",
    "users": [{ "id": "…", "displayNameEn": "…", "displayNameAr": "…",
                "jobTitle": "…", "role": "CompanyAdmin" }] }] }
```

#### `POST /api/auth/mock-login` (public; same condition)

Body `{ "userId": "<uuid>" }`. Starts a session under a new session id.
`200 { "redirectTo": "/", "csrfToken": "…" }`; `404` for an unknown or inactive user.

#### `POST /api/auth/logout` (and `POST /auth/logout` in Entra mode)

Ends the session. `200 { "redirectTo": "/login.html" }`; in Entra mode `redirectTo` is
Entra's own sign-out URL, which returns the browser to `/login.html`.

#### `GET /auth/login`, `GET /auth/callback` (`AUTH_MODE=entra` only)

Authorization-code flow with PKCE, state and nonce, run on the server. `/auth/login`
redirects to Entra; `/auth/callback` redeems the code, finds the `UserProfile` by
`entraObjectId` and then by email (tying the profile to the object id when found that way),
starts the session and redirects to `/`. On failure it redirects to
`/login.html?error=signin_failed` or `?error=not_provisioned`. The redirect URI is
`<APP_BASE_URL>/auth/callback`. No token reaches the browser or is kept.

#### `GET /api/me`

```json
{ "user": { "id": "…", "email": "…", "displayNameEn": "…", "displayNameAr": "…",
            "jobTitle": "…", "language": "ar", "department": { "nameEn": "…", "nameAr": "…" } },
  "company": { "id": "…", "code": "GEN", "nameEn": "…", "nameAr": "…",
               "accentColor": "#1c7a4a", "logoUrl": "…" },
  "companies": [ "…the companies this person may work in, their own first…" ],
  "roles": [{ "role": "CompanyAdmin", "scopeCompanyId": "…" }],
  "nav": [{ "key": "home", "group": "main" }, { "key": "admin", "group": "admin" }],
  "authMode": "mock", "csrfToken": "…" }
```

**For module authors.** `requireAuth` is already applied. Use
`requireRole(ROLES.HOLDING_ADMIN, ROLES.COMPANY_ADMIN)` from `middleware/auth.js` as the
coarse gate, then `assertCompanyAdmin(req, companyId)` from `lib/scope.js` for the company.

### The rest

Nothing else exists yet. Each module documents its routes here as it lands:
company admin, announcements, directory, room booking, support tickets, notifications and
the audit log.
