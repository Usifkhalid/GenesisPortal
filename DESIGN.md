---
name: MG Holding Employee Portal
description: Soft rounded cards on warm paper, with every record inside them still read as a labelled specimen, in English and Arabic, under any company's colour.
colors:
  brand-accent: "#b4552d"
  brand-accent-ink: "oklch(from var(--brand-accent) clamp(0.2, min(l, 0.46), 1) c h)"
  brand-accent-edge: "oklch(from var(--brand-accent) min(l, 0.56) c h)"
  highlight: "#c9f03d"
  highlight-hover: "#b6de22"
  highlight-edge: "#6c8610"
  highlight-on: "#12291d"
  pine-900: "#12291d"
  pine-800: "#213a2d"
  pine-600: "#51655a"
  pine-500: "#74857b"
  stone-0: "#ffffff"
  stone-50: "#f8f5f0"
  stone-100: "#f1ede7"
  stone-150: "#eae5e0"
  stone-200: "#e0dad4"
  stone-300: "#cfc9c2"
  stone-400: "#aaa49c"
  success-ink: "#076b29"
  warning-ink: "#7a4b00"
  danger-ink: "#a04038"
  info-ink: "#0b67a9"
typography:
  display:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.3rem + 2.1vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.025em"
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
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "16px"
  xl: "24px"
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
    height: "2.5rem"
  button-primary-compact:
    backgroundColor: "{colors.brand-accent}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    height: "2rem"
  button-secondary:
    backgroundColor: "{colors.stone-0}"
    textColor: "{colors.pine-900}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "2.5rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.pine-800}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
  arrow-button:
    backgroundColor: "{colors.highlight}"
    textColor: "{colors.highlight-on}"
    rounded: "{rounded.pill}"
    size: "2.5rem"
  arrow-button-hover:
    backgroundColor: "{colors.highlight-hover}"
    textColor: "{colors.highlight-on}"
    rounded: "{rounded.pill}"
  tag:
    backgroundColor: "transparent"
    textColor: "{colors.pine-800}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 0.75rem"
    height: "1.5rem"
  tag-highlight:
    backgroundColor: "{colors.highlight}"
    textColor: "{colors.highlight-on}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
  card:
    backgroundColor: "{colors.stone-0}"
    textColor: "{colors.pine-800}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
  card-compact:
    backgroundColor: "{colors.stone-0}"
    textColor: "{colors.pine-800}"
    rounded: "{rounded.md}"
    padding: "1rem"
  banner:
    backgroundColor: "{colors.stone-0}"
    textColor: "{colors.pine-900}"
    rounded: "{rounded.xl}"
    padding: "0.5rem"
  input:
    backgroundColor: "{colors.stone-0}"
    textColor: "{colors.pine-900}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
    height: "2.5rem"
  badge:
    backgroundColor: "{colors.stone-100}"
    textColor: "{colors.pine-800}"
    rounded: "{rounded.xs}"
    padding: "0.25rem 0.5rem"
    height: "1.5rem"
  label-strip-key:
    textColor: "{colors.pine-600}"
    typography: "{typography.label}"
  label-strip-value:
    textColor: "{colors.pine-900}"
    typography: "{typography.title}"
---

# Design System: MG Holding Employee Portal

## Overview

**Creative North Star: "The Assay Card, on a softer desk"**

A mine assays its ore and writes the result on a card: what the sample is, where it came from, what it measured, and who signed for it. That card is still how this portal holds a record. A support ticket, a room booking, a colleague and an announcement each open with the same ruled strip of labelled values, so one reading habit covers the whole product.

What changed is the desk the cards lie on. The surfaces are now soft: generously rounded white sheets on warm off-white paper, with clear air between them, read in a deep pine ink rather than graphite. One fixed lime highlight marks the small things that open something. Home is a bento of these sheets in different sizes under a large rounded welcome banner. The rule that holds the two halves together is **soft outside, measured inside**: the card's corner is 16px, but the strip, the badge and the numerals within it stay as crisp as before.

The shell is still anonymous, because identity belongs to the company. A Company record supplies one accent colour, every brand value is derived from it with contrast guaranteed by arithmetic, and that accent owns primary buttons, links, focus and the current page. Lime is the portal's own and never changes with the company. Work pages (ticket queue, admin, audit log) do not take the soft measure: they run compact, which is the original Assay Card geometry.

**Key Characteristics:**

- Soft outside, measured inside: 16px cards and a 24px banner around hairline-ruled label strips.
- Warm off-white paper, deep pine ink, and one fixed lime highlight that only ever carries pine.
- One runtime accent per company, every other brand value derived from it and AA-safe for any hue.
- Two densities from one token set: comfortable for Home and reading, compact for work.
- Large headings set light; bold kept for the small things that must be found fast.
- Arabic and English designed together, with identical weight coverage and their own leading.
- State is always encoded twice, so nothing depends on colour alone.

## Colors

Warm paper, pine ink, a single company accent that is never assumed, and one fixed lime.

### Primary

- **Company Accent** (`--brand-accent`, placeholder Iron Oxide): supplied at runtime by the Company record. Primary buttons, links, focus rings, the current nav item, selection. It is a placeholder value in the tokens, never a brand colour of the portal's own.
- **Accent Ink** and **Accent Edge**: the accent as text and as a hairline, clamped so the ink clears 4.5:1 and the edge 3:1 against paper and card for every hue, in both themes.

### Secondary

- **Lime Highlight** (`--highlight`): fixed, not derived. The round arrow button on a card that opens somewhere, an icon disc, and the one tag on a screen that marks something new. Hover is one step deeper (`--highlight-hover`). On a light ground it carries a 3:1 keyline (`--highlight-edge`) so the disc still reads in sun; on a dark ground the fill is its own edge.
- **Highlight Ink** (`--highlight-on`): the deep pine, identical in both themes, and the only colour ever drawn on lime (11.8:1).

### Neutral

- **Paper** (`--surface-ground`, stone-50): the page, the rail and the top bar. Warm off-white, OKLCH hue 74.
- **Card** (`--surface-raised`, stone-0): a card, the banner, an input, a dialog. The only white on screen.
- **Well** (`--surface-sunken`, stone-100): a table head, a read-only field.
- **Hairline** (`--rule`, stone-200) and **Strong Rule** (`--rule-strong`, stone-300): every structural edge.
- **Pine Ink** (`--text-strong`, pine-900): headings and values, 15:1 on a card.
- **Body Ink** (`--text-body`, pine-800): running text, 12:1.
- **Muted Ink** (`--text-muted`, pine-600): secondary text, help and every placeholder; 5.4:1 on the well, its worst case.
- **Disabled** (`--text-disabled`, pine-500): disabled text only, which WCAG exempts.

In the dark theme the ink and the paper trade places: a deep pine ground (`#0d1611`), a pine card (`#15201a`) and warm paper text (`#f3efe8`). Not black, which smears on the cheap LCDs site staff carry. Lime is unchanged.

### State

**Success**, **Warning**, **Danger**, **Info** each ship an ink, a tinted surface and a hairline edge. Every ink clears 4.5:1 on a card and on its own surface in both themes.

### Named Rules

**The Derived Accent Rule.** A company supplies one value, `--brand-accent`. Fill, hover, active, on-colour, ink, edge and both washes are computed from it in `tokens.css`. Never hand-author a second brand colour or write a literal accent into a component.

**The Fixed Lime Rule.** Lime is small and it is a surface, never text and never a large field. It appears only on round arrow buttons, icon discs and the "new" tag, and only pine is ever drawn on it. It does not replace the accent: a primary button is never lime.

**The Luminance Flip Rule.** Whether a label on an accent fill is black or white is decided on WCAG relative luminance (threshold Y 0.179), not on OKLCH lightness.

**The Outward Press Rule.** Hover and active mix a fill away from its label colour, so pressing a control can only improve its contrast.

## Typography

**Display / Body / Label Font:** IBM Plex Sans (Latin) with IBM Plex Sans Arabic, self-hosted, SIL Open Font License 1.1.
**Mono:** none. Monospace appears only in the styleguide, to set CSS token names.

**Character:** Plex is a drafted, slightly mechanical humanist. Set large in its regular weight it reads light and unhurried; set small in its bold it reads like a stamped value. The portal uses both ends: light for the page's voice, bold for its data.

Two weights only, 400 and 600, so Arabic and Latin have identical coverage. "Light" headings are the regular weight at a large size, not a third font file: adding a 300 would cost an Arabic reader another 43 kB on 3G.

### Hierarchy

- **Display** (400, fluid 1.75–2.75rem, 1.2, -0.025em): the greeting on Home. One per page.
- **Headline** (400, 1.5625–1.875rem, 1.2): a page heading (`h1`) and a section heading (`h2`).
- **Title** (600, 1.125rem, 1.35): a card title, a dialog title.
- **Record title** (600, 0.875rem; 1rem on a phone): a row's subject in a record list.
- **Body** (400, 1rem, 1.55): running text, capped at 68ch (60ch in Arabic).
- **Label** (600, 0.6875rem, 0.07em, uppercase): the key above a value, a table head, a tag, a badge.

### Named Rules

**The Light Large Rule.** `h1`, `h2` and the display size take the regular weight. Everything from a card title down takes the bold. Weight separates the page's voice from its data, so the two are never confused.

**The Tabular Numerals Rule.** `tabular-nums lining-nums` is set on `body`. The Arabic subset excludes U+0030–0039, so every digit in both languages comes from the Latin face and lines up identically. Dates and times are formatted with Latin digits in Arabic for the same reason.

**The Arabic Equal Standing Rule.** Arabic takes its own leading (1.75) and measure (60ch), never uppercase and never letter-spacing. The label's small-caps treatment is replaced for Arabic by weight and colour at one size up.

**The Sunlight Floor.** On a phone a record's title and text step up to 1rem and its keys and badges to 0.75rem. Desktop keeps the dense measure.

## Layout

The shell is a company rail, a top bar and one work area, all on the paper ground and drawn with hairlines, so the cards are the only raised things on screen. Content is capped at `--page-max` (90rem) and centred; the top bar's contents sit on the same column. The gutter is 16px on a phone, 24px from 48rem and 32px from 80rem.

- **Rail** (≥48rem): the company switcher, the navigation (the only part that scrolls), an "Administration" group for admins, and the collapse control at the foot.
- **Top bar:** three zones, with the search centred between two equal tracks: where you are, the search, your own controls. No width leaves a one-sided gap.
- **Bottom nav** (<48rem): Home, Tickets, Rooms, Directory, More. Both primary actions on Home have a destination in thumb reach.

**Bento.** `.bento` is one column on a phone, six tracks from 44rem and twelve from 68rem. It answers to the page container, not the viewport, so it is the same whether the rail is open, collapsed or absent. The grid supplies tracks; each page says how many its cards span. On Home: banner 12; tickets 7 across two rows beside bookings and "waiting on you" at 5; news 7 and directory 5.

**Density.** Components read semantic tokens (`--radius-control`, `--radius-card`, `--control-height`, `--pad-card`, `--pad-cell-*`, `--pad-row-block`, `--text-cell`), never the raw scale. `[data-density='compact']` on any ancestor swaps the set.

| Token | Comfortable | Compact |
|---|---|---|
| `--radius-card` | 16px | 10px |
| `--radius-control` | 10px | 6px |
| `--control-height` | 40px | 32px |
| `--pad-card` | 16px phone, 24px desktop | 16px |
| `--pad-cell-block` / `-inline` | 12px / 16px | 8px / 12px |
| `--text-cell` | 14px | 13px |

Comfortable is the default: Home, announcements, a record's own page. Compact is for work pages (set it on `.page`), and always for a table frame and a record list. On a phone the 44px tap target wins over `--control-height` in either density.

Spacing runs on one 4px pitch. Breakpoints: 30rem, 40rem (tables become cards), 48rem (rail replaces bottom nav), 64rem, 72rem (account name appears), 80rem.

**The Logical Properties Rule.** `margin-inline`, `padding-block`, `inset-inline-end`, `text-align: start`. Never `left` or `right`. The marked exceptions are the select chevron's background position and `.icon--dir` mirroring.

## Elevation & Depth

**Flat by default, however soft the corner.** A card, the banner, an input and a table all get their edge from a 1px hairline against a tonal step (ground, raised, sunken). Softness comes from radius and air, not from shadow. Shadows are reserved for layers that float above the page in the z-index sense.

### Shadow Vocabulary

- **`--shadow-1`** (`0 1px 2px rgb(18 41 29 / 0.07), 0 4px 12px rgb(18 41 29 / 0.09)`): a popover, the switch knob, the focused skip link.
- **`--shadow-2`** (`0 2px 4px rgb(18 41 29 / 0.08), 0 16px 40px rgb(18 41 29 / 0.14)`): a dialog, a toast.

Shadow colour is the pine ink, never pure black. Both deepen in the dark theme.

### Named Rules

**The Declare Once Rule.** An element gets a border or a shadow, never both.

**The No Structural Shadow Rule.** No shadow may carry structure. A rounded card does not earn a drop shadow.

## Shapes

Soft outside, measured inside. The scale is 4px (a status badge, a swatch), 6px (compact controls), 10px (controls; compact cards and table frames), 16px (cards, dialogs, popovers), 24px (the welcome banner) and the pill (tags, round arrow buttons, the search field, switch, avatar).

A tag is a pill and names a category; a badge is a 4px chip and states a status. The two shapes are never swapped.

Borders come in three weights: 1px (essentially everything), 2px (focus rings, the active-tab rule), 3px (a toast's state edge, the current nav item's marker).

## Components

Precise inside, generous outside. Nothing moves unless it has something to say.

### Label strip (signature)

- **Structure:** a `<dl>` of key/value pairs in a wrapping row, divided by vertical hairlines and closed by a horizontal one. The dividers are drawn in the gap and clipped at the strip's edge, so a strip that wraps at 360px never starts a row with a rule.
- **Content:** always the record's real fields (`TICKET GEN-2026-00042 · PRIORITY P2 · SLA DUE 14:30`). Never decorative.
- **Variants:** `--compact` inside a record list (tighter, values one step under the title); `--open` when it closes nothing, as in the banner, where it is ruled above instead.
- **The authored moment:** on hover (pointer devices only) or focus-within, the strip registers: its closing rule takes the accent and strikes in from the centre over 280ms. Per record, not per card. This is the only authored motion in the system.

### Cards and record lists

- **Card:** `--radius-card`, raised surface, 1px hairline, no shadow, `--pad-card`. Never nested; the stylesheet flattens a card inside a card.
- **Head:** a pill tag over a bold title, optionally with a muted count, and a round arrow button at the inline-end when the card opens somewhere.
- **Record list:** rows divided by hairlines. Each row is a compact label strip over the record's title, with its status badge at the end. Always `data-density="compact"`. Capped on Home, with an "N more" link to the rest; what is overdue sorts first.
- **Empty:** a card whose list is empty keeps its size and says so in one line (`.empty--inline`: a small mark, a title, a sentence). A page never shows a page-sized empty state because one of its lists is empty.

### Welcome banner

24px corner, raised surface, 8px inset. The text column holds the greeting (display), one line of lead, the actions, and today's facts as an open label strip: company, date, Cairo time. The banner carries no photograph.

### Company mark

The company's logo, shown before its name wherever the name appears: the switcher, the company menu, the account menu, a label-strip value. A logo file is a finished tile with its own ground, so it reads the same on any surface and in either theme; the mark frames it with a hairline, keeps its height (32px, or 20px inline) and lets it be wider than tall, up to 1.6:1 so it still fits the collapsed rail. It is decorative: the name is always beside it or on its control. A company with no logo shows its short name on the accent.

### Buttons

- **Shape:** `--radius-control`, 44px tall on a phone, `--control-height` on a pointer device.
- **Primary:** the company accent with a derived keyline. Home's primaries are "Book a room" and "New ticket"; "New announcement" is secondary and admin-only.
- **Secondary / Ghost / Danger / Loading:** as before: hairline on raised; no chrome until touched; danger-edged outline; `aria-busy` with the label kept in place.
- **Round arrow button:** a lime disc with a pine arrow, always a link with a name saying where it goes. The arrow mirrors in Arabic and leans 2px on hover. A quiet outlined variant exists for a secondary destination.

### Tags and badges

- **Tag:** a 24px pill with a hairline edge and a label-style caption; lime only for "new".
- **Badge:** a 24px chip, 4px corners, tinted state surface, plus an icon with its own silhouette per status.

### Inputs / Fields

1px strong rule on the raised surface, `--radius-control`. Focus takes the accent edge and the shared 2px offset outline. `aria-invalid` is the styling hook. Always a visible label; "required" spelled out. The top-bar search is a pill with a "/" shortcut hint on keyboard devices.

### Navigation

- **Company switcher:** a framed control showing the company mark, its name over the group's, and an up-down chevron. It opens the companies this person may work in, each with its own colour swatch. With one company it loses its frame and chevron and is not a control.
- **Rail link:** the current page is marked three ways: accent wash, a short rounded rule on the inline-start edge, bold weight.
- **Rail heading:** a label-style caption ("Administration"); collapsed, it becomes a hairline.
- **Bottom nav and tabs:** unchanged in behaviour; active cells carry accent ink, bold weight and a rule.

### Tables

A table frame is always compact. Below 40rem every row becomes a label card and each cell takes its column name from `data-label`.

## Do's and Don'ts

### Do:

- **Do** open every record with a label strip carrying its real fields.
- **Do** keep the card soft and its contents crisp: 16px outside, hairlines and 4px chips inside.
- **Do** read `--radius-control`, `--radius-card` and the other density tokens in components, and set `data-density="compact"` on work pages, tables and record lists.
- **Do** derive every brand value from `--brand-accent`.
- **Do** draw only `--highlight-on` on lime, in both themes.
- **Do** set `h1`, `h2` and the display size in the regular weight, and data in the bold.
- **Do** give a card with nothing to show a one-line empty state at its own size.
- **Do** encode state twice, give anything tappable 44px on a phone, and use logical properties only.
- **Do** give Arabic its own leading and measure, and Latin digits in dates and numbers.

### Don't:

- **Don't** nest a card in a card, or frame an empty state inside one.
- **Don't** put a shadow on a card, or a border and a shadow on the same element.
- **Don't** use lime as text, as a large surface, or in place of the company accent.
- **Don't** use a pill for a status or a square chip for a category.
- **Don't** use the 16px or 24px radius on a table frame or anything on a work page.
- **Don't** show a page-sized empty state on a page that has other content.
- **Don't** set text on a photograph.
- **Don't** apply `text-transform: uppercase` or letter-spacing to Arabic.
- **Don't** add a second authored motion; the label strip's register is the one.
- **Don't** use `--text-disabled` for live text.
