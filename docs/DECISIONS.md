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
