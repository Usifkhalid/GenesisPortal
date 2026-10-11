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
