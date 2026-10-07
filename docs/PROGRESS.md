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
