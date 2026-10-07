---
name: MG Holding Employee Portal
description: An internal portal where every record is a labelled specimen, in English and Arabic, under any company's colour.
colors:
  brand-accent: "#b4552d"
  brand-accent-ink: "oklch(from var(--brand-accent) clamp(0.2, min(l, 0.46), 1) c h)"
  brand-accent-edge: "oklch(from var(--brand-accent) min(l, 0.56) c h)"
  stone-0: "#ffffff"
  stone-50: "#fbf8f5"
  stone-100: "#f3efea"
  stone-150: "#eae5e0"
  stone-200: "#e0dad4"
  stone-300: "#cfc9c2"
  stone-500: "#857f78"
  stone-600: "#68635d"
  stone-800: "#312d29"
  stone-900: "#1f1c18"
  success-ink: "#076b29"
  warning-ink: "#7a4b00"
  danger-ink: "#a04038"
  info-ink: "#0b67a9"
typography:
  display:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "1.5625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
    fontFeature: "tabular-nums lining-nums"
  label:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.07em"
rounded:
  sm: "3px"
  md: "6px"
  lg: "10px"
  pill: "999px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.25rem"
  "6": "1.5rem"
  "8": "2rem"
  "12": "3rem"
  "16": "4rem"
components:
  button-primary:
    backgroundColor: "{colors.brand-accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "2.375rem"
  button-primary-hover:
    backgroundColor: "{colors.brand-accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.stone-0}"
    textColor: "{colors.stone-900}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "2.375rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.stone-800}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
  card:
    backgroundColor: "{colors.stone-0}"
    textColor: "{colors.stone-800}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  input:
    backgroundColor: "{colors.stone-0}"
    textColor: "{colors.stone-900}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
    height: "2.375rem"
  badge:
    backgroundColor: "{colors.stone-100}"
    textColor: "{colors.stone-800}"
    rounded: "{rounded.sm}"
    padding: "0.25rem 0.5rem"
    height: "1.5rem"
  label-strip-key:
    textColor: "{colors.stone-600}"
    typography: "{typography.label}"
  label-strip-value:
    textColor: "{colors.stone-900}"
    typography: "{typography.title}"
---

# Design System: MG Holding Employee Portal

## Overview

**Creative North Star: "The Assay Card"**

A mine assays its ore and writes the result on a card: what the sample is, where it came from, what it measured, and who signed for it. Nothing on that card is decoration. This portal is built the same way. Every record it holds — a support ticket, a meeting room, a colleague, an announcement — opens with the same ruled strip of labelled values, carries its body beneath, and closes with a provenance line naming who last touched it. A ticket and a room are different things, but they are *read* the same way, so one reading habit covers the whole product.

The surface is warm stone paper rather than the cold grey of every other internal portal. That is a working decision, not a mood: site staff at Abu Tartur read this on an Android phone in direct sun, where a warm low-chroma ground holds its contrast better than a blue-white one and glares less. Structure is carried by a one-pixel hairline on a strict four-pixel pitch. No shadow does structural work; a card's edge is a rule, and only things that genuinely float — a dialog, a toast — are allowed to cast anything.

The shell is deliberately anonymous, because the identity belongs to the company, not to us. A Company record supplies exactly one value, its accent colour, and every brand value in the system is derived from it with contrast guaranteed by arithmetic rather than by taste. Adding the fourth or fifth company to the group is configuration. The anti-reference is the generic SaaS admin console: cold greys, a default blue, soft nested cards, and an accent that was picked to look good in the marketing screenshot rather than to survive being swapped.

**Key Characteristics:**

- Every record is a labelled specimen: identity, measured values, provenance.
- Warm stone neutrals, tuned for a phone screen in bright sun.
- One 4px pitch; the 1px hairline is the only structural separator.
- One runtime accent, every other brand value derived from it and AA-safe for any hue.
- Arabic and English designed together, with identical weight coverage and their own leading.
- State is always encoded twice, so nothing depends on colour alone.

## Colors

A warm, low-chroma stone scale carrying a single company accent that is never assumed.

### Primary

- **Iron Oxide** (`#b4552d`): the neutral shell's default accent, standing in when no company is loaded. It is a placeholder for a runtime value, not a brand colour. Every real screen takes its accent from the Company record.
- **Accent Ink** (`oklch(from var(--brand-accent) clamp(0.2, min(l, 0.46), 1) c h)`): the accent as text, icon, link and focus ring on a neutral ground. Lightness is capped at 0.46 in light and floored at 0.78 in dark, which clears 4.5:1 for every hue and chroma.
- **Accent Edge** (`oklch(from var(--brand-accent) min(l, 0.56) c h)`): the accent as a hairline — the keyline around a filled control and the ring that appears on hover. Clamped to clear 3:1 against both the page and a card.

### Neutral

- **Paper** (`#fbf8f5`, `--surface-ground`): the page. Warm, barely tinted, OKLCH hue 74.
- **Card** (`#ffffff`, `--surface-raised`): a card, an input, a dialog.
- **Well** (`#f3efea`, `--surface-sunken`): a table head, a read-only field, a skeleton.
- **Hairline** (`#e0dad4`, `--rule`): the structural separator. The single most-used value in the system.
- **Strong Rule** (`#cfc9c2`, `--rule-strong`): an input's edge, a table's outer frame.
- **Graphite** (`#1f1c18`, `--text-strong`): headings and values. 16:1 on paper.
- **Body Ink** (`#312d29`, `--text-body`): running text.
- **Muted Ink** (`#68635d`, `--text-muted`): secondary text, help, and every placeholder. 5.6:1 on paper.
- **Disabled** (`#857f78`, `--text-disabled`): disabled text only, which WCAG exempts. Never used for live text.

Dark theme inverts the same ramp into warm graphite (`#110f0d` ground, `#191714` card) rather than true black, which smears on the cheap LCDs site staff carry.

### State

- **Success** (`#076b29`), **Warning** (`#7a4b00`), **Danger** (`#a04038`), **Info** (`#0b67a9`). Each ships three roles: an ink for text, a tinted surface, and a hairline edge. Every ink clears 4.5:1 on both a card and its own surface, in both themes.

### Named Rules

**The Derived Accent Rule.** A company supplies one value, `--brand-accent`, and nothing else. Fill, hover, active, on-colour, ink, edge and both washes are computed from it in `tokens.css`. Never hand-author a second brand colour, and never write a literal accent value into a component.

**The Luminance Flip Rule.** Whether a label on an accent fill is black or white is decided on WCAG relative luminance, not on OKLCH lightness — a saturated red sits at L 0.52 but has Y 0.13, so a lightness threshold picks black and fails. The threshold is Y 0.179, where the guarantees for black and white overlap.

**The Outward Press Rule.** Hover and active mix the fill *away* from its label colour, so a dark fill darkens and a light fill lightens. The label's contrast can therefore only improve as a control is pressed. Moving the other way would break it.

## Typography

**Display / Body / Label Font:** IBM Plex Sans (Latin) with IBM Plex Sans Arabic, self-hosted, SIL Open Font License 1.1.
**Mono:** none. Monospace appears only in the styleguide, to set CSS token names, which are code.

**Character:** Plex is a drafted, slightly mechanical humanist — an engineering face rather than a startup one, which suits a group that runs phosphate mines and builds railways. Its Arabic companion was drawn alongside the Latin, so the two scripts share proportions and colour on the page instead of looking bolted together.

Two weights only, 400 and 600, so Arabic and Latin have identical coverage and neither script is the poor relation. The Latin ships as one variable file per subset; Google serves the Arabic as static instances, so it ships as two. Worst case over 3G is 46 kB for an English reader and 89 kB for an Arabic one.

### Hierarchy

- **Display** (600, 2.25rem, 1.2, -0.02em): the one display size. Page title on a desktop masthead.
- **Headline** (600, 1.5625–1.875rem, 1.2): a page heading.
- **Title** (600, 1.125rem, 1.35): a card title, a dialog title.
- **Body** (400, 1rem, 1.55): running text, capped at 68ch (60ch in Arabic).
- **Label** (600, 0.6875rem, 1.35, 0.07em, uppercase): the micro-label above a value, a table head, a badge.

### Named Rules

**The Tabular Numerals Rule.** `font-variant-numeric: tabular-nums lining-nums` is set on `body` and inherited everywhere. In a portal where almost every screen is a label strip, a ticket number or a time, proportional digits make columns wobble between rows. The Arabic subset deliberately excludes U+0030–0039, so every digit in both languages is set by the Latin face and lines up identically.

**The Arabic Equal Standing Rule.** Arabic is designed for, not mirrored. It takes its own leading (1.75 against 1.55) and its own measure (60ch against 68ch), because Plex Arabic's ascenders and descenders collide at Latin line heights. It never takes uppercase, which it does not have, and never takes letter-spacing, which breaks its cursive joins — so the micro-label's small-caps treatment is **replaced** for Arabic by weight and colour at a slightly larger size, rather than applied and broken.

**The Tracking Floor.** Negative tracking stops at -0.02em. Positive tracking exists only for Latin micro-labels and is zeroed in Arabic.

## Layout

The shell is a company rail, a top bar and one work area. Below 48rem the rail becomes a thumb-reachable bottom nav, because site staff hold the phone one-handed with the other hand on a ladder; every nav target is at least 44px and the bar clears the home-gesture safe area.

Spacing runs on **one 4px pitch**, `--space-1` (4px) through `--space-24` (96px). `--space-px` is the hairline and is the only sub-pitch value in the system. Grids reflow by whole cells (`repeat(auto-fit, minmax(...))`), never by squeezing one.

Breakpoints: 30rem (button rows become horizontal), 40rem (tables stop being tables), 48rem (rail replaces bottom nav; desktop density), 64rem (work area splits; styleguide gains its contents column).

Density is two-speed. Anything tappable is 44px on a phone and relaxes to 38px on a pointer device, where HQ admins want rows on screen rather than thumb room. That is the one place the system deliberately differs between the two audiences.

**The Logical Properties Rule.** `margin-inline`, `padding-block`, `inset-inline-end`, `text-align: start`. Never `left` or `right`. The whole shell mirrors from `<html dir>` with no component-level overrides. The three exceptions — the select chevron's background position, the active nav rule's inset shadow, and `.icon--dir` — are marked in the source, because those properties have no logical form.

## Elevation & Depth

**Flat by default.** Depth is tonal and linear, not atmospheric. A card, an input, a table and a tab all get their edge from a 1px hairline against a tonal surface step (`ground` → `raised` → `sunken`). Shadows are reserved for layers that genuinely float above the page in the z-index sense: a dialog, a toast, a popover, and the switch knob.

### Shadow Vocabulary

- **`--shadow-1`** (`0 1px 2px rgb(31 28 24 / 0.07), 0 4px 12px rgb(31 28 24 / 0.09)`): a popover, the switch knob, the focused skip link.
- **`--shadow-2`** (`0 2px 4px rgb(31 28 24 / 0.08), 0 16px 40px rgb(31 28 24 / 0.14)`): a dialog, a toast.

Shadow colour is the warm ink, never pure black. In dark theme both tokens deepen and widen, because a soft shadow reads as almost nothing on a dark ground.

### Named Rules

**The Declare Once Rule.** An element gets a border or a shadow, never both. A 1px border under a wide soft shadow is the ghost card.

**The No Structural Shadow Rule.** No shadow may carry structure. If a boundary matters, it is a hairline.

## Shapes

Crisp, not soft. The world is a die-cut paper label, so corners are tight: 3px on a badge or a swatch, 6px on an input, button or tab, 10px on a card or dialog, and a pill only on small controls (the switch, the avatar). This is a deliberate departure from the 12–16px card radius that reads as the current default; at 16px a label card stops looking measured and starts looking like a consumer app.

Borders come in exactly three weights: `--border-1` (1px, the hairline, used for essentially everything), `--border-2` (2px, focus rings and the active-tab rule), and `--border-3` (3px, a toast's state edge and the scrollbar's transparent inset).

Dashed hairlines mark something that is *absent or awaited* rather than present: the file-upload drop zone and the empty state.

## Components

The character throughout is **precise and quiet**: everything is a labelled field on a ruled card, and nothing moves unless it has something to say.

### Label strip (signature)

The recurring furniture, and the reason the system holds together.

- **Structure:** a `<dl>` of key/value pairs in a wrapping row, divided by vertical hairlines, closed by a horizontal hairline. The key is a micro-label; the value is 600 weight in tabular numerals.
- **Content:** it always carries the record's real fields — ticket number, queue, priority, SLA due, company, capacity, floor, published date. It is never decorative and never filled with labels restating the body. A record with nothing real to put in a strip does not get one.
- **The authored moment:** on hover or focus-within, the strip *registers* — its closing rule takes the accent and strikes in from the centre over 280ms, and the values lift one pixel. Centre-out rather than directional, so it reads identically in Arabic. This is the only authored motion in the system.
- **Closing:** a `.provenance` line beneath, hairline-topped, naming who last changed the record and when, in Cairo time.

### Buttons

- **Shape:** 6px (`--radius-md`), 44px tall on a phone and 38px on a pointer device.
- **Primary:** the accent fill with a derived keyline in `--brand-accent-edge` and a label in `--brand-accent-on`. The keyline is what gives a pale company accent a readable boundary.
- **Hover / Focus:** the fill mixes 16% toward its shade and a 3px ring in the accent wash appears; active mixes 28% and drops the ring. Focus is a 2px outline in the accent ink, offset 2px so it is drawn on the page rather than on the control.
- **Secondary:** a hairline on the raised surface; on hover the edge takes the accent.
- **Ghost:** no chrome until touched.
- **Danger:** a danger-edged outline on the raised surface, not a red fill. A destructive action should be legible, not loud.
- **Loading:** `aria-busy` dims the label to 55% and shows a spinner; the label keeps its place and its width, so the control does not jump and the visitor can still read what they pressed.

### Badges

- **Style:** a 24px chip, 3px corners, a tinted state surface with its own hairline and ink.
- **State:** colour **plus** a drawn icon with its own silhouette per status — a ring for open, a clock for in progress, a bar for waiting, a tick for resolved, a triangle for overdue. The status survives greyscale, bright sun, and anyone who cannot separate the hues.

### Cards / Containers

- **Corner:** 10px. **Background:** `--surface-raised`. **Border:** 1px `--rule`. **Shadow:** none.
- **Padding:** 16px on a phone, 20px on a desktop.
- **Never nested.** The stylesheet enforces it: `.card .card` loses its padding, background, border and radius, so a nesting mistake degrades to a plain block instead of rendering a card in a card.

### Inputs / Fields

- **Style:** 1px `--rule-strong` on the raised surface, 6px corners, 44px tall on a phone.
- **Focus:** the border takes `--brand-accent-edge` and the shared 2px offset outline appears.
- **Invalid:** `aria-invalid="true"` turns the hairline to the danger ink and tints the ground, and the message below carries an icon. The ARIA state is the styling hook, so the visual and the announced state cannot drift apart.
- **Read-only** takes the sunken surface and keeps full-contrast text; **disabled** takes the disabled surface and the exempt disabled ink. The two must not look alike.
- **Fields** always have a visible label, help text that stays visible while an error is showing, and "required" spelled out rather than marked with an asterisk.
- **Date and time** use the native controls, restyled: they are what a site worker already knows, they need no JavaScript, and on Android they open the platform's own picker. `color-scheme` on `:root` is what makes the picker panel follow the theme.

### Navigation

- **Rail** (≥48rem): the company mark over the four jobs, then an admin section. The current page is marked three ways — accent wash, a 2px rule on its inline-start edge, and the bold weight.
- **Bottom nav** (<48rem): five thumb-reachable cells, each ≥44px, the active one carrying accent ink, bold weight and a rule across the top of its cell.
- **Tabs:** the active tab takes a 2px accent rule on its block-end edge plus bold weight. The strip scrolls rather than wrapping. Arrow keys move between tabs and follow reading direction, so the "next" arrow is the left one in Arabic.

### Tables

Below 40rem every row becomes a label card and each cell takes its column name as a micro-label from `data-label`, which is the label strip applied to tabular data. The markup carries explicit ARIA roles, because changing `display` on a table removes its semantics from the accessibility tree.

## Do's and Don'ts

### Do:

- **Do** open every record with a label strip carrying its real fields, and close it with a provenance line.
- **Do** derive every brand value from `--brand-accent`. One company, one supplied colour.
- **Do** keep every spacing value a multiple of 4px, and make every separator a 1px hairline.
- **Do** encode state twice — colour plus an icon, a fill, or a rule — so it survives greyscale and direct sun.
- **Do** give anything tappable 44px on a phone.
- **Do** use CSS logical properties exclusively, and mark the rare exception in the source with its reason.
- **Do** give Arabic its own leading and measure, and replace the micro-label's small-caps treatment rather than applying it.
- **Do** set every number in tabular lining numerals.

### Don't:

- **Don't** nest a card inside a card.
- **Don't** let a shadow carry structure, or put a border and a shadow on the same element.
- **Don't** hand-author a second brand colour, or write a literal accent value into a component.
- **Don't** apply `text-transform: uppercase` or positive letter-spacing to Arabic.
- **Don't** use a card radius above 10px; at 16px a label card stops looking measured.
- **Don't** put a coloured border above 1px on the inline edge of a card, list item or alert. A toast's state edge sits on its block-start.
- **Don't** rely on a placeholder to state a rule, or repeat the help text in it.
- **Don't** add a second authored motion. The label strip's register is the one moment; everything else is a plain state change, and all of it stops under `prefers-reduced-motion`.
- **Don't** reach for `--text-disabled` for live text. It is exempt from contrast rules and is for disabled controls only.
