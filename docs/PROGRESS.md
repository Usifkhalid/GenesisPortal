# Progress

Sessions in the order they ran. Newest last.

## Session 4 — App shell (2026-10-07)

Done: frontend/index.html app shell (rail w/ collapse, bottom nav "4 + More" sheet,
top bar w/ search/notifications/account menu, reusable page header), demo data only.
Ran `/impeccable critique` (detector + isolated sub-agent review, no browser tool) and
fixed every finding — see D18-D22. New shared components: `.menu` popover, `.btn__count`.
`npm test` 3/3, `npm run lint` clean; i18n en/ar key parity scripted-checked.

Files: frontend/index.html, assets/js/app.js, assets/css/{layout,components,tokens}.css,
assets/i18n/{en,ar}.json, docs/DECISIONS.md.

Open issues: no router — nav links are `#` anchors; shell unverified in a real browser.

Next: Company/User Prisma models, lib/scope.js, sign-in with AUTH_MODE=mock; wire shell
to real auth/session state.

## Session 2 — Product brief (2026-10-07)

Done: PRODUCT.md written and then extended (commits `f52b1eb`, `afa1ec3`) — platform,
stack, the three user groups (HQ desktop, site Android, admins), product purpose,
positioning, operating context, capabilities and constraints, brand commitments, evidence
on hand, product principles and accessibility.

Files: PRODUCT.md.

Open issues: PRODUCT.md carries "Product Principles" and "Accessibility & Inclusion"
twice, at lines 59–72 and 73–86. The second commit appended fuller rewrites instead of
replacing the originals, so the two copies disagree in wording (numbered vs bulleted
principles; "360 px width and keyboard-only use" appears only in the later copy). Left as
found — PRODUCT.md is outside this session's scope. Whoever edits it next should keep the
later copy and delete the earlier one.

## Session 3 — Design system (2026-10-07)

Done: visual world chosen and built ("The Assay Card" — every record is a labelled
specimen). Self-hosted IBM Plex Sans + IBM Plex Sans Arabic (OFL, 2 weights, Latin and
Arabic subsets only, 46 kB EN / 89 kB AR worst case). tokens.css with a warm stone
neutral scale and a runtime `--brand-accent` from which every brand value is derived,
AA-guaranteed for any hue. base/layout/components CSS covering all components in the
brief, plus the signature label strip. frontend/styleguide.html with EN/AR, light/dark
and a 5-way accent switcher, all strings from assets/i18n. DESIGN.md + .impeccable/design.json.

Files: frontend/{styleguide.html, assets/css/{tokens,base,layout,components,pages/styleguide}.css,
assets/fonts/*, assets/i18n/{en,ar}.json, assets/js/{i18n.js,components/icons.js,pages/styleguide.js}},
DESIGN.md, .impeccable/design.json, docs/DECISIONS.md.

Verified: headless-Chrome audit over 16 views (desktop/phone × EN/AR × light/dark + 4
accents) — 0 contrast failures, 0 overflow, 0 unnamed controls, 0 console errors; accent
math swept over all 360 hues × 6 chroma levels. Impeccable detector: 4 findings left, all
confirmed false positives (padding sits on the parent; "em-dashes" are `--token` names).

Open issues: `npm test` / `npm run lint` do not exist yet — no package.json until the
backend is scaffolded. Ran `node --check` on all JS and JSON.parse on all JSON instead.
The `color-mix` fallback declarations were each confirmed to parse and resolve, but have
not been seen rendering in an engine that actually lacks `oklch(from ...)`.

Next: scaffold the backend (Express 5 + Prisma + package.json with test/lint scripts),
then the app shell and sign-in against this system.

## Session 1 — Project scaffold (2026-10-07)

Done: root package.json (dev/test/lint/format/db:*); Express 5 app serving /frontend
statically under helmet with `GET /api/health`; zod-validated env; HttpError and JSON
404/error handlers; lazy Prisma client; mock/real Graph boundary; Prisma initialised for
sqlserver with no models; ESLint flat config + Prettier passing over backend and frontend;
.env.example, .gitignore, README.md, docs/API.md; index.html and assets/js/app.js as
placeholders — nothing else in frontend/ touched.

Files: package.json, eslint.config.js, .prettierrc.json, .prettierignore, .env.example,
.gitignore, README.md, docs/{PROGRESS,API}.md, backend/**, frontend/{index.html,
assets/js/app.js}.

Verified: `npm test` 3/3, `npm run lint` clean, `prisma validate` passes, server booted
and /, /styleguide.html, app.js and a woff2 all 200 with CSP intact. Session 3's open
issue about missing test/lint scripts is closed.

Open issues: `prisma` 6.19.3 carries a high-severity advisory (deepmerge-ts <8 via
@prisma/config) with no stable fix — dev-only CLI, left pinned. npm skipped Prisma's
install scripts: run `npm approve-scripts prisma @prisma/client @prisma/engines` before
db:migrate. Playwright not installed. icons.js is in .prettierignore.

Next: Company and User models plus lib/scope.js, then sign-in with AUTH_MODE=mock.

## Session 4b — Shell and Home redesign (2026-10-07)

Done: tokens (radii xs-xl, density set, pine ink, fixed lime, 90rem page max); shell
(company switcher with menu, "Administration" rail group, centred top-bar search with "/",
bottom nav Home/Tickets/Rooms/Directory/More); Home as a bento (welcome banner with photo
slot, Cairo date/time, tickets, bookings, waiting-on-you, news, directory) from static demo
data, lazy-loaded with skeleton and retry; new components `.tag`, `.arrow-btn`,
`.record-list`, `.empty--inline`, `.photo-slot`; styleguide updated. Ran `/impeccable
critique` (20/40; 1 P0, 3 P1, all fixed in polish), `polish`, `document` (DESIGN.md and
design.json rewritten). Decisions D23-D30.

Verified: headless Chrome over 22 views (Home + styleguide, EN/AR, light/dark, 360, 900,
1440, 1920, collapsed rail, switcher open): 0 overflow, 0 contrast failures, 0 missing
keys, 0 unnamed controls, 0 console errors. `npm test` 3/3, `npm run lint` clean.

Files: frontend/{index.html, styleguide.html}, assets/css/{tokens,base,layout,components}.css,
assets/css/pages/{home,styleguide}.css, assets/js/{app,demo-data}.js, assets/js/pages/home.js,
assets/js/components/icons.js, assets/i18n/{en,ar}.json, DESIGN.md, .impeccable/*, docs/*.

Open issues: no router (links are hashes); real company accents and HQ/site photos not
supplied; no help entry point; lime not yet reviewed by eye under a red or amber accent;
detector still lists 4 advisory "colour outside DESIGN.md" hits for dark-theme values;
favicon 404; breadcrumb links are under 44px on phones (styleguide only so far).

Next: Company/User Prisma models, lib/scope.js, sign-in with AUTH_MODE=mock; then replace
demo-data.js card by card.

## Session 5 — Remove the banner photo (2026-10-07)

Done: removed the HQ/site photo slot from the Home banner, and with it the `.photo-slot`
component, its styleguide specimen, the `home.photoPlaceholder` and
`styleguide.variant.photoSlot` keys (en + ar) and the demo `photoUrl` field. D31
supersedes D27. The "HQ/site photos not supplied" open issue from 4b is closed.

Files: frontend/styleguide.html, assets/js/{demo-data.js,pages/home.js},
assets/css/{components.css,pages/home.css,pages/styleguide.css}, assets/i18n/{en,ar}.json,
DESIGN.md, docs/{PROGRESS,DECISIONS}.md.

Open issues: not seen in a browser this session; the `image` icon in icons.js is now unused.

Next: unchanged from 4b.

## Session 6 — Company logos (2026-10-07)

Done: Genesis and Masar logos taken from their sites, self-hosted as small tiles, and shown
beside the company name in the switcher (rail, collapsed rail, phone top bar), the company
menu, the account menu, Home's banner strip and a company announcement's "from". New
`components/company-mark.js`; `.company-mark--logo`, `--sm` and `.company-name` in
layout.css; styleguide switcher shows the logo; unused `app.companyShort` key removed. D32.

Verified: headless Chrome screenshots of GEN, MSR (desktop, phone, collapsed rail in
Arabic) and HLD fallback. `npm test` 3/3, `npm run lint` clean.

Files: frontend/assets/img/companies/{gen.svg,msr.png}, assets/js/{app,demo-data}.js,
assets/js/components/company-mark.js, assets/js/pages/home.js, assets/css/layout.css,
assets/i18n/{en,ar}.json, styleguide.html, DESIGN.md, docs/*.

Open issues: no MG Holding logo supplied (HLD shows its short name; group announcements
show no mark); company menu and dark theme not screenshotted; logo use not cleared with
the brand owners.

Next: unchanged from 4b.

## Session 7 — Backend foundation (2026-10-07; the prompt called it "Session 5")

Done: config loader hardened (production refuses placeholders and mock sign-in), pino +
pino-http with request IDs, safe central error handler (zod, Prisma, body-parser mapped),
compression, /api and /api/auth rate limiters, page and API 404s. Prisma models Company,
Department, UserProfile, RoleAssignment, AuditLog, Notification with a first migration.
lib/scope.js, lib/audit.js, lib/roles.js; AuditLog append-only guard in lib/prisma.js.
Seed: HLD/GEN/MSR, 9 departments, 12 fake users. D33-D38. `.env` already existed; a random
SESSION_SECRET was written into it, the DB password is still the placeholder.

Files: backend/src/{app,server}.js, config/env.js, lib/{logger,scope,audit,roles,prisma}.js,
middleware/{errors,rate-limit,request-log}.js, backend/prisma/{schema.prisma,seed.js,
seed-data.js,migrations/*}, backend/tests/*, .env.example, package.json, docs/*.

Verified: `npm test` 51 pass, 1 skipped; `npm run lint` clean; server boots, health 200.

Open issues: NOTHING HAS RUN AGAINST SQL SERVER. No instance on this machine (no service,
port 1433 closed, no Docker), so the migration SQL is Prisma's generated output, unapplied,
and the real-database seed test skips. HLD's domain `mgholding.example` is a placeholder.
Rate-limit counters are in memory (single instance only). No CSRF yet (comes with sessions).

Next: install/start SQL Server, set the password in .env, `npm run db:migrate`,
`npm run db:seed`, `npm test` (the skipped test must pass). Then sign-in with AUTH_MODE=mock.

## Session 8 — Sign-in, roles and company scoping (2026-10-09; the prompt called it "Session 6")

Done: express-session over a Prisma `Session` table (migration `20261009000000_sessions`), 8h
idle, CSRF on every state-changing route, `/api` closed by default, `requireAuth`,
`requireRole`, `req.user.scopes`, mock sign-in (development only), Entra code flow with PKCE,
`GET /api/me`, login.html in both modes, shell wired to the real user, branding, nav and
sign-out. `/impeccable polish` run on login.html. D39-D46. New env var `APP_BASE_URL`.
Files: backend/src/{app,server}.js, config/env.js, lib/{session,scope}.js, middleware/{auth,
csrf,rate-limit}.js, modules/auth/*, prisma/*, tests/*; frontend/login.html, index.html,
assets/js/{api,auth,app,i18n}.js, js/pages/{login,home}.js, js/components/*, css/pages/login.css,
css/{layout,components}.css, i18n/*; docs/*, .env.example.
Verified: `npm test` 88 pass, 1 skipped; lint clean; headless Chrome (EN/AR, phone/desktop,
light/dark) through sign-in as three roles, sign-out and every login state, 0 findings.
Open issues: STILL NOTHING HAS RUN AGAINST SQL SERVER: the Session migration, the Prisma
session store and modules/auth/repo.js are unproven (D42; dev and tests run in memory). Entra
unproven against the real tenant. Auth rate limit too low for an office NAT (D45). Idle
timeout only, no absolute lifetime. Favicon 404. Home cards still use demo data.
Next: install SQL Server, set the .env password, `npm approve-scripts prisma @prisma/client
@prisma/engines`, `npm run db:migrate`, `npm run db:seed`, `npm test`, sign in once. Then company admin.

## Session 9 — Frontend core (2026-10-11; the prompt called it "Session 7")

Done: hash router (lazy pages; 404, no-access and "not open yet" pages); api.js with bilingual
error toasts, one GET retry, CSRF header, 401 redirect; shared notice/toast/skeleton/esc;
Home banner on session data, five cards loading independently (skeleton, empty, failed +
retry) from loaders marked DEMO; shell notice gap matched to the login fix. `/impeccable
critique` on Home 26/40 (0 P0, 2 P1): fixed card order, phone records, page skeleton, Arabic
comma and nav label, focus after retry. D47-D51.
Files: frontend/assets/js/{router,api,auth,app,html,demo-data}.js, js/pages/{home,status,
login,styleguide}.js, js/components/{notice,toast,skeleton}.js, css/*, i18n/*, index.html,
DESIGN.md, docs/*, .impeccable/critique/*.
Verified: headless Chrome 39/39 (EN/AR, 1440/360, routes, API, card states, login notice);
`npm test` 88 pass, 1 skipped; lint clean.
Open issues: Home cards, nav ticket count and bell are demo data; no automated frontend
tests (Playwright not installed); top-bar search does nothing yet; no help entry point; SQL
Server and Entra still unproven.
Next: install SQL Server and migrate (see session 8), then company admin as the first real page.

## Session 10 — SQL Server for real, audit trigger, Playwright (2026-10-11)

Done: SESSION_SECRET rotated; Prisma install scripts approved (`npm approve-scripts`, D56);
all migrations applied to local SQL Server, seeded, the skipped seed test passes. Signed in
as a GEN user and the holding admin, restarted the server, both sessions survived. New
migrations: AuditLog append-only trigger (D52) and Session.sid to NVARCHAR (D54).
Session store no longer uses upsert (D53). Playwright (Chromium) with `npm run test:e2e`:
login, Home, sign-out in EN/AR at 1440/360 (D55); rule added to CLAUDE.md.
Files: package.json, playwright.config.js, eslint.config.js, tests/e2e/{helpers,smoke.spec}.js,
backend/prisma/{schema.prisma,migrations/*}, backend/src/lib/session.js,
backend/tests/{audit-trigger,session-store,auth}.test.js, CLAUDE.md, docs/*.
Verified: `npm test` 98 pass, 0 skipped; `npm run test:e2e` 12 pass; lint clean.
Open issues: one junk AuditLog row (action `tampered`, entity `Test`) from a test run made
before the trigger existed; it can no longer be deleted without disabling the trigger.
char(36)/varchar keys are scanned on every Prisma lookup (D54). e2e leaves a few
unauthenticated Session rows that expire in 8 h. `npm audit` still reports the Prisma CLI
advisory. Entra unproven; Home cards are demo data; favicon 404.
Next: company admin as the first real page (with its own e2e spec).

## Session 11 — Fix session: NVARCHAR keys, session pruning (2026-10-11)

Done: all string key and lookup columns are NVARCHAR (migration `20261011020000_string_keys_nvarchar`,
data kept, no schema drift, seed re-run); showplan confirms index seeks for lookups by id, email
and company code (D57). Expired sessions pruned at startup and hourly via `jobs/prune-sessions.js`,
with a test (D58). Least-privilege production login and `approve-scripts` after a Prisma upgrade
noted (D59).
Files: backend/prisma/{schema.prisma,migrations/20261011020000_*}, backend/src/{server.js,
jobs/prune-sessions.js,jobs/README.md}, backend/tests/prune-sessions.test.js, docs/*.
Verified: `npm test` 102 pass; `npm run test:e2e` 12 pass; lint clean.
Junk AuditLog row (`tampered`/`Test`) deleted in one transaction with the trigger disabled and
re-enabled (approved one-off; trigger verified enabled). Rule added to CLAUDE.md: never print
secrets. Open issues: RoleAssignment lookups by userId scan at seed size (optimizer's choice,
no type conversion). Entra unproven; Home cards are demo data; favicon 404.
Next: company admin as the first real page (with its own e2e spec).

## Session 12 — Company admin, departments, administrators, audit log (2026-10-11; the prompt called it "Session 8")

Done: HoldingAdmin can onboard a company from the portal; every write is one audited
transaction. Backend `modules/admin` (companies, logo, departments, admins, people, audit list,
facets, detail, CSV export), store with Prisma and in-memory versions, `lib/{storage,image-type,
time}.js`, migration `20261011030000_company_admin` (CompanyDomain, Department.isActive, logoKey).
Frontend: `#admin/{companies,departments,admins}` and `#audit-log` (compact, stacked under 40rem,
EN/AR/RTL), live light/dark preview via scoped `[data-theme]` (D61), contrast verdict from the one
shared rule `accent.js` (D60), before/after drawer. D60-D67. `docs/ADD-A-COMPANY.md` added.
Files: backend/src/{app.js,config/env.js,lib/*,modules/admin/*,modules/auth/repo-memory.js},
backend/prisma/*, backend/tests/{admin,accent}.test.js, frontend/assets/{css/tokens.css,
css/pages/admin.css,js/{accent,format,api,router}.js,js/components/{dialog,form}.js,js/pages/{admin,
audit-log}*,i18n/*}, tests/e2e/{admin.spec,helpers}.js, docs/*, CLAUDE.md.
Verified: `npm test` 137 pass; `npm run test:e2e` 16 pass (EN/AR, 1440/360); lint clean.
Open issues: Prisma store has no SQL Server test of its own (e2e covers it); the "last holding
admin" guard is only reachable through the service (self-removal fires first); deactivated
companies from e2e runs accumulate (filtered out by default); departments cannot be reassigned
or users moved yet; Entra and directory sync still unproven; logos are local files (Azure Blob
adapter not written).
Next: announcements module, or directory sync to fill people from Graph.

## Session 13 — Test database, announcements (2026-10-11; the prompt called it "Session 9")

Done: **A** tests and e2e run on `mgportal_test` (created, migrated, emptied before each run; D68), `npm run db:reset` (D69), /impeccable polish of the admin pages. **B** announcements end to end: migration `20261011040000_announcements`, module with Prisma and in-memory stores, 8 audited admin actions, covers (2 MB, signature-checked), reads and "read by X of Y", shared Markdown renderer (D72), board / detail / manage / editor with live bilingual preview, Home news card and nav unread count on real data. D70-D75. API.md updated.
Files: backend/{scripts/*,src/config/{env,test-db}.js,src/app.js,src/modules/announcements/*,prisma/{schema.prisma,migrations/*}}, backend/tests/{announcements,test-db}.test.js, frontend/assets/{js/{markdown,format,app,router}.js,js/pages/{announcements.js,announcements/*,home.js},css/pages/announcements.css,i18n/*}, tests/e2e/{announcements.spec,admin.spec}.js, playwright.config.js, docs/*.
Verified: `npm test` 174 pass; `npm run test:e2e` 24 pass twice running (EN/AR, 1440/360); lint clean; polish pass: detector clean, screenshots reviewed at 1440/360 EN/AR.
Open issues: CSP now allows `blob:` images (previews of a chosen file; the company logo preview needed it too). Editor not keyboard-walked by a person; no rich-text help beyond the hint. `prisma generate` failed with EPERM while the dev server held the engine DLL: stop `npm run dev` and run `npm run db:generate`. The dev database still holds old test junk: `npm run db:reset` clears it. Scheduled posts appear by date only: no notification yet.
Next: directory sync from Graph, or room booking.

## Session 14 — Directory and user sync (2026-10-11; the prompt called it "Session 10")

Done: **A** announcements polished (editor warns before losing unsaved changes; duplicate category dropped; cover ratio fixed). **B** Graph adapter (mock: 39 people in `backend/mock/graph-users.json`; real: paging and 429 Retry-After, not yet run against a tenant), `jobs/syncUsers.js` (plan, run, nightly 02:00 Cairo), `SyncRun`, directory API (search with Arabic folding, person, filters), data-quality report with audited CSV, `showMobileInDirectory`, Directory page and panel, top-bar typeahead (hook for rooms and tickets), admin Data quality and Directory sync. D76-D81. Per the brief's adjustments: new people have an empty Arabic name; a run that would deactivate over 20% stops.
Files: backend/{prisma/{schema.prisma,seed.js,migrations/20261011050000_*},mock/*,src/{app,server}.js,src/integrations/graph/*,src/jobs/syncUsers.js,src/lib/text-search.js,src/modules/{directory,admin,auth}/*},backend/tests/directory.test.js; frontend/assets/{js/{app,router}.js,js/components/{person,people-search,icons}.js,js/pages/{directory,admin}.js,js/pages/admin/{quality,sync,companies}.js,css/pages/directory.css,i18n/*}, index.html; tests/e2e/{directory.spec,helpers,smoke.spec,admin.spec}.js; docs/*.
Verified: `npm test` 199 pass (25 new); `npm run test:e2e` 36 pass (EN/AR, 1440/360); lint clean. The first sync against SQL Server ran in e2e (26 created, repeat runs 0).
Open issues: the directory is company-scoped (D76), a product call. Search is a scan. Entra and real Graph unproven (session 19). Synced people have no Arabic name and there is no screen to set one yet. The nightly timer runs only while the process is up. The two e2e projects share one database, so the sync spec tolerates a run it did not start. One burst of 91 API test failures (403 on mock sign-in) did not reproduce in four later runs.
Next: room booking, or an admin screen to set a person's Arabic name.

## Session 15 — Directory follow-ups, room booking backend (2026-10-11; the prompt called it "Session 11")

Done: **A** (commit `2fec30f`) directory group-wide (D82); Arabic names edited from the person panel and imported by CSV with preview, both audited (D83); the 403 burst traced and fixed, and the e2e prepare step found emptying the wrong database (D84); local test database reads by row version like Azure SQL, sync retries on a deadlock (D85). **B** room booking backend: migration `20261011060000_room_booking` (Room, RoomCompany, Booking, MockCalendarEvent, working hours on Company), six seeded HQ rooms, Graph calendar methods (mock on MockCalendarEvent; real written, unrun), `modules/rooms` (rules, service, routes, two stores), D86-D89. No booking screen yet.
Files: backend/{prisma/*,scripts/*,src/{app.js,config/env.js,lib/time.js,integrations/graph/*,modules/{rooms/*,directory/*,admin/*,auth/repo-memory.js}}}, backend/tests/{rooms,rooms-store,directory,seed}.test.js, frontend/assets/{js/pages/{directory.js,admin/quality.js},css/pages/directory.css,i18n/*}, tests/e2e/directory.spec.js, playwright.config.js, docs/*.
Verified: `npm test` 248 pass (5 runs of 199 before the fix, 3 of 248 after); `npm run test:e2e` 48 pass; lint clean. The rooms module also ran against SQL Server (`rooms-store.test.js`).
Open issues: `prisma generate` hit EPERM on the engine DLL while `npm run dev` was running: the client code was written and works (the engine file is byte-identical), but stop the dev server and run `npm run db:generate` once to finish it cleanly. The development database was migrated with `prisma migrate deploy` (session 14's directory migration was still pending there too) but not re-seeded: run `npm run db:seed` for the rooms and the search keys, and `npm run db:reset` (or one ALTER DATABASE) for D85. `mgportal_test_test` is an unused leftover on the local server. Real Graph calendar calls and the delegated token are unproven (session 19). An admin's cancel does not notify the organiser yet. Room and booking audit actions have no labels in the audit log screen. Room names, floors and mailboxes are placeholders. The new directory UI had no /impeccable pass.
Next: the room booking screens, then notifications.

## Session 16 — Room booking frontend (2026-10-11; the prompt called it "Session 12")

Done: Rooms page: Find a room (date, time, length, people, equipment; free rooms, smallest first;
Book then Confirm), Day view (timetable, flips in RTL; list of free stretches on a phone),
booking dialog (subject, people picker on the directory, repeat none/daily/weekly, conflicts
listed, "find another room"), My bookings (series folded, cancel one or later), a room's panel,
Home's bookings card on real data (next 3). New `components/people-picker.js`. API: `hours` on
`GET /api/rooms`, `seriesId` on a booking. `/impeccable critique` (detector clean; single-context,
no sub-agents) and polish: phone form compacted, busy blocks titled, links quiet. D90-D93.
Files: frontend/assets/{js/pages/rooms.js,js/pages/rooms/*,js/components/{people-picker,icons}.js,
js/{format,router}.js,js/pages/home.js,css/pages/rooms.css,css/components.css,i18n/*}, index.html;
backend/src/modules/rooms/service.js, backend/tests/rooms.test.js; tests/e2e/{rooms.spec,helpers}.js; docs/*.
Verified: `npm test` 250 pass; lint clean; rooms e2e 16/16 (EN/AR, 1440/360) in four consecutive runs.
Open issues: the FULL e2e suite is unstable on this machine right now and was with my work stashed
too (login page stuck "loading" for >5 s at cold start, 5-11 failures in older specs); cause not found
(server answers in ~50 ms, DB fine; two `npm run dev` watchers running). Native date fields show
MM/DD/YYYY in English. No room photos supplied. Room names/floors still placeholders; real Graph
unproven (session 19). No notification when an admin cancels. Not keyboard-walked by a person.
Next: notifications, then support tickets; find why cold-start sign-in is slow under full-suite load.

## Session 17 — e2e stability, admin rooms and bookings, audit labels, directory polish (2026-10-12)

Done: **1** the flaky full e2e suite traced and fixed (D94): not the dev servers; the first
query after a start took 1.3 s and six parallel workers starved the one SQL Server (72 s of page
reads per run, no deadlocks). `warmPrisma` before `listen`, one shared client promise, three e2e
workers, 10 s expectations. **2** what was missing from earlier briefs: `#admin/rooms` (list, add
from a mailbox, edit, photo, in use), `#admin/bookings` (filters, paging, cancel with a required
reason, D95-D96), `Booking.cancelReason` (migration `20261011070000`), bilingual audit labels for
room, booking and sync actions, entities and fields, `/impeccable polish` of the directory (names
in the other language now align with their row), field errors clear when the field is put right.
Files: backend/{prisma/*,src/lib/prisma.js,src/server.js,src/modules/rooms/*,src/integrations/graph/mock.js},
backend/tests/rooms.test.js, frontend/assets/{js/pages/admin.js,js/pages/admin/{rooms,bookings,shared}.js,
js/pages/audit-log.js,js/pages/rooms/booking.js,css/pages/{admin,directory}.css,css/components.css,i18n/*},
tests/e2e/{rooms-admin.spec,rooms.spec,helpers}.js, playwright.config.js, docs/*.
Open issues: `prisma generate` could not swap the engine DLL (EPERM) because a server started by
another Claude session at 18:47 held it on port 3000; the client code was regenerated and works,
run `npm run db:generate` once nothing is running. The organiser is still not told of an admin's
cancel (notifications). An admin cannot move a booking from the screen (the API can). Real Graph
unproven (session 19). Native date fields show MM/DD/YYYY in English.
Next: notifications, then support tickets.

## Session 18 — Day view time clarity (2026-10-12)

Done: every booking block in the Rooms day view shows its exact range first, then "Busy ·
organiser" or my subject; narrow blocks show the range on its side; one panel (hover, focus,
tap) gives range, length, subject or organiser and room; full accessible names; hour labels,
quarter-hour lines and a labelled "now" line; free stretches say the quarter hour under the
pointer; the phone list shows booked times with their ranges. `/impeccable polish` on the day
view (detector clean): sideways range forced start-first in Arabic, free-slot text off the grid
lines. D97.
Files: frontend/assets/{js/pages/rooms/day.js,css/pages/rooms.css,i18n/*}, tests/e2e/rooms.spec.js, docs/*.
Open issues: the "now" line and its label only appear on today's date, which the e2e tests (future
days) do not cover; not seen by a person on a real phone; `npm run db:generate` still to be run
once nothing holds the Prisma engine (session 17).
Next: notifications, then support tickets.

## Session 19 — Arabic time ranges, IT helpdesk backend (2026-10-12; the prompt called it "Session 13")

Done: **A** (commit `6061d04`) a time range reads left to right in Arabic too ("10:30–10:45"): one helper in `format.js`, `<bdi dir="ltr">` in markup and Unicode isolates in text and accessible names; rooms e2e measures where the two times sit on screen (D98).
**B** helpdesk backend: migration `20261012000000_helpdesk` (14 tables), `lib/sla.js`, `lib/file-type.js`, `modules/tickets` (rules, schema, service, admin-service, Prisma and in-memory stores, routes under `/api/tickets` and `/api/admin/helpdesk`), `jobs/closeResolvedTickets.js`, seed (IT team, lead and two agents, 9 categories, 5 locations, SLA, calendar, 15 holidays, 4 canned replies). Home's two ticket cards and the nav count are on the real API; demo tickets removed. D99-D105; API.md; rule 1 in CLAUDE.md now names the exception.
Files: backend/{prisma/{schema.prisma,seed.js,seed-data.js,migrations/20261012000000_helpdesk},src/{app,server}.js,src/lib/{sla,file-type,scope}.js,src/jobs/*,src/modules/tickets/*,src/modules/auth/repo-memory.js}, backend/tests/{sla,tickets,tickets-store,seed,auth,directory}.test.js, tests/helpers/fake-prisma.js; frontend/{index.html,assets/js/{app,format,demo-data}.js,assets/js/pages/{home.js,rooms/*,admin/bookings.js},assets/i18n/*}; tests/e2e/{tickets-home.spec,rooms.spec,helpers}.js; docs/*, CLAUDE.md.
Verified: `npm test` 303 pass (53 new: SLA, numbering with 40 concurrent creates on SQL Server, auto-close, reopen window, permission matrix, audit); `npm run test:e2e` 80 pass (new `tickets-home.spec`); lint clean; `prisma generate` ran clean (nothing held the engine).
Open issues: no Tickets page yet (Home links to `#tickets/<id>`, which shows "not open yet"). The development database needs `npm run db:migrate` (or `prisma migrate deploy`) and `npm run db:seed` for the helpdesk tables and the two new people. No notifications on ticket events. A settings change (targets, hours, holidays) reaches an open ticket only at its next status or priority change (D103). Attachments are not virus-scanned and Office macros are not inspected (D104). Islamic holidays in the seed are estimates. Ticket search is number and subject only, no Arabic folding. The mock login lists the IT agents as plain "User". Locations do not match the seeded people's site offices ("Eastern Desert Mine Site"), so only HQ staff get a default location.
Next: the Tickets page (requester list and detail, agent queue, new-ticket form), then helpdesk admin screens and notifications.

## Session 20 — IT helpdesk frontend (2026-10-12; the prompt called it "Session 14")

Done: **A** (`46659bb`, `7b81d5e`) requesters choose the urgency, the category default only preselects it (D106); `portal-project-context.md` ignored. **B** `#tickets`: new ticket (category tiles, urgency with examples, Ctrl+V screenshots with progress), my tickets (open/closed, search), one ticket (label strip, timeline, reply, reopen within 7 days; IT: assign/status/priority/category, contact card with Teams link, canned replies in the requester's language, internal notes drawn apart), IT queue (quick filters, filter bar, SLA badges, bulk assign, log a ticket for someone), `#admin/helpdesk` and `#tickets/settings`, Home's IT card. D107-D110.
Files: frontend/assets/{js/pages/tickets.js,js/pages/tickets/*,js/pages/admin/helpdesk.js,js/pages/{admin,home}.js,js/{api,app,router}.js,js/components/{icons,people-picker}.js,css/pages/{tickets,home}.css,i18n/*}, index.html; backend/src/modules/tickets/{service,schema,store-*}.js (`requesterLanguage`); tests: backend/tests/tickets.test.js, tests/e2e/{tickets.spec,smoke.spec,helpers}.js; docs/*.
Verified: `npm test` 305 pass; `npm run lint` clean; `npm run test:e2e` 96 pass (new `tickets.spec`: 16, EN/AR, 1440/360). `/impeccable critique` (29/40, detector clean, single-context): form width, queue toolbar, SLA "0 min" and tile height fixed; polish fixed oversized icons and a stuck "Saving" button.
Open issues: no notifications on ticket events (replies reach nobody until they open the portal). Not walked by a person on a real phone or with a screen reader. Priority/SLA words for IT are not yet translated by a native reviewer. A team's Lead who is not an admin has no "Admin" nav, only Tickets > Settings. Creating or retiring a team has no screen (API only). Attachment previews are download links, not thumbnails.
Next: notifications (ticket events, then room cancellations).

## Session 21 — Sign-out fix (2026-10-12)

Done: sign-out showed "try again later" because the auth rate limit counted logout (and logout
403'd on a stale CSRF token). Now only sign-in attempts count; mock development allows 1000;
logout needs no CSRF token, never errors, always destroys the session and clears the cookie; the
frontend lands on the login page whatever happens. D111.
Files: backend/src/{app.js,middleware/rate-limit.js,modules/auth/routes.js}, backend/tests/{auth,foundation}.test.js, frontend/assets/{js/auth.js,js/app.js,i18n/*}, docs/*.
Verified: `npm test` 311 pass; `npm run test:e2e` 96 pass; lint clean.
Open issues: production limit is still 20 per 15 min per IP (D45 NAT concern stands). Counters in memory.
Next: notifications (ticket events, then room cancellations).

## Session 22 — Notifications (2026-10-12; the prompt called it "Session 15")

Done: `lib/notify.js` (in-app row + email via Graph `sendMail` as `NOREPLY_MAILBOX`, user's language, company accent; never fails the caller; dedupe keys), mock outbox in `backend/mock/outbox/` + dev page `#dev`, Teams adapter method stubbed. Hooks: ticket created/assigned/public comment/status/auto-close, booking confirmed/cancelled (incl. an admin's cancel with reason), pinned announcement (publish, pin, schedule sweep). `jobs/slaWatch.js` (5 min, 75%/100%, once) and `jobs/pinnedAnnouncements.js`. API `/api/notifications` (list, unread-count, read, read-all, preferences). Frontend: live bell, `#notifications`, `#notifications/preferences`. Migration `20261012010000_notifications` (dedupeKey, NotificationPreference). D112-D117.
Files: backend/{prisma/*,src/{app,server}.js,config/env.js,lib/{notify,messages,time}.js,jobs/{slaWatch,pinnedAnnouncements}.js,integrations/graph/*,modules/{notifications/*,tickets,rooms,announcements}/*}, backend/tests/notifications{,-store}.test.js; frontend/{index.html,assets/{js/{app,router,notification-text}.js,js/components/notification-item.js,js/pages/{notifications,dev-outbox}*,css/pages/notifications.css,i18n/*}}; tests/e2e/{notifications.spec,helpers}.js; docs/*.
Verified: `npm test` 332 pass (21 new, incl. SQL Server store); `npm run test:e2e` 100 pass (new notifications.spec, EN/AR, 1440/360); lint clean; screenshots of bell, centre, preferences reviewed.
Open issues: real Graph `sendMail`/`Mail.Send` unproven (session 19). Teams channel not offered. Mail goes out one by one (fine to hundreds; a company-wide post at thousands needs a queue). Notification ids in email links are tickets/rooms only; email has no per-message unsubscribe beyond the settings link. Arabic copy not reviewed by a native speaker. Ticket numbers may wrap at the hyphen in a narrow bell. Dev DB migrated; run `npm run db:seed` is not needed.
Next: Entra/real Graph proving (session 19), or the remaining admin gaps (team creation screen, set a person's department).

## Session 23 — Helpdesk assignment rules (2026-10-12)

Done: only a Lead or a HoldingAdmin assigns, reassigns or unassigns a ticket; an agent's attempt,
their own ticket included, is 403 `lead_only`. Agents see the whole queue read-only for assignment
and keep replies, notes, status, priority, category. "Assign to me", the agent's checkboxes and bulk
bar and the assign select are gone (agents see the assignee as text). `counts.queue.canAssign`:
Leads/HA see "unassigned" in the nav and on Home, agents "assigned to me". New tickets already told
all Leads; assignments are `assigned` events and tell the new assignee. D118 replaces D101.
Files: backend/src/modules/tickets/service.js, backend/tests/{tickets,tickets-store}.test.js,
frontend/assets/{js/{app.js,pages/home.js,pages/tickets/{detail,queue}.js},css/pages/tickets.css,
i18n/*}, tests/e2e/{tickets,tickets-home,helpers}.js, docs/{DECISIONS,API,PROGRESS}.md.
Verified: `npm test` 332 pass; `npm run test:e2e` 100 pass; lint clean.
Open issues: agents may still change status/priority/category on tickets not assigned to them
(kept as before; one check in `update` if that should narrow). `signOut` e2e helper made
tolerant of an aborted redirect under load. Arabic copy for the new strings not native-reviewed.
Next: Entra/real Graph proving, or the remaining admin gaps (team creation screen).

## Session 24 — Mobile, PWA and accessibility (2026-10-13; the prompt called it "Session 16")

Done: **PWA** manifest (bilingual name, icons, theme), `sw.js` (cache-first shell/CSS/JS/i18n/fonts, network-first API with saved answers, offline page, versioned cache cleaned on update, "Update now" banner), saved answers deleted on sign-out (D119). **Weight**: Brotli-11 precompressed static, no Arabic font for the language switch's word (D120): first load shell+Home 194 kB EN / 293 kB AR, sign-in 138 / 231. **/impeccable adapt + harden** through `resilience.spec` (long names, no data, 200% text, no signal, 500s on 23 addresses): top bar, bottom nav, headings, tags, scroll containers fixed (D121). **axe-core** on every page, both languages and screens: 0 serious/critical; booking and ticket flows keyboard-only.
Files: frontend/{sw.js,manifest.webmanifest,offline.html,index.html,login.html,assets/js/{pwa,offline,app,auth}.js,assets/js/components/{status-banner,company-mark}.js,assets/js/pages/{login,home}.js,assets/js/pages/{rooms/find,tickets/*,admin/rooms}.js,assets/css/{base,layout,components}.css,assets/css/pages/*,assets/img/icons/*,i18n/*}; backend/{src/lib/{service-worker,precompressed-static}.js,src/app.js,src/config/env.js,src/modules/auth/*,scripts/make-icons.js,tests/pwa.test.js}; tests/e2e/{a11y,resilience,pwa,page-weight}.spec.js, helpers.js; playwright.config.js (60 s test timeout, precompression on); docs/*.
Verified: `npm test` 343 pass; `npm run test:e2e` 146+ pass; on this loaded machine 2-4 long specs (tickets, pwa) fail at random in a full run with 3 workers and pass alone or with 2 (`E2E_WORKERS=2`), as in D94; an axe reading mid-fade and a worker install on a starved server were fixed; lint clean.
Open issues: not tried on a real phone, installed, or with TalkBack; Arabic first load is 7 kB from budget (lazy page CSS needs a dependency map, D120); moderate axe findings none, but dialogs and open menus are not scanned; the real tenant/HTTPS worker behaviour (Azure) is unproven; Arabic copy of the new strings not native-reviewed.
Next: Entra/real Graph proving, or the remaining admin gaps (team creation screen).

## Session 25 — Agents work only their own tickets; a green e2e suite (2026-10-13)

Done: **1** an agent replies, changes status, priority or category and reopens only on tickets assigned to them; elsewhere they read and write internal notes (403 `not_assignee`; Leads and HoldingAdmins keep full control). `can.work`; the handling panel shows facts as text, the reply box is notes-only, no reopen button (D122, API.md). **2** the suite is green at 3 workers: three full runs in a row, 150 passed each. Causes found and fixed, not retried: the shell's background counts and bell polls could meet the closed session at sign-out (a 401 in the console) and now share an abort signal that sign-out cancels (`api()` takes `signal`); the `signOut` helper waits for the page to go quiet; static precompression ran Brotli-11 on Node's small thread pool in bursts and starved API calls, so it is now one file at a time in the background with plain serving until ready; the second always-on test server is gone (the worker is opt-in by cookie); test timeout 60 s.
Files: backend/src/modules/tickets/service.js, backend/src/lib/precompressed-static.js, backend/tests/{tickets,tickets-store,notifications,pwa}.test.js, frontend/assets/js/{api,app}.js, frontend/assets/js/pages/tickets/detail.js, i18n/*, tests/e2e/{tickets,tickets-home,notifications,helpers}.spec/js, playwright.config.js, docs/*.
Verified: `npm test` 347 pass; lint clean; `npm run test:e2e` 150 pass, 2 skipped (the page-weight spec's desktop copy, by design), three runs in a row.
Open issues: a moderate axe note (unnamed region landmark, Admin > Directory sync history); on a loaded machine a long spec can still be slow, the 60 s timeout leaves room; Arabic copy for the new strings not native-reviewed.
Next: Entra/real Graph proving, or the remaining admin gaps (team creation screen).

## Session 26 — Design review and polish (2026-10-13; the prompt called it "Session 17")

Done: **A** Help (`#help`, user menu + More sheet, 7 topics x 3 answers in `help-<lang>.json`, contact = new ticket); quieter 32px arrow buttons; English times 24-hour and dates written out beside native fields (D124); ticket numbers never wrap (`.ticket-no`, `keepTicketNumbers`); admin Move on all-bookings (PATCH takes `roomId` + `reason`, organiser told `booking.moved`, audited; D123); axe over open dialogs/menus (`a11y-overlays.spec`, 0 serious, 0 moderate) and the sync-history landmark fixed; AGENTS.md was a byte-identical copy of CLAUDE.md made by another tool, so it is gitignored (one source). **B** detector on frontend/: 19 findings (styleguide chips/dialog, one disabled-colour swatch, Tahoma and Cascadia Mono undeclared), now 0 (fonts declared in DESIGN.md, file-level waivers with reasons in styleguide.html); advisories left: 32 (palette specimens, em-dashes). Critique of Home, Rooms, New ticket and polish of every page were done single-context from screenshots (`review-shots.spec`, E2E_SHOTS=1; no sub-agents): Help spacing/contact row, framed empty state on every list page (DESIGN.md updated), admin filter alignment. Home scores 29/40 (was 26/40; self-scored, not independent).
Files: frontend/{index.html,assets/{js/{app,router,html,date-inputs,notification-text}.js,js/pages/{help,home,notifications,audit-log}.js,js/pages/admin/*,css/{base,components,pages/help,pages/admin}.css,i18n/*}}; backend/src/{modules/rooms/*,integrations/graph/*}; tests: rooms, notifications, e2e a11y, a11y-overlays, review-shots, rooms-admin; docs/*, DESIGN.md, .gitignore.
Verified: `npm test` 348 pass; `npm run test:e2e` 154 pass, 10 skipped (3 workers); lint clean.
Open issues: a device set to US order still draws the native field month first (words beneath are day first); real Graph room swap unproven; Arabic Help and move strings not native-reviewed; critique not run with two isolated agents.
Next: Entra/real Graph proving, or the team creation screen.

## Session 27 — Security review and deployment preparation (2026-10-13; the prompt called it "Session 18")

Done, nothing deployed. **A** session store and CSRF reviewed against OWASP, findings in `docs/SECURITY-CHECKLIST.md`: a role change ends the session (D126), 12 h absolute lifetime beside 8 h idle (D127), secret rotation, `Sec-Fetch-Site` check, App Service proxy trusted for one hop with the port stripped, sign-in capped per account (10) with a 600 per-address ceiling (D128), strict CSP with no inline styles (76 `style=` attributes became `data-css`, D129), `Permissions-Policy`, CORS closed and tested, authorisation matrix over all 111 routes x 7 kinds of person (`authz-matrix.test.js`; no route untested, none wrong), uploads served only after a malware scan with pending/clean/infected (mock scanner locally, Defender for Storage tags in Azure, D130), log redaction widened. **B** Azure Blob adapter, job leases (D131), `/api/ready`, graceful shutdown, production refuses anything mocked, Application Insights hook (D132), `npm run db:deploy`, `docs/DEPLOY.md`, `.github/workflows/deploy.yml.disabled`. Migration `20261013000000_file_scan_job_lease`.
Files: backend/src/{app,server}.js, config/env.js, lib/{session,client-ip,file-scan,storage,storage-azure,job-lease,telemetry,logger}.js, middleware/{auth,csrf,rate-limit,errors}.js, jobs/*, modules/{auth,tickets,admin,rooms,announcements,notifications}/*, prisma/*, scripts/migrate-deploy.js; backend/tests/{security,file-scan,job-lease,authz-matrix,auth,admin,foundation}.test.js; frontend/assets/js/{html.js,pages/{rooms/day,admin/companies,tickets/shared,dev-outbox,login,styleguide}.js,components/icons.js,notification-text.js}, css/pages/tickets.css, i18n/*, styleguide.html; tests/e2e/{helpers,resilience.spec}.js; docs/*, CLAUDE.md, .env.example, package.json.
Verified: `npm test` 524 pass (176 new: security, file-scan, job-lease incl. a 12-way race on SQL Server, authz-matrix); `npm run test:e2e` 154 pass, 10 skipped at 3 workers; lint clean. Found on the way (D134): after 17:00 Cairo the Rooms page asked for an hour that ran past 18:00, got a 400 and failed every spec that opens Rooms, on the previous commit too; the default length now fits the day.
Open issues: NOTHING AZURE HAS RUN (no subscription or tenant): the Blob adapter, the Defender tag name and values, Application Insights, the two SQL logins with `prisma migrate deploy`, and whether malware scanning is offered in South Africa North are all unproven; DEPLOY.md says where. The Prisma CLI advisory has no fixed release (D133). Rate-limit counters are per instance. With Defender an uploaded image is unavailable until scanned (seconds to minutes) and the UI shows a broken image meanwhile; only ticket attachments show "being checked". Arabic for the new strings is not native-reviewed. The cost table in DEPLOY.md is from memory, not a quote. `applicationinsights` adds ~150 packages.
Next: Entra/real Graph proving, then a first deployment following DEPLOY.md with the developers present.

## Session 28 — The IT Helpdesk as a workspace of its own (2026-10-14)

Done: `/helpdesk` (`helpdesk.html`, `helpdesk.js`, `pages/helpdesk/*`, `helpdesk.css`): header, Queue, My assigned tickets, Reports (counts by status/priority/category/company/location, SLA met/breached/running, average first response and resolution in business time, date range, CSV), IT settings for leads, bell, account menu with language switch and "New ticket for me"; EN/AR, phone bottom nav. IT team members have no portal (the portal page sends them to `/helpdesk`, its APIs answer `403 helpdesk_only`); everyone else gets `403` + `no-access.html` and is refused every IT route (`requireIt`). HoldingAdmin/CompanyAdmin lose all ticket access but their own; only leads assign (D118 updated); settings moved to `/api/helpdesk/settings` (leads, audited); HoldingAdmin keeps Administration > IT team (`/api/admin/it-team`, last active lead kept, `409 last_lead`). IT membership is in the session's privilege key, so joining/leaving applies from the next request. IT notifications link to `/helpdesk#tickets/<id>`. Portal: queue, settings and Home's IT card removed. Popover and bell code shared (`components/popover.js`, `bell.js`); router takes a route table. D135.
Files: backend/src/{app.js,lib/roles.js,middleware/auth.js,modules/auth/*,modules/helpdesk/{routes,pages}.js,modules/tickets/{admin-service,reports,routes,rules,schema,service,store-*}.js,modules/notifications/email.js}; backend/tests/{authz-matrix,tickets,tickets-store,helpdesk}.test.js; frontend/{helpdesk.html,no-access.html,assets/js/{helpdesk,no-access,app,router}.js,assets/js/components/{bell,popover,people-picker}.js,assets/js/pages/{helpdesk/*,tickets.js,tickets/*,admin.js,admin/it-team.js,home.js},assets/css/pages/{helpdesk,home}.css,i18n/*}; tests/e2e/*; docs/*, CLAUDE.md.
Verified: `npm test` 539 pass (new `helpdesk.test.js`: pages, /api/me, 403s, joining and leaving the team, notification links, reports); authz matrix rewritten (IT routes: agent/lead only; portal routes: never IT); `npm run test:e2e` 158 pass, 10 skipped at 3 workers (8.7 min, same as the previous commit measured the same day); lint clean. Earlier runs failed under load until the Helpdesk stopped re-fetching queue options and counts on every page, and the server stopped reading the session on `/` (the portal script redirects IT instead).
Open issues: creating/retiring a team has no API now (seed or migration); an IT member's old non-ticket notifications open "page not found" in the Helpdesk; the privilege key is set on the first guarded request, not at sign-in, so a change in between is not noticed until the next one; Arabic for the new strings is not native-reviewed; the Helpdesk is not offline-capable (no worker precache).
Next: Entra/real Graph proving, then a first deployment following DEPLOY.md.

## Session 29 — Real Microsoft sign-in (2026-10-14; the prompt called it "Session 19", first part)

Done: `AUTH_MODE=entra` completes on the existing msal-node flow; Microsoft refusals map to `consent_required`/`not_assigned`/`app_setup`/`cancelled` with login-page text saying what to ask the Global Admin for. JIT profile from the ID token, company by email domain (`Company.domain`/`CompanyDomain`), audited; unknown domain → "your company is not set up", nothing created. `INITIAL_HOLDING_ADMINS` bootstrap (only while no active HoldingAdmin with a real object id), audited. D136.
Files: backend/src/{config/env.js,modules/auth/{entra,provision,repo,repo-memory,schema}.js}; backend/tests/{auth,auth-store,foundation}.test.js; frontend/assets/{js/pages/login.js,i18n/*}; tests/e2e/sign-in-errors.spec.js; .env.example; docs/{API,DECISIONS,PROGRESS}.md.
Verified: `npm test` 547 pass (new: JIT, other domain, inactive company, unknown domain, bootstrap once/only-real/deactivated, refusal mapping, env list; `auth-store` on SQL Server); new e2e spec 20 pass; lint clean. Full e2e: 1 failure in `pwa.spec` "no signal", which fails the same ways on the previous commit (2 of 5 runs there).
Open issues: NOT YET TRIED AGAINST THE REAL TENANT in this session (the user does that by hand, see the chat's .env lines). JIT profiles have no Arabic name until sync. Bootstrap check is not locked against two simultaneous listed sign-ins. Arabic copy not native-reviewed. The `pwa.spec` offline test is flaky.
Next: manual Entra sign-in on localhost; then real Graph (session 19, second part).

## Session 30 — Real Entra sign-in fix: the nonce (2026-10-15)

Done: the first real attempt after admin consent ended on "Sign-in did not finish". The redirect to Entra and the session cookie were fine; msal-node 7 refused the token at code redemption (`nonce_mismatch`) because we checked the nonce ourselves but never handed it to MSAL. `acquireTokenByCode` now receives `nonce` (D137). The test stand-in for MSAL enforces the same rule.
Files: backend/src/modules/auth/entra.js, backend/tests/auth.test.js, docs/{DECISIONS,PROGRESS}.md.
Verified: `npm test` 547 pass (without the fix 8 auth tests fail); lint clean. e2e not run (no frontend change).
Open issues: still not yet confirmed against the real tenant (user retries by hand); the dev log goes only to the terminal, so a past attempt can't be read afterwards.
Next: user retries Entra sign-in on localhost; then real Graph.

## Session 31 — Profile refresh from Graph at Entra sign-in (2026-10-15)

Done: the Entra callback asks for `User.Read` and reads the person's own `/me` and `/me/manager` with that token (`integrations/graph/delegated.js`), then updates their UserProfile via `modules/auth/refresh.js` (sync's rules; Arabic name kept; changed fields only, audited `user.graph_refresh`). Runs in GRAPH_MODE=mock too; a refused `/me/manager` is skipped and logged once; Graph failures never block sign-in. Tests now default to mock AUTH/GRAPH modes whatever `.env` says (D138).
Files: backend/src/{app.js,config/env.js,integrations/graph/delegated.js,modules/auth/{entra,refresh,repo,repo-memory,routes}.js}; backend/tests/entra-profile.test.js (new, 15); docs/{API,DECISIONS,PROGRESS}.md.
Verified: `npm test` 562 pass; lint clean. e2e not run (no frontend change).
Open issues: not yet tried against the real tenant; `/me/manager` will likely be refused until User.Read.All (or sync) is in place; a company move does not move role scopes (same as sync). The local `.env` has GRAPH_MODE=real with a placeholder NOREPLY_MAILBOX, so `npm run dev` refuses to boot until it is set or GRAPH_MODE=mock.
Next: user signs in with Entra and checks their profile; then real Graph.

## Session 32 — Real directory: own Graph mode, demo and live databases (2026-10-19)

Done: `GRAPH_DIRECTORY_MODE` (users/managers only, app-only token; mail, calendar, rooms stay on `GRAPH_MODE`); `PORTAL_DATA=demo|live` (live = `mgportal_live`, needs Entra sign-in + real directory; demo refuses the real directory; seed/reset refuse live); `npm run db:live:setup` (created + migrated `mgportal_live` with GEN, MSR, HLD and their domains only); `npm run sync:users [--dry-run]` with a per-company/manager/department/domain report; guests skipped and counted; Graph errors carry Graph's code; README "Demo and live data". D139.
Files: backend/src/{config/{env,test-db}.js,integrations/graph/{index,real}.js,jobs/syncUsers.js,server.js}; backend/scripts/{setup-live-db,sync-users,reset-db}.js; backend/prisma/seed.js; backend/tests/{directory,foundation}.test.js; frontend/assets/i18n/*; playwright.config.js; package.json; .env.example; README.md; docs/*.
Verified: `npm test` 572 pass; lint clean; e2e 175 pass, 10 skipped, 3 failed under load (pwa offline, rooms-admin, tickets) that pass alone (40/40, 2 workers). Live setup ran: 3 companies, 0 departments, 0 people.
Open issues: THE REAL SYNC DID NOT RUN: Graph answered 403 `Authorization_RequestDenied` and the app's client-credentials token carries no application roles, so User.Read.All is not (yet) granted as an Application permission with admin consent on this registration. HLD's real mail domain is unknown (still `mgholding.example` in live; set with `--domain`). The live database has no IT team, so tickets cannot be filed there yet. The admin page shows the run's counts and warnings but not the per-company/manager summary (CLI only).
Next: fix the permission in Entra, then `npm run sync:users -- --dry-run`, then a real run; add live departments from the unmatched list.
