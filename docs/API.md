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

### The rest

Nothing else exists yet. Each module documents its routes here as it lands: sign-in,
company admin, announcements, directory, room booking, support tickets, notifications and
the audit log.
