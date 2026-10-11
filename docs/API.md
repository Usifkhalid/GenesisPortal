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

### Administration (`/api/admin`)

Every route needs a session and, for writes, `X-CSRF-Token`. Roles: **HA** holding
admin, **CA** company admin (of the company concerned). A company outside someone's reach
answers 404, not 403. Every write is one transaction holding the change and exactly one
`AuditLog` row; a refused or failed write writes none.

Errors a form can act on carry a stable `error.code`:

| Status | Code | Meaning |
|---|---|---|
| 400 | `validation_failed` | `details`: `[{ path, message }]` |
| 400 | `accent_not_accessible` | the colour fails `frontend/assets/js/accent.js`; `details.failed` |
| 409 | `stale_record` | `updatedAt` is not the record's current one: reload |
| 409 | `code_taken` | company code in use |
| 409 | `domain_taken` | `details.domain` belongs to another company |
| 409 | `department_name_taken` | `details.field` is `nameEn` or `nameAr` |
| 409 | `already_assigned` | the person already holds that role there |
| 409 | `cannot_remove_own_role` | removing your own HoldingAdmin role |
| 409 | `last_holding_admin` | removing the last active HoldingAdmin |
| 413 | `logo_too_large` / `payload_too_large` | over 512 KB |
| 415 | `unsupported_image` | not PNG, JPEG or WebP by file signature |

Concurrency: every edit sends the `updatedAt` (ISO string) of the record as loaded, in the
body, or in the query for the logo routes. The update only applies if it still matches.

| Method and path | Who | Notes |
|---|---|---|
| `GET /scope` | HA, CA | `{ holdingAdmin, companies[] }`: the companies this person administers |
| `GET /companies?status=active\|inactive\|all` | HA | `{ items[] }`: `id, code, nameEn, nameAr, domains[], accentColor, logoUrl, isActive, userCount, createdAt, updatedAt` |
| `GET /companies/:id` | HA | |
| `POST /companies` | HA | `{ code /^[A-Z]{2,5}$/, nameEn, nameAr, domains[1..5], accentColor "#rrggbb" }` → 201 |
| `PATCH /companies/:id` | HA | `{ updatedAt, nameEn?, nameAr?, domains?, accentColor? }`. The code is not editable (unknown fields are 400). |
| `POST /companies/:id/deactivate` · `/reactivate` | HA | `{ updatedAt }`. There is no delete. A deactivated company's people are signed out at their next request. |
| `PUT /companies/:id/logo?updatedAt=` | HA | raw body, any content type; the file's signature decides. Max 512 KB. Replaces and removes the old file. |
| `DELETE /companies/:id/logo?updatedAt=` | HA | |
| `GET /api/companies/:id/logo` | anyone who may see the company | the stored image; `Cache-Control: private, max-age=31536000, immutable` (the `?v=` in `logoUrl` changes on replace) |
| `GET /departments?companyId=&status=` | HA any; CA own | `companyId` defaults to the person's first administered company |
| `POST /departments` | HA any; CA own | `{ companyId, nameEn, nameAr }`; names unique per company, in both languages |
| `PATCH /departments/:id` | HA any; CA own | `{ updatedAt, nameEn?, nameAr? }` |
| `POST /departments/:id/deactivate` · `/reactivate` | HA any; CA own | `{ updatedAt }`. People keep a deactivated department. There is no delete. |
| `GET /admins` | HA | `{ holding[], companies[{ company, admins[] }] }` |
| `POST /admins` | HA | `{ userId, role: HoldingAdmin\|CompanyAdmin, companyId? }` → 201. `companyId` is required for CompanyAdmin and forbidden for HoldingAdmin. |
| `DELETE /admins/:id` | HA | `:id` is the assignment id |
| `GET /people?q=` | HA | active people by English name, Arabic name or email (2+ characters, 15 results) |
| `GET /audit` | HA all; CA their companies | filters `from`, `to` (Cairo dates, `YYYY-MM-DD`, inclusive), `actorId`, `action`, `entity`, `companyId` (a company id, or `holding`); `page`, `pageSize` (10–100). Newest first. `{ items[], page, pageSize, total }` |
| `GET /audit/facets` | HA, CA | the actions, entities, actors and companies there are entries for |
| `GET /audit/export.csv` | HA all; CA theirs | the same filters, no paging, up to 10 000 rows, UTF-8 with BOM, formula-safe. The export is itself written to the log (`audit.export`). |
| `GET /audit/:id` | HA all; CA theirs | one entry with parsed `before` and `after` |

There are no edit or delete routes for the audit log: `PUT`, `PATCH`, `DELETE` and
`POST` on `/audit` and `/audit/:id` answer 404, and the database trigger refuses them
anyway (D52).

Audit actions written by this module: `company.create`, `company.update`,
`company.deactivate`, `company.reactivate`, `company.logo.update`, `company.logo.remove`,
`department.create`, `department.update`, `department.deactivate`,
`department.reactivate`, `role.assign`, `role.remove`, `audit.export`. A role entry is
filed under the company it administers, so that company's admin sees it.

### Announcements (`/api/announcements`, `/api/admin/announcements`)

Readers (any signed-in person) see published, unexpired announcements for their own
company and holding-wide ones, nothing else, whatever the query says. An announcement of
another company answers 404, never 403. Status is derived, never stored: **Draft**
(no `publishAt`), **Scheduled** (`publishAt` ahead), **Published**, **Expired**
(`expiresAt` passed).

| Method and path | Who | Notes |
|---|---|---|
| `GET /api/announcements?category=&unread=true&page=&pageSize=` | everyone | `{ items[], total, page, pageSize, unreadCount }`. Pinned first, then newest. `pageSize` 1–50 (12). Items carry both languages (`titleEn/Ar`, `summaryEn/Ar` - the start of the body when no summary was written), `languages: { en, ar }` (a language is complete with a title and a body), `isRead`, `company` (null = all MG Holding), `coverUrl`, `coverAltEn/Ar`, `author`. Never the storage key. |
| `GET /api/announcements/unread-count` | everyone | `{ count }` |
| `GET /api/announcements/:id` | everyone | the item plus `bodyHtmlEn/Ar`, rendered and sanitised by the server. **Marks it read** (once). |
| `GET /api/announcements/:id/cover` | readers who may see it; admins who run it | the image, `Cache-Control: private, max-age=31536000, immutable` (`?v=` changes on replace) |
| `GET /api/admin/announcements?status=&category=&companyId=&page=&pageSize=` | HA all; CA their companies | every status. Items add `status`, `translationMissing: { en, ar }`, `readStats: { read, audience }` ("read by X of Y": active people of the audience), `updatedAt`. `companyId` is a company id or `holding`. Newest change first. |
| `POST /api/admin/announcements` | HA any company or holding-wide; CA own company | `{ companyId (guid or null), titleEn?, titleAr?, summaryEn?, summaryAr?, bodyEn?, bodyAr?, category, coverAltEn?, coverAltAr?, isPinned?, publishAt?, expiresAt? }` → 201 |
| `GET /api/admin/announcements/:id` | HA, CA | the admin item plus raw `bodyEn/Ar` |
| `PATCH /api/admin/announcements/:id` | HA, CA | `{ updatedAt, ...any of the above, companyId? }` |
| `POST /api/admin/announcements/:id/publish` | HA, CA | `{ updatedAt, publishAt? }`: now, or at a future instant |
| `POST /api/admin/announcements/:id/unpublish` | HA, CA | `{ updatedAt }`: back to a draft; nothing is deleted |
| `POST /api/admin/announcements/:id/duplicate` | HA, CA | → 201, an unpinned draft with its own copy of the cover |
| `DELETE /api/admin/announcements/:id` | HA, CA | drafts only; anything else is 409 `not_a_draft` |
| `PUT /api/admin/announcements/:id/cover?updatedAt=` | HA, CA | raw PNG, JPEG or WebP (by signature), max 2 MB. SVG is refused. |
| `DELETE /api/admin/announcements/:id/cover?updatedAt=` | HA, CA | removes the image and its alt text |

A company admin gets 403 on a holding-wide announcement (they can read it, not run it) and
404 on another company's. Markdown is limited to headings, bold, italic, lists and links;
markup is stripped on save and escaped on render, and a link outside http(s), mailto, a
site path or an in-page hash is reduced to its text; external links open with
`rel="noopener noreferrer"`.

Error codes: `stale_record` (409), `title_required`, `language_incomplete`
(publishing needs one language with title and body), `cover_alt_required` (`details.languages`:
alt text in each language that has a title), `expiry_before_publish`, `expiry_in_past`,
`unknown_company`, `nothing_to_change` (400), `not_a_draft` (409), `cover_too_large` (413),
`unsupported_image` (415), `empty_upload` (400).

Audit actions: `announcement.create`, `.update`, `.publish`, `.unpublish`,
`.duplicate`, `.delete`, `.cover.update`, `.cover.remove`. Filed under the
announcement's company; holding-wide ones under no company. Reads are not audited.

### Directory (`/api/directory`, `/api/admin/directory`)

The directory is **group-wide**: any signed-in person finds and opens the active people of
every company (the one exception to company scoping, DECISIONS D82). It returns work
information only. Reports, Arabic names and sync stay admin-only and company-scoped.

| Route | Who | Notes |
|---|---|---|
| `GET /api/directory/people?q=&companyId=&departmentId=&lang=&page=&pageSize=` | any | active people; `q` is matched word by word (every word) against English and Arabic name, email and job title, ignoring case, Arabic diacritics and the letter variants أ إ آ ا, ى ي, ة ه. Sorted by name in `lang` (the English name where there is no Arabic one). `pageSize` max 50. → `{ items, total, page, pageSize }`. `companyId` only narrows the list; any company may be asked for. |
| `GET /api/directory/people/:id` | any | the person: names in both languages, job title, department, company, `officeLocation`, `phone` (business), `email`, `manager`, `directReports`. `mobilePhone` is `null` unless the person's own company has `showMobileInDirectory` on, whoever reads. `canEditArabicName` is true for an admin of the person's company. An inactive person is 404. |
| `GET /api/directory/filters` | any | every active company and its active departments |
| `PATCH /api/admin/directory/people/:id` | HA, CA | `{ displayNameAr }` (max 200; empty clears it) → the person. Only an admin of the person's company: otherwise 403. Audited as `directory.person.arabic_name`. |
| `POST /api/admin/directory/arabic-names/preview` | HA, CA | body: the CSV file itself (UTF-8, comma or semicolon, first row `email, arabicName`; 1 MB, 2,000 rows). Writes nothing. → `{ rows, matched, unchanged, changes: [{ id, email, displayNameEn, companyCode, from, to }], unknown: [email], outOfScope: [email], invalid: [{ line, email, reason }] }`; `reason` is `email`, `empty`, `tooLong` or `duplicate`. Errors: 400 `empty_upload`, `csv_invalid`, `csv_too_many_rows`; 413 over 1 MB. |
| `POST /api/admin/directory/arabic-names/apply` | HA, CA | the same file again → the same body plus `applied`. One transaction; one audit row per company touched, `directory.arabic_names.import`, with the counts and the old and new names. An empty name in the file never clears one. |
| `GET /api/admin/directory/quality?companyId=` | HA, CA | per company: `activeUsers`, `counts` and `lists` (capped at 200) for `missingCompany`, `missingDepartment`, `missingJobTitle`, `missingManager`, `missingBusinessPhone`, `missingArabicName`; `unmatchedDepartments` (Graph names no department matched, with people counts). `unplaced` (people no company could be found for, from the last successful run) is HoldingAdmin only. A CompanyAdmin gets their own companies; another company is 404. |
| `GET /api/admin/directory/quality/export.csv?companyId=` | HA, CA | the same gaps, one row per person and issue; audited as `directory.quality.export` |
| `GET /api/admin/directory/sync` | HA | the last 20 runs; the newest carries its `warnings`, the others only `warningCount` |
| `POST /api/admin/directory/sync` | HA | `{ allowLargeDeactivation?: boolean }` → 202 with the run (`status: running`); it continues in the background. One at a time: a second request is 409 `sync_in_progress`. |

The mobile setting is `showMobileInDirectory` on `PATCH /api/admin/companies/:id` (audited
as part of `company.update`).

**Sync.** Nightly at 02:00 Cairo time and on demand. Company: Graph `companyName` against a
company's English name, Arabic name or code, else the mail domain against its domains.
Department: by name within the company, either language; a name with no match is recorded
as a warning (`unmatched_department`) and never created. Someone no company can be found
for is not imported (`unplaced_user`). Manager links come from Graph. People missing from
Graph or disabled become inactive, never deleted. The Arabic display name belongs to the
portal: a new person has none, and sync never writes it. Two safety stops record a
`failed` run and change nothing: Graph returning no people (`graph_empty`) and a run that
would deactivate more than 20% of the active people (`deactivation_limit`; rerun with
`allowLargeDeactivation`). Each run writes one audit entry, `directory.sync` or
`directory.sync.failed`, with its counts, filed under no company.

### Rooms and bookings (`/api/rooms`, `/api/bookings`, `/api/admin/rooms`, `/api/admin/bookings`)

Exchange is the source of truth: a room is a resource mailbox, a booking is an event in the
organiser's calendar with the room as a resource attendee, and whether a room is free is
always asked of Exchange. The portal keeps the room's details and one reference row per
meeting. The screens are `#rooms` (find a room), `#rooms/day`, `#rooms/mine` and
`#rooms/<id>` (a room's panel).

Instants are ISO 8601 with `Z` or an offset and are stored in UTC. A calendar day
(`2026-10-25`) or a clock time (`10:30`) in a query is Cairo's.

| Route | Who | Notes |
|---|---|---|
| `GET /api/rooms?capacity=&equipment=&floor=` | any | active rooms the reader may use, with the reader's company's working hours: `{ items: [{ id, nameEn, nameAr, floor, capacity, equipment, photoUrl, notes, restricted }], hours: { workdayStartMin, workdayEndMin, workingDays } }`. `capacity` is a minimum; `equipment` is a comma list, all required, from `screen`, `videoConference`, `whiteboard`, `phone`, `other`. A restricted room is listed only for its companies' own people and a HoldingAdmin. |
| `GET /api/rooms/:id` | any | one room; a room the reader may not use is 404 |
| `GET /api/rooms/:id/photo` | any | the photo's bytes (the address is `photoUrl`, versioned) |
| `GET /api/rooms/availability?date=&view=day\|week&roomId=&capacity=&equipment=&floor=` | any | `{ from, to, days, hours, rooms: [{ room, busy: [{ start, end, organiser, subject, bookingId, mine }] }] }`. `week` is the Sunday-to-Saturday week holding `date`. `hours` is the reader's company's working hours. `subject` and `bookingId` are `null` unless the reader is the organiser, an invited attendee or an admin of the organiser's company; `organiser` is `null` for a meeting made in Outlook. |
| `GET /api/rooms/find?date=&start=HH:MM&duration=&people=&equipment=` | any | free rooms for that slot, smallest that fits first: `{ start, end, rooms }`. The slot obeys the booking rules below. |
| `POST /api/bookings` | any | `{ roomId, subject, start, end, attendeeCount?, attendeeIds?, recurrence? }` → 201 `{ items: [booking] }`, one per occurrence. `recurrence` is `{ type: 'daily', until }` (working days only) or `{ type: 'weekly', weekdays: [0-6], until }` (0 is Sunday). Every occurrence is checked first: on any conflict nothing is created and the answer is 409 `room_conflict` with `details.conflicts: [{ date, start, end }]`. |
| `GET /api/bookings/mine` | any | my confirmed bookings that have not ended, soonest first, checked against Exchange (one deleted or moved in Outlook is cancelled or moved here) |
| `GET /api/bookings/:id` | organiser, attendee, admin | anyone else: 404 |
| `PATCH /api/bookings/:id` | organiser, admin | `{ subject?, start?, end? }` (`start` and `end` together) for this occurrence; the rules and conflicts are checked again. An attendee is 403, anyone else 404. |
| `POST /api/bookings/:id/cancel` | organiser, admin | `{ scope: 'one' \| 'series' }` → `{ cancelled: [id] }`. `series` cancels this occurrence and every later one. |
| `GET /api/admin/bookings?roomId=&companyId=&from=&to=&status=&page=&pageSize=` | HA, CA | every booking of the admin's companies, subjects included. `status`: `confirmed` (default), `cancelled`, `all`. Another company's `companyId` is 404. |
| `GET /api/admin/rooms` | HA | all rooms, inactive too, with `mailboxEmail`, `companyIds`, `isActive`, `updatedAt` |
| `GET /api/admin/rooms/mailboxes` | HA | Exchange's room mailboxes and, for each, the portal room that uses it (`roomId`) |
| `POST /api/admin/rooms` | HA | `{ mailboxEmail, nameEn, nameAr, floor?, capacity, equipment?, notes?, companyIds? }`. `companyIds` empty: shared by every company. 409 `mailbox_taken`. |
| `PATCH /api/admin/rooms/:id` | HA | `{ updatedAt, …any of the above, isActive? }`; 409 `stale_record` |
| `PUT /api/admin/rooms/:id/photo?updatedAt=` | HA | body: the image itself (PNG, JPEG or WebP, 2 MB), checked by its signature like an announcement cover |
| `DELETE /api/admin/rooms/:id/photo?updatedAt=` | HA | |

A booking: `{ id, room, organiser, start, end, status, cancelledAt, recurring, seriesId,
subject, recurrence, attendeeCount, attendeeIds, companyId, mine, canManage }`. The fields
from `seriesId` to `companyId` are empty for a reader who may not see the subject.
`seriesId` is the same on every occurrence of one series, so a screen can fold them.

**Booking rules.** Computed on Cairo's clock through the IANA zone (Egypt observes
daylight saving time; a weekly 10:00 stays 10:00 across the change). Each refusal is 400
with a message a person can act on:

| Code | Rule |
|---|---|
| `booking_granularity` | start and end on a quarter hour |
| `booking_too_short`, `booking_too_long` | 15 minutes to 8 hours |
| `booking_in_past` | no start in the past |
| `booking_too_far` | at most 90 days ahead (the first occurrence of a series) |
| `not_a_working_day`, `outside_working_hours` | inside the organiser's company's working hours; `details` carries them. Default 08:00 to 18:00, Sunday to Thursday. |
| `recurrence_too_long`, `recurrence_ends_before_start`, `recurrence_day_mismatch` | a series ends within six months, not before it starts, and includes the weekday of its first meeting |
| `over_capacity`, `unknown_attendee` | more people than seats; an invited person who is not an active portal user |

Other codes: 409 `booking_cancelled`, `booking_finished` (already over),
`booking_gone` (Exchange no longer has the event; the row is marked cancelled); 400
`not_recurring`; 503 `calendar_unavailable`.

Working hours are three more fields on `PATCH /api/admin/companies/:id`:
`workdayStartMin` and `workdayEndMin` (minutes after midnight, on a quarter hour) and
`workingDays` (`[0-6]`); 400 `working_hours_invalid` when the day would end before it
starts.

Audit: `room.create`, `room.update`, `room.photo.update`, `room.photo.remove` (filed
under no company), and `booking.admin.update` and `booking.admin.cancel` when an
administrator changes someone else's booking (filed under the organiser's company). An
organiser's own bookings are not audited. The organiser is not yet told when an admin
cancels: that comes with notifications.

### The rest

Nothing else exists yet. Each module documents its routes here as it lands:
support tickets and notifications.
