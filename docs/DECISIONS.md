# Decisions

Durable choices and the reasoning behind them. Newest session last.

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
