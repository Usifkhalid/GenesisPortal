# Decisions

Durable choices and the reasoning behind them. Newest session last.

## Session 4 — App shell (2026-10-07)

### D18. Disclosure popovers, not `role="menu"`

The notifications bell and the account button open a `.menu` panel that mixes static text
with ordinary links/buttons. `role="menu"`/`"menuitem"` promises a roving-tabindex,
arrow-key-navigable widget; `initPopover()` only wires Escape and an outside click, so the
role was removed rather than the keyboard behaviour added — a static notification row has
no sensible menuitem semantics anyway. `aria-haspopup`/`aria-expanded`/`aria-controls`
already describe a disclosure correctly without it.

### D19. Language switch lives in the account menu, not the top bar

A standalone EN/AR segmented control in `.topbar` left too little room for the search box
on a ~360px phone once the notification bell and account button took their share (an
independent review caught this before shipping). Moving the two language rows into the
account menu removes that chrome on every width, not just mobile, so the top bar carries
one account-ish control instead of two, and `nav.account`'s button is the only
`aria-controls` target search has to compete with.

### D20. Bottom nav's four favor the site-staff audience, not a fixed list order

Home, Tickets, Directory, Announcements take the four always-visible slots; Rooms moves
into the "More" sheet. Room booking is HQ-desktop-centric (the rail has no such limit and
keeps all five), while a site worker's two most likely one-handed lookups — an open ticket
and a colleague's number — are exactly the two the original Home/Announcements/Rooms/
Tickets/Directory order buried behind a tap.

### D21. The rail collapses by hiding content, not by truncating it

Collapsing the rail sets `--rail-width` to `var(--rail-width-collapsed)` on `:root` (so the
grid column that already reads `var(--rail-width)` just picks up the new value) and toggles
the existing `.u-visually-hidden` utility on each label span, rather than `display:none`.
Position-absolute removal from flow stops the icon-only rail from overflowing without ever
taking a link's name out of the accessibility tree. No new CSS for the hidden state was
needed because of this reuse.

### D22. `.segmented`'s 1px inset was a pitch-rule violation, not a style choice

The impeccable detector flagged cramped padding on `.segmented`; its `padding:
var(--space-px)` was the hairline token doing a spacing job. `--space-px` is documented as
existing only for the hairline itself, so the fix was `var(--space-1)` (4px, back on the
pitch), not a one-off exception.

## Session 3 — Design system (2026-10-07)

### D1. Visual world: "The Assay Card"

Chosen by the user from a seven-candidate round against six dealt challengers. Every
record in the portal (ticket, room, colleague, announcement) opens with the same ruled
strip of real key/value pairs, carries its body, and closes with a provenance line.

Rejected, with what each gave up: a pure black-and-white data field (no room for a
runtime accent, no usable monospace Arabic), a botanical plate folio (decorative for a
mining and construction group), a pastel character catalogue (wrong register against
PRODUCT.md's "calm, corporate, no hype"), a labanotation score (bilateral symmetry is
incompatible with a mirrored RTL shell), a warm consumer app surface (good for site
staff, too loose for HQ density, bottom-bar-only navigation), and a Crouwel grid
specimen (grid-constructed letterforms cannot be made for cursive Arabic, so half the
users would get only the ordinary version of the idea).

Three disciplines were carried over from the rejected candidates: one declared 4px pitch
with hairline-only separators; identical label-block furniture on every record type; and
state encoded twice, never by colour alone.

The user added four binding adjustments: Arabic must look as deliberate as English; the
phone keeps thumb-reachable bottom navigation with 44px targets; the label strip must
always carry real fields; and tabular numerals and hairlines must be checked in both
scripts and in dark mode.

### D2. Type: IBM Plex Sans + IBM Plex Sans Arabic, two weights

Self-hosted, SIL OFL 1.1. Chosen over Inter and the system stack (both excluded by the
brief) and over Noto (too neutral) and Cairo (Arabic-first, weak Latin). Plex reads as a
drafted engineering face, which suits the sector, and its Arabic was drawn alongside the
Latin rather than bolted on.

Only 400 and 600 ship, so both scripts have identical weight coverage. Google serves the
Latin as one variable file per subset but the Arabic as static instances, so three
weights would have cost an Arabic reader ~130 kB. Two costs 89 kB.

The Arabic subset's unicode-range excludes U+0030–0039, so every digit in both languages
is set by the Latin face. Tabular numerals therefore line up identically whichever
language the portal is in.

### D3. Accent derivation: one supplied value, everything else computed

A Company record sets only `--brand-accent`. Fill, hover, active, on-colour, ink, edge
and two washes are derived in `tokens.css` using relative colour syntax, with a
`color-mix` fallback behind `@supports`.

Two non-obvious pieces of arithmetic:

- **The black/white decision uses WCAG relative luminance, not OKLCH lightness.** A
  saturated red sits at OKLCH L 0.52 but has luminance Y 0.13, so a lightness threshold
  picks black and fails 4.5:1. White clears 4.5:1 when Y ≤ 0.1833 and black when
  Y ≥ 0.175; those ranges overlap, so the single threshold Y = 0.179 is always safe. Y is
  computed in the `srgb-linear` space where the r/g/b channel keywords are linear-light.
- **Hover and active mix the fill away from its label colour.** A dark fill darkens and a
  light fill lightens, so label contrast can only improve under press. Moving the other
  way breaks it. For a near-white or near-black accent the fill has almost nowhere to go,
  so hover is carried by a ring in `--brand-accent-edge`, which is clamped to clear 3:1
  against the page.

Bounds were found by sweeping all 360 hues at six chroma levels, not chosen by eye:
ink caps at L 0.46 (light) / floors at 0.78 (dark); edge caps at 0.56 (light) and is
banded to [0.56, 0.72] (dark, where a floor alone collapses onto ink for pale accents).
Verified against 14 accents including pure white, near-black and mid grey.

`--text-on-fill` was removed: it duplicated `--brand-accent-on` but was a fixed neutral,
so reaching for it would have silently lost the contrast guarantee.

### D4. Hairlines carry structure; shadows only for floating layers

A card, input, table and tab get their edge from a 1px hairline against a tonal surface
step. `--shadow-1` and `--shadow-2` are reserved for dialogs, toasts, popovers and the
switch knob. No element gets both a border and a shadow.

Card radius is 10px rather than the 12–16px that currently reads as default; at 16px a
label card stops looking measured. Recorded as a deliberate departure.

### D5. Arabic is designed for, not mirrored

Arabic takes its own leading (1.75 vs 1.55) and measure (60ch vs 68ch), because Plex
Arabic's ascenders and descenders collide at Latin line heights. It never takes uppercase
or letter-spacing, so the Latin micro-label's small-caps treatment is **replaced** for
Arabic by weight and colour at a larger size rather than applied and broken. The same
substitution is applied to table headers, definition-list terms and the stacked-table
cell labels.

All layout uses CSS logical properties. Three exceptions are marked in the source because
the properties have no logical form: the select chevron's `background-position`, the
active nav link's inset `box-shadow`, and `.icon--dir` for directional icons.

### D6. Shell placement is scoped to the shell

`grid-area` on `.rail`, `.topbar` and `.main` is declared on `.app > …`, not on the
component. Unscoped, a rail dropped into any other grid resolves `rail` as a *named grid
line*, which does not exist there, and gets stranded in an implicit track — this actually
happened in the styleguide's shell preview and collapsed the rail to 35px.

### D7. Native controls, restyled, wherever one exists

Checkbox and radio are the native inputs with `accent-color`. Date and time are the
native pickers, so Android opens the platform dialog and nothing needs JavaScript;
`color-scheme` on `:root` is what makes the picker panel follow the theme. Modals are
`<dialog>` with `showModal()`, which supplies the focus trap, the inert background,
Escape-to-close and the top layer. Only the switch is drawn, because no native control
exists; it is a real checkbox underneath.

### D8. Verification was run, not assumed

A headless-Chrome DevTools-Protocol harness (no dependencies; Node 24's built-in
WebSocket) checks 16 views: desktop and 360px phone × EN/AR × light/dark, plus the four
test accents in light and dark. It composites each text node's real painted background
and resolves `color()`/`oklch()` values through a canvas, because Chrome reports relative
colours unresolved and a regex over the string is wrong.

Four Impeccable detector findings remain and were each confirmed false positives rather
than suppressed: `badge`, `segmented` and `dialog` are flagged for "cramped padding"
because the padding sits on the parent (badge 4/8px with a 24px chip; segmented's 1px is
the nesting inset, options are 32px with 12px padding; the dialog's `padding: 0` is
required so header and footer rules are full-bleed while the body scrolls, and each
region carries 16–20px). The "37 em-dashes" are CSS custom-property names printed as
visible text on a page whose job is to document tokens.

## Session 1 — Project scaffold (2026-10-07)

Scaffolded after sessions 2 and 3, so these decisions take the product brief and the
design system as given. D1 (the Assay Card) and D2 (IBM Plex) above are unchanged and
remain the binding visual direction.

### D9. One root package.json, not a workspace

The backend serves the frontend as static files and the frontend has no build step, so
there is nothing for a second manifest to own: no frontend dependencies, no bundler, no
separate install. One `npm install` and one `npm test` is the smallest thing that can run
the whole project, which matters most to whoever picks this up on a weak connection.

### D10. config/env.js is the only reader of process.env

Every variable is parsed once through a zod schema at import time, so a missing
`SESSION_SECRET` or a malformed `PORT` fails at boot naming the variable, never halfway
through a request. `.env` is read by Node's own `process.loadEnvFile` rather than dotenv —
Node 24 has it, so it is one fewer dependency — and its absence is not an error, because
Azure App Service supplies real variables instead of a file.

Variables that only some modes need (`DATABASE_URL`, `SESSION_SECRET`, `ENTRA_*`) are
optional in the schema today. They become conditionally required as the modules that use
them land, so that a clean checkout can run `npm run dev` and the health check with no
database and no tenant.

### D11. app.js builds the app; server.js listens

`createApp()` returns an app without binding a port, so supertest drives the real
middleware chain in-process with no port, no teardown race and no fixed port number in
tests. Only `server.js` calls `listen`, and it is the only file `npm run dev` names.

### D12. The health check touches nothing

`GET /api/health` reads no database and no session. It answers on a clean checkout before
`db:migrate` has ever run, which is what makes it usable as an Azure App Service health
probe: a probe that fails when the database blinks takes the whole site down with it.
Database readiness gets its own endpoint when there is a database to report on.

### D13. Prisma is imported lazily

`lib/prisma.js` dynamically imports `@prisma/client` on first use rather than at module
load. With an empty schema there is no generated client yet, and a top-level import would
make `npm run dev`, `npm test` and the health check all fail on a fresh clone until
someone ran `db:generate`. Scoping still goes through `lib/scope.js`; this module owns only
the connection.

### D14. Graph has one door, chosen at runtime

`integrations/graph/index.js` resolves `mock.js` or `real.js` from `GRAPH_MODE`, and
nothing outside that folder may call Graph or hold a Graph token. Real tenant access has
not been granted, so `real.js` is a stub that throws by name rather than quietly falling
back to the mock — a silent fallback in production would serve fake colleagues as if they
were real.

### D15. CSP is set now, while the frontend is small

helmet with `script-src 'self'` and no inline-script allowance, which the design system
already satisfies: its only script tags are external modules. `style-src` keeps
`'unsafe-inline'`, because the styleguide sets custom properties through style attributes,
but drops helmet's default blanket `https:` allowance, since nothing is loaded from
outside the origin. Choosing this before there are features means features are written
to fit it, rather than the policy being loosened later to fit the features.

### D16. Prettier is configured to the code that already exists

`printWidth: 96` and single quotes match session 3's frontend JavaScript, so `npm run
lint` passes over it without rewriting a line. Three deliberate exclusions, each for a
reason rather than convenience: Markdown (Prettier rewraps prose, re-quotes the YAML front
matter Impeccable reads out of DESIGN.md, and would rewrite CLAUDE.md), the design
system's CSS and styleguide.html (verified in a browser; reformatting them risks a
regression for no gain), and `components/icons.js` (a table of long SVG path strings where
Prettier moves the break on some entries and not others, which reads worse than the
aligned original).

`.gitattributes` pins `eol=lf` for the same reason: without it a Windows clone
converts every file to CRLF and `prettier --check` then fails on files nobody edited.

### D17. The prisma CLI advisory is accepted, not patched

`prisma` 6.19.3 depends on `deepmerge-ts` <8 through `@prisma/config`, a high-severity
stack-exhaustion advisory. No stable Prisma release avoids it — the advisory range covers
every published version and only an 8.0.0 release candidate sits outside it — and
`@prisma/config` is used by the CLI at migration time, never by the server at runtime, so
it is reachable only by a developer running `db:migrate` against their own schema. Pinned
as-is and recorded here; revisit when Prisma 8 ships.

## Session 4b — Shell and Home redesign (2026-10-07)

### D23. Soft outside, measured inside

The owner's reference (a consulting site) moved the surfaces to soft 16px cards, a 24px
banner, pine ink and a lime highlight. The Assay Card was kept where it does work: inside
a card every record still opens with the hairline label strip. This replaces the old
"no card radius above 10px" rule; DESIGN.md was rewritten, not patched.

### D24. Density is a token set, and compact is the old geometry

Components read `--radius-control`, `--radius-card`, `--control-height`, `--pad-*` and
`--text-cell`, never the raw scale. `[data-density='compact']` swaps the set to 6px
controls / 10px frames / 8px rows, which is exactly the session-3 measure, so work pages
lose nothing. Tables and record lists always carry it; a work page sets it on `.page`.

### D25. Lime is fixed; the accent still owns actions

`--highlight` is not derived from the company. It appears only on round arrow buttons,
icon discs and the "new" tag, always under `--highlight-on` (pine, 11.8:1, same in both
themes), with a 3:1 keyline on light grounds. Primary buttons, links, focus and the
current page stay on the derived company accent, so "works with any accent" still holds.

### D26. "Light" headings are weight 400, not a new font file

The shipped fonts cover 400-600. A real 300 means re-fetching the Latin variable file and
a third Arabic static (+43 kB for an Arabic reader on 3G). `h1`, `h2` and the display size
use 400; bold is kept for card titles and values. Revisit only if the owner wants thinner.

### D27. Text never sits on the banner photo, and phones get no photo

The banner is a split: text column, then a photo slot from 56rem of page width. Contrast
therefore never depends on whichever photo is supplied, and a site phone never downloads
one (a lazy image in an undisplayed slot is not fetched). Until `photoUrl` exists the
placeholder is shown to admins only.

### D28. Bottom nav is Home, Tickets, Rooms, Directory, More (amends D20)

"Book a room" is now one of Home's two primary actions, so its destination cannot sit
behind More. Tickets and Directory keep their slots, as D20 argued; Announcements moves
into More, since Home already shows the latest three.

### D29. The page grid answers to its container, the rail does not scroll

`.page` is an inline-size container and `.bento` uses container queries, so Home lays out
the same with the rail open, collapsed or absent. The rail's scroll moved to an inner
`.rail__scroll` so the company menu can open over the work area without being clipped.

### D30. Demo data is one module of i18n keys

`assets/js/demo-data.js` holds the stand-in companies, user, tickets, bookings and people,
every display string an i18n key under `demo.`. Company accents there are placeholders,
not the real brand colours. Delete the file when the last importer has an API.

### D31. The banner has no photo (supersedes D27)

The owner asked for the HQ/site image to go. The banner is now the text column alone at
every width; the `.photo-slot` component, its styleguide specimen, its i18n keys and the
demo `photoUrl` field are removed with it.

### D32. A company logo is a self-contained tile, self-hosted

Both supplied logos are drawn for a dark ground (Genesis gold on #181818, Masar white on
#023E4A), so the ground is baked into the file rather than guessed by the UI. Genesis is
its site's square favicon mark (SVG, 0.6 kB); Masar has no square mark, so its tile is the
wordmark at 1.6:1 (PNG, 5.9 kB), the widest that fits the collapsed rail. Files live in
`assets/img/companies/` because the CSP allows images from 'self' only; `logoUrl` on the
Company record points at them. `components/company-mark.js` is the one place a mark or a
name-with-mark is built. In the company menu a company without a logo keeps its colour
swatch, since the short-name fallback is drawn on the current company's accent.

### D33. Ids are lowercase UUID strings in char(36)

Generated by Prisma (`@default(uuid())`), not `uniqueidentifier`: the value read back is
byte-for-byte the value written, so scope checks can compare ids as plain strings with no
case normalisation.

### D34. SQL Server shapes three column types

No enums, so `role`, `channel` and `language` are strings constrained by zod
(`lib/roles.js`). No Json type, so `AuditLog.before/after` and `Notification.payload` are
`nvarchar(max)` holding JSON. A unique index admits one NULL, so `entraObjectId`, `email`
and `Company.domain` are required; mock users get made-up object ids. Every relation is
NoAction on delete and update, because SQL Server rejects multiple cascade paths.

### D35. AuditLog and Notification carry companyId

Not in the brief's column lists, added for rule 1. `AuditLog.companyId` is nullable (NULL =
holding-wide change) and is what lets a CompanyAdmin read only their company's trail.
`Notification.companyId` copies the recipient's company.

### D36. AuditLog is append-only in the client, not yet in the database

`lib/prisma.js` wraps the client in an extension that throws on update, upsert and delete
of AuditLog, transactions included. A database trigger would also stop writers that bypass
the app; it was left out because no SQL Server was available to test one against.

### D37. scope.js ANDs the caller's filter with the scope, and answers 404

`scopeWhere(req, where)` returns `{ AND: [where, scope] }`, so a `companyId` or `OR` in a
filter built from client input can narrow a result but never widen it. A record or company
outside the caller's scope is `404`, as docs/API.md promises; `403` is kept for a company
the caller can see but not administer. HoldingAdmin counts only with a NULL scope. A
CompanyAdmin of a second company reads both.

### D38. Seed data is a plain module; tests do not need SQL Server

`prisma/seed-data.js` holds the records, `seed(prisma)` loads them idempotently by natural
key. Tests run the seed against an in-memory fake that enforces the unique keys, and once
more against the real database when one is configured and migrated (skipped otherwise).
HLD's mail domain is the placeholder `mgholding.example` until the real one is supplied.

## Session 8 — Sign-in, roles and company scoping (2026-10-09)

### D39. `/api` is closed by default

`app.js` mounts the sign-in routes, then `loadUser` + `requireAuth` on `/api`, then every
other route. A module cannot forget to ask for a session. The cost: an unauthenticated
request to a path that does not exist is `401`, not `404` (three older tests were changed to
say so). Static files, `/api/health` and the sign-in routes stay public.

### D40. Our own session store and CSRF check, no extra packages

`lib/session.js` is a ~60-line express-session store over the `Session` table (the
maintained Prisma store packages lag Prisma 6). CSRF is a synchroniser token kept in the
session and sent in `X-CSRF-Token`; `csurf` is deprecated. The token is checked on every
non-GET under `/api` and `/auth`, sign-in and sign-out included. The session is only
mounted on `/api` and `/auth`, so static files never touch the database.

### D41. `req.user` is rebuilt on every request

The session holds only a user id. Roles, company and active flags are read fresh each time
(one query), so revoking a role or deactivating a person works immediately. `scopes` on
`req.user` is `scopesOf(user)` from `lib/scope.js`; scope.js still derives from `roles`, so
there is one source of truth.

### D42. Without SQL Server, development and tests run in memory

When `DATABASE_URL` is missing or a placeholder (and always under `NODE_ENV=test`), users
come from `prisma/seed-data.js` through `modules/auth/repo-memory.js` and sessions use
express-session's MemoryStore. The server logs a warning. Production cannot boot without a
database. This is why sign-in could be built and seen before SQL Server is installed; the
Prisma repo and store have the same interface but have not yet run against a real database.

### D43. Mock sign-in answers 404 outside development

`GET /api/auth/mock-users` and `POST /api/auth/mock-login` need both `AUTH_MODE=mock` and
`NODE_ENV=development`, checked per request. Tests pass `config: { NODE_ENV: 'development' }`
to `createApp` to sign in, and prove the refusal with the real test environment.

### D44. Entra: PKCE, state and nonce made by us; redirect URI from `APP_BASE_URL`

MSAL builds the URL and redeems the code; the verifier, state and nonce are generated with
`node:crypto` and kept in the session, single use. The redirect URI comes from the new
`APP_BASE_URL` variable (required in production), never from the Host header. A profile is
matched by `entraObjectId`, then by `preferred_username`/`email`; an email match writes the
real object id onto the profile, because seeded and pre-created profiles carry a made-up
one. Tokens are dropped after the claims are read. Sign-out is a POST (CSRF-protected) that
returns Entra's sign-out URL for the browser to follow, since CSP `form-action` would block
a form redirect.

### D45. The auth rate limit does not count drawing the login page

`GET /api/auth/config` and `GET /api/auth/mock-users` are exempt; sign-in attempts and the
Entra routes are counted. Open: 20 per 15 minutes per IP is too low for an office behind one
NAT address in Entra mode (two requests per sign-in); raise `AUTH_RATE_LIMIT_MAX` before
going live.

### D46. Login page: one button for real users, a record list for mock

Entra mode is a heading, one primary button and one line, in a reading column centred in
the viewport; the loading skeleton has that shape. Mock mode is a card per company holding
a record list (label strip of role and job title over the name), the whole row being the
button. The page uses the token placeholder accent, since no company is known before
sign-in. `.notice__title + p` was tightened in components.css for every notice.

## Session 9 — Frontend core (2026-10-11)

### D47. Hash router with one route table

`router.js` reads `#route/params?query` and lazy-loads `pages/<name>.js`, which exports
`render(root, ctx)` and may return a clean-up function. Hashes, not the History API, so the
server only ever serves `index.html`. The route table lists every address the portal has;
three outcomes never reach a module of their own and are drawn by `pages/status.js`: no such
route (404), a route whose nav key `GET /api/me` did not list (no access), and a route whose
module is not built yet ("not open yet", a placeholder that goes with the last module).
"No access" is courtesy; every API route still checks the session itself.

### D48. Navigation moves focus to `<main>`; the skip link is handled by hand

After a hash change the work area scrolls to the top and `<main tabindex="-1">` takes focus,
so a keyboard or screen-reader user starts at the new page. `href="#main"` would be read as
a route, so the skip link's click is intercepted and focuses `<main>` without touching the
address.

### D49. `api()` announces failures itself; reads retry once, writes never

A failed request raises a toast in the language in use, chosen by HTTP status under
`error.*` (the server's English message is never shown), then throws. A caller that shows
the failure in place passes `quiet: true` (boot, login, sign-out, Home's cards). A GET that
never reached the server is retried once after 600 ms; a POST/PUT/DELETE is not, because it
may have arrived. The same toast is not stacked twice.

### D50. Home's cards load on their own

The banner (person, company, Cairo date) is real and paints at once. Each card has a `load`
that returns its records and is drawn as skeleton, rows, one-line empty state, or an inline
failure with its own retry; one slow or failed list never blocks the others. All five
`load`s return `demo-data.js` for now and are marked `DEMO`; wiring a card to its module is
replacing that one function. Only the card's head and list are redrawn, so the directory
search keeps what was typed.

### D51. One notice, one toast, one escape

`components/notice.js`, `components/toast.js`, `components/skeleton.js` and `html.js` replace
the copies in app.js, login.js, home.js and styleguide.js. This also settles the login
notice-spacing fix from session 8: the shell's "did not load" notice had kept the old 12px
gap between title and sentence; every notice now has the login page's 4px.

### D52. AuditLog is append-only in the database too (closes the gap in D36)

Migration `20261011000000_audit_log_append_only` adds `AuditLog_append_only`, an
`INSTEAD OF UPDATE, DELETE` trigger that throws error 51000. It refuses any client, not
only Prisma, and fires even when no row matches. The guard in `lib/prisma.js` stays: it
fails earlier and with a clearer message. Not covered: `TRUNCATE TABLE` and
`DISABLE TRIGGER` need ALTER on the table, so the production login must not be `db_owner`
or `sa`. `tests/audit-trigger.test.js` proves it; each attempt is rolled back with its row.

### D53. The session store writes with single statements, not `upsert`

`PrismaSessionStore.set` runs `updateMany`, then `create` when nothing matched, then
`updateMany` again if the insert lost a race (P2002). Prisma's `upsert` on SQL Server is a
SELECT and a write in one transaction: two saves of the same new session failed with a
unique violation.

### D54. A key Prisma looks up by string is NVARCHAR, starting with Session.sid

Prisma binds every string parameter as NVARCHAR. Against a VARCHAR or CHAR column SQL Server
converts the column and scans instead of seeking. On `Session` that made concurrent first
visits deadlock (found by the Playwright run: six browsers at once, 5 s hangs, HTTP 500).
Migration `20261011010000_session_sid_nvarchar` fixes `sid`. Settled in D57: every key and lookup column
moved to NVARCHAR. Azure SQL has READ_COMMITTED_SNAPSHOT on by default, which hides the
deadlocks there but not the scans.

### D55. One Playwright smoke suite, run instead of ad-hoc browser scripts

`npm run test:e2e` starts its own server on port 3100 (mock sign-in, raised rate limits,
whatever database `.env` names) and runs `tests/e2e/*.spec.js` in Chromium at 1440 and
360 px. `helpers.js` holds sign-in, sign-out, i18n lookup and the checks every screen must
pass; its `test` fails on any console error or page exception. Two errors are allowed by
name: the missing favicon and the 401 from `/api/me` that sends a signed-out visitor to
login. It is not part of `npm test`, which stays browser-free.

### D56. Prisma's install scripts are approved in package.json; the lock file says `mssql`

npm 11 blocks install scripts until approved. `npm approve-scripts prisma @prisma/client
@prisma/engines` wrote a pinned `allowScripts` block to package.json; a Prisma upgrade
needs the command run again. `migration_lock.toml` was hand-written as `sqlserver`; the
engine's name for the provider is `mssql` and migrate refused to run until it was changed.

### D57. All string keys and lookups are NVARCHAR (settles D54)

Ids, foreign keys, codes, emails, domains, `role`, `AuditLog.entity` and `entityId` are
`NVARCHAR`; ids are `nvarchar(36)`, still lowercase UUID strings. Migration
`20261011020000_string_keys_nvarchar` drops foreign keys, unique constraints, indexes and
primary keys around the columns, alters them in place and puts everything back; data is
kept. Execution plans for a lookup by id, by email and by company code are now a clustered
or nonclustered index seek with no implicit conversion. Left as they were because nothing
looks them up: `accentColor`, `phone`, `language`, `action`, `ip`, `channel`,
`templateKey`. A new key or lookup column is NVARCHAR from the start.

### D58. Expired sessions are removed at startup and then hourly

`jobs/prune-sessions.js` calls `PrismaSessionStore.prune()` when the server starts and
every hour after, logs a failure as a warning and carries on. The in-memory store has no
`prune` and is skipped. Tested in `tests/prune-sessions.test.js`. Single instance only:
with several App Service instances each prunes, which is harmless (a delete of rows that
are already gone).

### D59. Production database logins are least-privilege

The app connects with a login that has read, write and execute only (`db_datareader`,
`db_datawriter` and EXECUTE), never `sa`, `db_owner` or anything with ALTER. Migrations
run under a separate admin login, from the deploy pipeline, not from the app's settings.
This is what keeps the AuditLog trigger (D52) from being disabled by the app. Local
development still uses `sa`; production refuses nothing here yet, so it is a deployment
rule. After a Prisma upgrade run `npm approve-scripts prisma @prisma/client @prisma/engines`
again (D56): the approval is pinned to the installed versions.

### D60. The accent rule is stated once more in JavaScript, and pinned to the CSS

The server cannot run `tokens.css`, and the live verdict in the form needs the numbers
too. `frontend/assets/js/accent.js` carries the same arithmetic (black or white label at
luminance 0.179; fill banded 0.26–0.88; ink capped 0.46 light and floored 0.78 dark; edge
capped 0.56, banded 0.56–0.72 dark) and is the only JavaScript statement of it: the browser
and the backend both import that one file. `backend/tests/accent.test.js` reads the
constants out of `tokens.css` and fails if either drifts. **The rule rejects a colour when
the derived label on the fill is under 4.5:1, the accent as text is under 4.5:1 on any of
the four stone grounds in either theme, or the accent as an outline is under 3:1 on the
page and on a card in either theme.** The edge is held to the page and a card only, because
that is all D3 promises for it (against the raised dark steps it is 2.7:1). By
construction every well-formed hex passes (a 4096-colour sweep is a test), so in practice
the rule refuses malformed values and will refuse a colour the day the tokens change.

### D61. Any element may scope a theme (`[data-theme]`)

The company preview needs the light and dark shell side by side whatever the viewer's theme,
re-deriving every brand value from the colour being tried. `tokens.css` therefore applies
its light block to `:root, [data-theme='light'], [data-theme='dark']`, the dark overrides to
`[data-theme='dark']` and the relative-colour derivations to `:root, [data-theme]`. Nothing
changes for `<html>`. The preview is the real CSS arithmetic running on the real tokens, not
a JavaScript imitation. Cost: a scoped element redeclares the whole token set.

### D62. Logos: a storage adapter, an authenticated route, versioned URLs

`lib/storage.js` has `put`, `get`, `remove`. The local adapter writes to `STORAGE_DIR`
(default `<repo>/storage`, gitignored, outside `frontend/` so it is never a static file); an
Azure Blob adapter with the same three methods replaces it. Uploads are PNG, JPEG or WebP by
signature (`lib/image-type.js`), not by name or content type; SVG is refused outright
(markup that can carry script, and no signature). Max 512 KB, enforced by the body parser
and again in the service. The file is stored under a server-made key
`logo-<companyId>-<uuid>.<ext>`; `Company.logoUrl` becomes
`/api/companies/<id>/logo?v=<uuid>`, served to people who may see the company with a
one-year `immutable` cache, which is safe because replacing changes the address. The new
file is written first; the old one is removed only after the database commit, and a new
file is removed again if the commit fails, so a crash leaves at worst an orphan, never a
dangling logo. The login page cannot show an uploaded logo (nobody is signed in): it shows
the company code, as it does for a company with no logo.

### D63. Optimistic concurrency by `updatedAt`, checked in the UPDATE

Edits send the `updatedAt` they loaded. The store applies the change with
`UPDATE … WHERE id = ? AND updatedAt = ?` and treats zero rows as `stale_record` (409), so
two saves cannot both win even between the read and the write. A no-op edit (nothing differs)
writes nothing and no audit row, but a stale one is still refused. The form says "changed by
someone else" and offers Reload; it does not try to merge.

### D64. Several mail domains: `CompanyDomain`, with `Company.domain` kept as the primary

A company may own up to five domains. They live in `CompanyDomain` (unique across
companies, which the database enforces); `Company.domain` stays as the primary (first)
one so existing readers keep working. Migration `20261011030000_company_admin` backfills
one row per company, adds `Department.isActive`, a unique `(companyId, nameAr)`, and
`Company.logoKey`.

### D65. Departments and companies are deactivated, never deleted

There is no delete route for either. A deactivated department keeps its people. A
deactivated company's people are signed out at their next request (`loadUser` already
refuses an inactive company), and it disappears from the login list and the switcher.
Role assignments, which are not business records, are removed outright and audited with
their `before`.

### D66. The admin module runs over a store with a Prisma and an in-memory implementation

`service.js` holds the rules; `store-prisma.js` and `store-memory.js` hold the queries,
as `modules/auth` does with its repos. When the user repo is the in-memory one, the admin
store is too: a test can never reach a real database. A deadlock victim (Prisma `P2034`)
is retried up to six times with jitter; Azure SQL's default snapshot reads make it rarer
than on a local instance. The Prisma store is exercised by `npm run test:e2e`, which runs
against the seeded SQL Server.

### D67. Audit scope for a company admin is the companies they administer

Not the companies they may merely read. A person who is a User of GEN and CompanyAdmin of
TST sees TST's entries and departments, not GEN's. Holding-wide entries (no company) are for
holding admins only. An export or a role change is filed under the one company it concerns.

### D68. Tests and e2e run on their own database, `mgportal_test`

`DATABASE_URL_TEST` names it; absent, it is `DATABASE_URL` with `_test` appended to the
database name. `config/env.js` swaps `DATABASE_URL` for it when `NODE_ENV=test`, and
`playwright.config.js` hands it to the e2e server, so no test can reach the development
data. `config/test-db.js` refuses a name that does not end in `_test` or equals the
development one. `npm test` (pretest) and the e2e web server run
`backend/scripts/prepare-test-db.js`: create if missing, `prisma migrate deploy`, empty every
table (AuditLog's trigger switched off and on again, which is why the name guard exists),
and for e2e seed. Raw SQL is confined to `backend/scripts/db-admin.js` and takes only
checked identifiers.

### D69. `npm run db:reset` drops the development database

Drop, create, migrate, seed. It refuses unless `NODE_ENV` is `development` (the default),
the host is local and the name is not `*_test`. It exists because test and e2e runs used to
leave companies, sessions and audit rows in the development database, and AuditLog cannot
be pruned by hand.

### D70. Announcement status is derived from two dates, never stored

Draft = no `publishAt`; Expired = `expiresAt` has passed; Scheduled = `publishAt` ahead;
otherwise Published (rules in `modules/announcements/rules.js`, mirrored as Prisma
`where`s in the store). Nothing has to run for a scheduled post to appear or an expired one
to leave, and unpublishing is just `publishAt = NULL`: a draft again, with its read rows
kept. A published post is never deleted; only drafts are (D71 below on reads).

### D71. Reads are one row per person and post; "read by X of Y" counts active people

`AnnouncementRead` is unique on (userId, announcementId), written when the detail is
opened and idempotent under two tabs (P2002 is swallowed). Y is the active people of the
audience (the company, or everyone for a holding-wide post); X the active people with a
read row. People deactivated since reading drop out of both. Reads are not audited: they
are not an admin action.

### D72. One Markdown renderer, shared by server and editor; sanitised on save and on render

`frontend/assets/js/markdown.js` has no DOM and is imported by the backend too (as
`accent.js` already is), so the preview an author sees is the server's output. It
escapes every text before placing it in markup and writes only an escaped `href`, `target`
and `rel`. Link addresses are checked against an allowlist anchored at the address as typed
(http(s), mailto, `/path`, `#hash`), with nothing decoded first; anything else becomes its
text. `sanitizeMarkdown` runs on save: tags, comments, control and bidi-override characters
go, so stored text is clean too. No Markdown library: 30 kB budget (CLAUDE.md 6), and the
subset is small.

### D73. Cover alt text is required in each language that has a title

The prompt says alt text is required when an image is set. Requiring both languages even
when a post is written in one would make single-language posts a chore, so the rule is
"every language that has a title", at least one. The cover cannot be saved, or the alt
blanked, otherwise (`cover_alt_required`).

### D74. Editing audience, and who runs what

Readers see their own company plus holding-wide (not the companies they merely administer;
a holding admin reads as a person of HLD). Admins write for the companies they administer;
holding-wide is the holding admin's. A company admin gets 403 on a holding-wide post and
404 on another company's (D67 reasoning). The admin list of a company admin leaves
holding-wide posts out: they are not theirs to run.

### D75. The editor saves in a sequence, so a failure leaves something sensible

Text first (a draft exists from then on), then the cover, then publishing. A cover being
removed goes before the text so its alt text can be cleared in the same save. `expiresAt`
is sent only when changed, so the text of an expired post can still be edited. Times are
entered and shown as Cairo time whatever the device's zone (`format.js` converts).

### D76. The directory is scoped like every other table (superseded by D82)

CLAUDE.md rule 1 puts every read of a company's records behind `lib/scope.js`, and a
person is a record of their company. So a user finds colleagues of their own company (plus
those they administer); a HoldingAdmin finds everyone. The company filter therefore appears
only for someone who can see more than one. A group-wide directory is a product decision
and one function (`companyIdsFor` in the directory service); it was not taken here.

### D77. Search matches a stored, normalised key

Search is word-by-word `contains` over `UserProfile.searchKey`: English and Arabic name,
email and title, folded by `lib/text-search.js` (case, Latin accents, Arabic diacritics,
tatweel, أ إ آ ٱ → ا, ى → ي, ة → ه, Arabic-Indic digits). SQL Server collations cannot do
the Arabic folding, so the key is written by sync and seed and the query is folded the same
way. A scan, not an index: fine for thousands of people. Sorting is done in JS with
`Intl.Collator` over the matching ids so Arabic order and the English-name fallback are right.

### D78. Sync is a plan, then batches; a run is one row and one audit entry

`planSync` is pure (Graph's users + the portal's rows → creates, updates, deactivations,
manager links, warnings), so the mapping is tested without a database. Applying it is
idempotent and goes in batches of 50, not one transaction (thousands of rows would outlive
the transaction timeout); the run's result and its audit entry are the one transaction.
A failed manager lookup keeps the existing link. People with no email, or a duplicate one,
are skipped with a warning.

### D79. Arabic names are portal-owned and may be empty

Graph has no Arabic name, so a person created by sync has an empty `displayNameAr` and sync
never writes it. Every screen shows the English name where Arabic is empty (the other
language beneath only when it exists), and the data-quality report counts the gap. The
column stays NOT NULL (empty string), so existing code that reads it keeps working.

### D80. Two safety stops, and one run at a time

A run that gets no users, or would deactivate more than 20% of the active people, is
recorded as failed and applies nothing; a HoldingAdmin can rerun with an explicit
confirmation. One run at a time: an in-process flag and a `running` SyncRun row less than
30 minutes old (a crash does not block forever). Two instances racing past both checks
in the same instant is possible and harmless: the runs are idempotent.

### D81. Run now answers 202; the page follows

A real run asks Graph for each person's manager and may take minutes, longer than a
request should live. The route returns the run and the work continues; the Sync page asks
for the history every two seconds while the newest run is running.

### D82. The directory is group-wide: the one exception to rule 1

Decided by the product owner in session 15. Every signed-in person can search and open the
active people of **every** company. This is an explicit, deliberate exception to CLAUDE.md
rule 1 (company scoping) and it covers **directory reference data only**: names, job title,
department, company, office, business phone, email, manager and direct reports. It is what
a staff directory is for in a group whose companies share one HQ. Supersedes D76.

The edges of the exception:

- Mobile numbers still follow the **person's** company (`showMobileInDirectory`), whoever
  reads.
- Inactive people stay hidden from everyone.
- Everything that changes or reports on people stays company-scoped: data quality, the CSV
  export, Arabic names (D83) and sync are admin-only, a CompanyAdmin within their own
  companies.
- No other table gains anything from this. Announcements, audit, admin lists and every
  module to come keep going through `lib/scope.js`. Rooms are separately shared (D86).

In code it is `companyIds: null` in `searchPeople`, no `assertCompanyAccess` in
`getPerson`, and every active company in `filters`; `lib/scope.js` is unchanged. A test
proves a Genesis user finds and opens a Masar person and that the reports stay scoped.

### D83. Arabic names: edited by the person's admins, imported by CSV, never by sync

A CompanyAdmin (own companies) or HoldingAdmin sets a person's Arabic display name from
the person panel (`PATCH /api/admin/directory/people/:id`, audited as
`directory.person.arabic_name` with before and after). Because the person is visible to
everyone now, a refusal is 403, not 404. The panel learns whether to offer the form from
`canEditArabicName` on the person, worked out by the server.

Many at once: a CSV of `email, arabicName` on the Data quality page. The upload is
stateless: `preview` and `apply` both take the file and run the same reading, so there is
no server-side draft to expire and what is applied is what the file says at that moment.
The reading sorts rows into changes, unchanged, unknown emails, out of the admin's scope
and invalid (not an email, empty name, over 200 characters, repeated email). **An empty
name never clears one**: a half-filled sheet must not wipe names (clearing is done per
person). Limits: 1 MB, 2,000 rows. Applying is one transaction and writes one audit row
per company touched (`directory.arabic_names.import`) carrying the counts and the old and
new names, so an import can be undone by hand; a file that changes nothing writes nothing.
Semicolon-separated files (Excel in Arabic and European locales) are read too.

Sync never writes `displayNameAr` (D79) and rebuilds the search key from the stored name,
which a test now proves for a name an admin set.

### D84. Why 91 API tests once failed with 403, and what was wrong with the e2e database

The burst (session 14) was `csrf_invalid` on mock sign-in. Cause: the API tests pass
`config.NODE_ENV: 'development'` to reach mock sign-in, and `createApp` chose its session
store from that value, so the tests kept their sessions in the **shared test database**,
not in memory as intended. Anything that emptied `mgportal_test` while they ran (a second
`npm test`, or the start of `npm run test:e2e`) deleted the sessions between "get the CSRF
token" and "sign in". Reproduced on demand by emptying the database mid-run. Fix:
`createApp` also checks the process's own `isTest`, so API tests are in memory whatever
config they pass. Five runs in a row: 199/199 each, before and after.

Looking for it turned up a second fault. `playwright.config.js` handed the e2e server a
ready-made test URL as `DATABASE_URL`; the prepare script then derived its own test name
from that and emptied and seeded `mgportal_test_test`, while the server ran on
`mgportal_test`, which was only ever emptied by `npm test`. E2E data had been piling up
between runs. Now the e2e command sets `USE_TEST_DATABASE=1`; `config/env.js` makes the
switch itself and marks it (`TEST_DATABASE_ACTIVE=1`), and the prepare script uses the
switched URL as it is. `mgportal_test_test` is left on the local server, unused.

### D85. Local databases read by row version, like Azure SQL

With a truly fresh e2e database the first directory sync wrote 38 people while other pages
read them, and SQL Server picked readers as deadlock victims (`/api/auth/mock-users` 500).
Azure SQL has `READ_COMMITTED_SNAPSHOT` on by default and would not; a local Developer
edition has it off. `db-admin.js` now switches it on for the test database (every prepare,
only when off) and for a development database made by `npm run db:reset`. Two writers can
still deadlock, so the sync's batches and the directory store's transactions retry on
Prisma `P2034` (up to four attempts). An existing development database is not altered:
run `npm run db:reset`, or `ALTER DATABASE … SET READ_COMMITTED_SNAPSHOT ON` by hand.

### D86. Rooms are shared reference data; a booking belongs to its organiser's company

HQ's meeting rooms are used by all the companies, so `Room` has no `companyId`: any
signed-in person sees and books a room with no restriction list. A room may instead name
the companies it is for (`RoomCompany`), and then it exists only for those companies' own
people and a HoldingAdmin: not listed, 404 by id, not bookable. The list names companies,
not roles, so a CompanyAdmin of another company gets nothing from it.

Busy times are shared with the rooms, with the organiser's name, because a timetable that
hides who has the room is not usable. That is where sharing stops. A `Booking` carries the
organiser's `companyId` and is a business record like any other (rule 1): its subject,
attendees and detail are for the organiser, the people invited and the administrators of
that company; only the organiser or such an administrator may change or cancel it (anyone
else gets 404, an invited attendee 403); the admin list goes through
`adminCompanyIdsFor`. An administrator acting on someone else's booking is audited.
Like D82, this is a named exception for reference data, not a loosening of the rule.

### D87. Exchange is the source of truth; the portal keeps a reference per occurrence

Whether a room is free is always asked of Exchange (`getSchedule`), never worked out from
Booking rows, so a meeting made in Outlook blocks the room here too and shows as busy
with no organiser. `Booking` is one row per occurrence (a series is the rows sharing
`seriesMasterId`), which makes "cancel this one" and "cancel from here on" simple and
lets a busy time be matched to its row: by event id where the adapter gives one (the
mock), else by room and exact time (Exchange's free/busy carries no ids).

Booking a series: expand every occurrence, check them all against the schedule, and
create nothing if any collides (409 with the dates). Then create the event; the calendar
has the last word, so a collision at that point (two people at once) is the same 409.
If the rows cannot be saved the event is cancelled again. "My bookings" reconciles the
organiser's rows with their calendar: an event gone from Exchange cancels the row
(`cancelledById` NULL), a moved one moves it. If Exchange cannot be asked, the rows are
shown as they are.

Attendees: the event holds the real list. The row keeps `attendeeCount` (seats needed)
and `attendeeIds` (the portal users invited), which is what decides who may read the
subject. Both are references, not a copy of the meeting.

### D88. Booking time is Cairo's clock through the IANA zone

Stored in UTC; every rule is evaluated on `Africa/Cairo` via `Intl` (`lib/time.js`:
`cairoWallToUtc`, `cairoWallOf`). No code knows an offset. A series is expanded day by
day on the Cairo calendar and each day converted on its own, so 10:00 stays 10:00 when
summer time ends (07:00 UTC becomes 08:00 UTC); a test books across 29 October 2026.

Rules (`modules/rooms/rules.js`, pure): quarter-hour start and end, 15 minutes to 8
hours, not in the past, at most 90 days ahead, inside working hours on a working day.
Working hours are per company (`workdayStartMin`, `workdayEndMin`, `workingDays` on
Company; default 08:00 to 18:00, Sunday to Thursday) and the **organiser's** company's
apply, since the rooms belong to no company. A series: daily means every working day,
weekly means chosen weekdays that must be working days and include the first meeting's;
it ends within six months. The 90-day limit applies to the first occurrence only, or a
six-month series could never be booked. Moving a booking applies the same rules.

### D89. Calendar calls: delegated for the organiser, application for everything else

The Graph adapter gained `listRooms`, `getSchedule`, `createEvent`, `updateEvent`,
`cancelEvent` and `listMyEvents`. In the real client, rooms and free/busy use the
application permission; booking is delegated (`/me/events` with the person's token), so
the meeting is theirs in Outlook and Exchange applies the room's own policy. When an
administrator changes someone else's meeting there is no organiser token, and the call
goes to `/users/{organiser}/events` with the application permission. Times go to Graph
as Cairo wall time with `Egypt Standard Time`, and a series as one recurring event in
that zone, so Exchange repeats it by local time too. The portal passes the occurrences
it computed; the real client reads Exchange's own instances back, one per row.

The mock keeps the calendar in `MockCalendarEvent` (an array when the portal runs in
memory) and, like Exchange, refuses a busy room. Adapters throw `GraphError`
(`room_conflict`, `event_not_found`, `delegated_token_missing`) so no module reads a
Graph status. **The real calendar code has never run against a tenant** and nothing yet
hands it a person's token (`req.getGraphToken`): both are session 19. Until then
`GRAPH_MODE=real` answers 503 `calendar_unavailable` on booking.

### D90. Rooms is one page with a view per address; a room opens in a panel

`#rooms` (find a room, also `#rooms/new`), `#rooms/day`, `#rooms/mine` and `#rooms/<id>`
(the room's panel over "find"). The views are modules in `pages/rooms/` sharing one
environment (rooms, the company's working hours) cached for five minutes, and a small bus
(`notifyChanged` / `onChanged`) so a booking made in one place redraws the others. The panel
is a drawer like the directory's, with its own address so it can be shared. A room with no
photo says so; nothing stands in for one.

### D91. Booking is two taps, and never silent

"Book" on a free room opens the booking dialog filled with the searched room, day, time and
people; the subject is pre-filled ("Meeting") and selected, so Confirm alone books. The time
and room stay folded under one line ("Change"). A tap that makes a real calendar event on a
weak connection must be one the person can see before it happens, so there is no one-tap
booking. Whatever is booked is what was searched for, not what the form says by then. A room
taken meanwhile lists the conflicting times and offers "Find another room for this time".

### D92. The day view is one dataset drawn twice, chosen by container width

A timetable (row per room, working hours as columns) from 48rem of page width, and a card
per room with its free stretches as buttons below that. The axis is positioned with inline
insets and sizes only, so Arabic is the same layout read from the other side. The free
stretches are the buttons (few tab stops, each named "Book room, free from … to …"); a press
inside a long stretch starts where it landed, on the half hour.

### D93. API: working hours with the room list, series id on a booking

`GET /api/rooms` also returns the reader's company's `hours`, so the page needs one request
and no calendar call to know what can be booked. A booking view carries `seriesId` (empty
where the reader may not see the subject), so My bookings folds a series into one entry
(its next meeting, how it repeats, how many more) and cancels "this one" or "this and all
later" through the existing cancel route.

### D94. The cold start and the e2e suite: warm the database, cap the workers

The full e2e suite failed at random (5 to 29 tests, mostly at sign-in). Stopping the dev
servers did not cure it. Measured, in order: (1) the port opened 0.3 s after start but the
first query took 1.3 s (Prisma's engine, then each pooled connection's handshake with SQL
Server, about 0.8 s apiece), so the first people after a start all waited; (2) with that
fixed, a suite run still added 72 s of `PAGEIOLATCH_SH`, 85 s of memory waits, 16 s queued
for query compiles and 494 worker-thread waits to SQL Server: Playwright's default of six
workers (half of twelve cores) squeezes the one SQL Server for memory and disk, and plain
single-row statements take seconds. No deadlock and no blocking chain was recorded during
those runs, and a probe on a connection of its own stayed fast, so the app is not holding
locks.

Fixes: `warmPrisma` connects and opens eight pooled connections before `listen`, so
"listening" and `/api/health` mean ready (also right for an App Service cold start);
`getPrisma` keeps the promise, so concurrent first requests share one client instead of
each making one; `playwright.config.js` runs three workers (`E2E_WORKERS` overrides) and
gives every expectation 10 s. If a later machine or CI is roomier, raise the workers there.

### D95. An administrator who cancels someone's booking says why

`POST /api/bookings/:id/cancel` takes an optional `reason` (500 characters). When the
canceller is not the organiser it is required (400 `reason_required`). It is stored on the
booking (`Booking.cancelReason`, migration `20261011070000_booking_cancel_reason`), returned
to anyone who may read the subject, and written into the `booking.admin.cancel` audit entry.
The organiser's own cancel stays unaudited and may carry a reason or not. Notifications
(next) will send it to the organiser.

### D96. Rooms and bookings in Company admin

`#admin/rooms` (holding admin): list, add from an Exchange room mailbox the portal does not
use yet, edit, photo (saved when chosen, like a logo), and "in use" instead of delete.
`#admin/bookings` (holding and company admins): every booking of their companies by room,
company, dates and status, with cancel. The mock Graph lists four spare room mailboxes so
"add a room" can be built and tested without a tenant. Audit actions that are also the stem
of another (`directory.sync` beside `directory.sync.failed`) keep their label under `_`.

### D97. Day view: a booking always says its time in words

Position on the axis is not enough to read a time from, least of all for a quarter hour. Every
block is a button whose text starts with the range ("10:30–10:45"), then "Busy · organiser" or,
for the reader's own, the subject. Each block is a size container: under 4.75rem the range turns
on its side and stands alone (forced top-to-bottom, start first, in Arabic too) and the rest is
in a panel that opens on hover, keyboard focus or a tap (range, length, subject or organiser,
room). The accessible name carries room, status, range and organiser. The grid has a label every
hour and a lighter line every quarter; "now" is a line with its time on the axis. A free stretch
shows the quarter hour under the pointer ("10:45–11:00, free") and books from there, so presses
now snap to 15 minutes, not 30. A range is plain text with no direction of its own: in Arabic
the two times are laid out start-first from the right. The phone list shows booked times too.

### D98. A time range reads left to right in Arabic too

Replaces the last point of D97. "10:30–10:45" is drawn start on the left in both languages:
Arabic readers of a 24-hour Latin-digit clock read the pair as one left-to-right token, and a
mirrored "10:45–10:30" was read as the wrong meeting. One place writes a range, `format.js`:
`rangeHtml` (`<bdi dir="ltr">`) for markup (day blocks, panel, phone list) and `rangeOf` /
`formatTimeRange` (wrapped in the Unicode isolates U+2066/U+2069) for text that passes through
translation strings, `textContent` and accessible names (find summary, booking dialog, my
bookings, admin bookings, Home card, conflicts). The sideways range in a narrow block runs top
to bottom, start first. `rooms.spec.js` measures where the two times sit on screen.

### D99. Helpdesk tickets: an explicit exception to company scoping (rule 1), for agents only

The ticket system is an IT helpdesk. One holding IT team serves every company from one
queue, so its members read and work tickets of companies they do not belong to. That
breaks CLAUDE.md rule 1 on purpose, and only here:

- `Ticket.companyId` is the requester's company and is kept for reporting. It does not
  decide who reads the ticket, and ticket queries do not go through `scopeWhere`.
- A ticket is read by its requester (whoever logged it), by the members of its support
  team for the companies that team serves (`servesAllCompanies`, or its
  `SupportTeamCompany` list), and by a HoldingAdmin. The rule lives in one place,
  `modules/tickets/rules.js` (`staffRoleOn`), and every route starts from `loadTicket` or
  from a filter carrying the viewer's id or team scopes.
- It is narrower than company scope for everyone else: a user never sees a colleague's
  ticket, and a CompanyAdmin who is not on the team sees none, their own company's included.
- Out of reach is always 404. `counts.queue` is `null` for non-staff, search runs inside
  the caller's own set, and an attachment address is checked against its ticket.
- Membership is read on every request, so someone taken off the team loses the queue at once.

The permission matrix is tested in `tickets.test.js` ("who can see a ticket"). Nothing
else may use this exception.

### D100. Teams are configuration; only IT is seeded

`SupportTeam` (code, names, the companies it serves), `SupportTeamMember` (Agent or Lead),
and per team its categories, SLA targets, working calendar and canned replies. Another
department's helpdesk is a new team made in the admin API with no code change (the test
makes "HR"). Locations and public holidays are group-wide. Model names carry a `Support`
or `Ticket` prefix because `Team`, `Category` and `Location` alone would not say whose
they are. A category belongs to one team, so choosing a category chooses the team.

Seeded: team `IT` "IT Support" serving all companies; Omar Fahmy as Lead; two agents,
Sherif Awad and Tamer Gad, added to the seed users (now fourteen) because only two IT
people were seeded. Both already exist in the mocked Graph, so they carry the ids it gives
them (`entraObjectId` in seed-data.js) and sit last in `USERS` to leave the first twelve
ids as they were. The seeded holidays are examples: the fixed dates are right, the Islamic
ones are estimates and are named so.

### D101. Who may do what on a ticket

The brief said both "assign (self or other agent)" and "Leads can also reassign", and
"Leads … edit categories" beside agents changing a ticket's category. Read as:

- An agent may assign a ticket that is unassigned or their own (take it, hand it on, give
  it back). Taking one from a colleague is the Lead's (or a HoldingAdmin's): `lead_only`.
- Any agent may change a ticket's status, priority and category. A Lead may also manage
  the team's category list and its canned replies, both audited.
- A requester's ticket starts at the urgency they choose (D106), or its category's default.
  Only the team sets a source or another requester (logging a call or a walk-in), and only
  the team changes the priority afterwards.
- A HoldingAdmin acts as a Lead on every team but can be assigned a ticket only as a member.
- Assigning a New ticket makes it Open, as an agent's first public reply does.
- A requester's reply to a Resolved ticket reopens it. That is what "closes after three
  working days without a requester reply" needs, and it is inside the seven-day window.
- The seven days are calendar days from `resolvedAt`; the three working days are
  three full days of the team's business hours.

### D102. Ticket numbers come from a counter row, not from counting tickets

`TicketSequence (prefix, year, last)`. The create transaction first runs
`UPDATE … SET last = last + 1` on its row, then reads it back. The update holds the row's
lock until the transaction ends, so concurrent creates queue on it and each reads its own
number; a failed create rolls its number back, so there are no gaps. The row for a new
year is made before the transaction (a lost race on that insert is ignored). `Ticket.number`
is unique as a backstop. The year is the one on the team's calendar zone, so 00:30 on
1 January in Cairo is already the new year. Proven with forty concurrent creates on SQL
Server (`tickets-store.test.js`).

### D103. SLA: business minutes, pauses as a number, three derived columns

`lib/sla.js` takes a calendar (IANA zone, weekdays, opening minutes) and the holidays and
answers "this many business minutes after that instant" by asking the zone for each day's
opening and closing instants. No offset is stored or assumed; the DST tests cross both of
Egypt's changes.

A pause is not a second clock. The ticket keeps `slaPausedMinutes` (business minutes it
stood still) and `slaPausedAt` (when the current pause began). A due date is always
"target plus paused minutes, from creation", which equals stopping and restarting. The
clock runs in New and Open. Leaving WaitingOnRequester, or reopening, adds the business
minutes of the pause. Closing an already Resolved ticket changes nothing, so its met or
missed result cannot be rewritten by the auto-close.

`nextDueAt`, `nextRiskAt` and `slaActive` are stored so the queue filters by SLA state and
sorts by nearest due date in SQL. "At risk" is 75% of the target in force.

Dates are worked out again from the team's current targets whenever a ticket's status,
priority or first response changes. So an admin's change to targets, hours or holidays
reaches an open ticket at its next such change, not at once. Recalculating every open
ticket on a settings change was left out; say if it is wanted.

### D104. Attachments: one file per request, checked by signature against extension

No multipart parser was added. A file is the raw body of
`POST /api/tickets/:id/attachments?name=`, like a logo or a room photo. `lib/file-type.js`
accepts a file only when its extension is on the allow-list and its bytes are what that
extension should be. A newer Office file is a zip, so a zip passes only when it holds
`[Content_Types].xml` and the folder its extension names; plain text must decode and hold
no control bytes. Downloads are always `Content-Disposition: attachment` under
`default-src 'none'; sandbox`. The files sent with the description count as one comment
(five). Not checked: macros inside Office files, and no virus scan.

### D105. Home and the nav show the helpdesk's real numbers

Home's "open" and "waiting on you" cards read `GET /api/tickets/mine`. The number beside
Tickets is the person's own active tickets, or for helpdesk staff the unassigned tickets
in their queue, with the breaching-soon count in its accessible name. The demo tickets
are gone from `demo-data.js`; the bell's sample notification stays until notifications
exist. A ticket links to `#tickets/<id>`, which the next session builds.

### D106. The requester chooses the urgency; the category default only preselects it

Before, `priority` on `POST /api/tickets` was for the team and a requester always got the
category's default. A requester knows best how much it hurts, and the helpdesk can still
correct it, so: any requester may send `priority` (P1..P4); left out, the category's default
applies, and the form preselects that default. The due dates follow the chosen priority. A
later change is the team's (D101), recorded as a `priority` event with from/to like any other.
Cost accepted: people may pick Urgent for everything; the queue's history shows the change
when IT corrects it, and Leads can see the pattern. Requesters see the four levels in plain
language ("Urgent", "High", "Normal", "Low" with an example); P1..P4 stay in IT views.

### D107. One Tickets page; IT's views are courtesy links, the API is the lock

`#tickets` is one page module with a view per address (new, my tickets, one ticket, queue,
settings). Whether someone is on a support team comes from `GET /api/tickets/counts`
(`queue` is null for everyone else); that and the reader's role in `queue/options` decide
which links appear. A non-IT person who types `#tickets/queue` sees "no access", and the
queue API answers them 403 regardless (tested). Requesters read plain words (Urgent / High /
Normal / Low, "Reply expected by"); P1..P4, "SLA clock" and "breached" are written only by
functions that are given `staff` (`pages/tickets/shared.js`).

### D108. Files go after the ticket, with progress; a pasted screenshot is a file

The API cannot take a file before the ticket exists, so the new-ticket form creates the ticket
and then sends each file in turn with its own progress bar (`api.upload`, XMLHttpRequest,
because fetch has no upload progress). A file that fails does not undo the ticket: the
confirmation says how many did not go and the ticket's reply box takes them again. Type and
size are checked in the browser against `GET /api/tickets/options` first (the server still
decides). Ctrl+V of an image anywhere in the form or the reply box becomes a file named
"Screenshot <date time>.png".

### D109. A canned reply is inserted in the requester's language

The ticket in full now carries `requesterLanguage` (`en`/`ar`) for the team only, from
the requester's profile. "Insert reply" puts that language's text in the box (the other
language when one is empty) and the agent edits it before sending. The select shows titles
in the agent's own language. Nothing is sent without a click.

### D110. Smaller choices in the helpdesk screens

- **Internal notes** are drawn apart on three signals (dashed warm edge, a lock and the words
  "Internal note", and the whole reply box turns that way before the first keystroke), because
  sending one by mistake is the module's one costly error. The requester's API response does
  not contain them at all.
- **"Closed" in My tickets** reads Resolved and Closed as two requests and merges them by
  update time; the API filters one status at a time and a person has few of these.
- **Bulk assign** is one PATCH per ticket, so the server's own rule (an agent may not take a
  colleague's ticket, D101) answers for each; the toast says how many went.
- **Configuration** is one module (`tickets/config.js`) mounted at `#admin/helpdesk`
  (HoldingAdmin: team, categories, locations, targets and hours, holidays, canned replies) and
  at `#tickets/settings` (a Lead: categories and canned replies of their team).
  SLA targets are typed in working hours and sent as minutes.
- **Home** shows IT an extra card (unassigned, mine, at risk, breached, each a link into the
  queue). At risk and breached are two requests for `pageSize=1`, because the counts route's
  "breaching soon" includes the breached ones and would not match the list it links to.

### D111. Sign-out can never fail; only sign-in attempts are rate-limited

Cause of "try again later": the auth limiter counted every request under `/api/auth`, logout
included (20 per 15 min, so about 10 sign-in/out cycles), and logout also answered 403 on a
stale CSRF token. Now (supersedes D45's list): only `POST /api/auth/mock-login`,
`GET /auth/login` and `GET /auth/callback` count. In development with AUTH_MODE=mock the
limit is at least 1000 (`authLimitFor`); every other environment uses AUTH_RATE_LIMIT_MAX.
Logout skips the CSRF check, swallows a failing session store and always clears the cookie;
the frontend `signOut()` goes to the login page whatever the request returned, so the
`nav.signOutFailed` string is gone.

### D112. One notifier, called after the change, that cannot fail the change

`lib/notify.js` is `notify(userIds, templateKey, data)`. Services call it **after** their
transaction commits, and it never throws for a delivery problem (a down mail server, a bad
address): the ticket, booking or post has already happened and must not roll back or answer 500
because an email did not go. Failures are logged. An email that failed leaves no row, so a keyed
alert is simply tried again at the next run; an unknown template key is a bug and does throw.
The person who did the thing is never told of it. Services take `notify` as a dependency (a
silent one by default), so a service built without it behaves as before.

### D113. A notification is a template key and variables; the words are in the i18n files

The row stores `templateKey` and a JSON payload `{ link, vars }`, never a sentence, so it is
written in the language of whoever reads it, and an English notification written yesterday reads
in Arabic today. The strings live in `assets/i18n` under `notification.tpl.<key>` (CLAUDE.md
rule 2), and the backend reads the same two files (`lib/messages.js`) to write the email, so no
sentence exists in two places. `notification-text.js` is the shared module, in the same way as
`markdown.js` and `accent.js`: it imports nothing, so the backend loads it too. Names and
room names go in as `{ en, ar }` pairs resolved when read. A test checks every template has both
languages with the same placeholders.

### D114. Channels, switches and what is left for later

Two channels: in the portal and email. A person has one switch per category (tickets, bookings,
announcements) and channel; a switch never saved is **on**, so a new person hears everything and
a new category needs no migration. Switching a category off in the portal is allowed: it is
their bell. Teams is only the Graph adapter's `sendActivityNotification`, stubbed in both
clients and not offered in the preferences until the Teams app exists. There is no per-template
switch and no quiet hours yet. Email comes from `NOREPLY_MAILBOX` (the real client needs
`Mail.Send` on it; unproven until the tenant is reachable, session 19).

### D115. SLA alerts: keyed, once per threshold, breach wins

`jobs/slaWatch.js` runs the ticket service's `watchSla` at startup and every five minutes. It
reads the tickets whose running clock is past `nextRiskAt` (an indexed filter the queue already
uses). The key is `sla:<ticket>:<firstResponse|resolution>:<75|100>`, per person and channel, so
a ticket is warned once per phase and threshold, and a priority change that moves the dates does
not warn twice. A ticket already past its target gets the breach alert only, never the 75% one
on top. Recipients: the assignee and the team's leads; the leads alone while unassigned. A paused
or resolved ticket (clock stopped) is never alerted. The job does not run on top of itself.

### D116. Pinned announcements: told at the moment they are live, once

Pinned-and-live is a moment, reached three ways (publish now, pinning something already live,
or a schedule arriving), so `tellPinned` is idempotent (key `announcement:<id>`) and called
from publish and update; `jobs/pinnedAnnouncements.js` covers the schedule every five minutes.
Only posts that went live in the last two days are announced, so deploying this does not tell
everyone about every old pin, and a late edit of an old pinned post stays silent.

### D117. The bell polls the count only; the mocked mail is a folder

The shell asks `GET /api/notifications/unread-count` once a minute, only while the tab is
visible (a phone in a pocket does not poll), and fetches the six latest when the bell is opened.
Following a notification marks it read. In development the mocked Graph writes each message as a
JSON file under `backend/mock/outbox/` (gitignored, the latest 200 kept) and `#dev` lists them
in sandboxed frames; under test it keeps them in an array (`app.locals.mailOutbox`), so a run
leaves nothing on disk. `/api/dev/*` is not mounted in production.
