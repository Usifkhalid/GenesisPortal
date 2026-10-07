---
target: shell and Home redesign
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\youssef.elshal\\Desktop\\Portal\\frontend\\index.html"
target_fingerprint: "sha256:bdc1fbf49296856952da8d6c6f68ac8c5e133b97002dc60a8d922a1a52be9e8b"
target_path: "C:\\Users\\youssef.elshal\\Desktop\\Portal\\frontend\\index.html"
timestamp: 2026-10-07T14-22-08Z
slug: frontend-index-html
closed: true
---
Method: dual-agent (A: ae51f1a3ba26fa9c4 · B: af00c7a243d720221)

# Critique: app shell + Home (session 4b redesign)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No loading, offline or failed state on Home; an overdue SLA is only a badge at the row's end |
| 2 | Match System / Real World | 3 | Real vocabulary and fields; "08/10 16:00" is ambiguous |
| 3 | User Control and Freedom | 2 | Popovers do not close on focus-out; Home colleague search swallows submit |
| 4 | Consistency and Standards | 2 | Ticket and news titles are links, booking titles are not; one card has no arrow |
| 5 | Error Prevention | 2 | Switcher renders for a one-company user; numeric dates |
| 6 | Recognition Rather Than Recall | 3 | Rooms is missing from the phone nav |
| 7 | Flexibility and Efficiency | 2 | "/" is the only accelerator |
| 8 | Aesthetic and Minimalist Design | 2 | Keys repeat on every row; photo placeholder is 38% of the banner |
| 9 | Error Recovery | 1 | renderPage() has no catch and no fallback UI |
| 10 | Help and Documentation | 1 | No help entry point |
| **Total** | | **20/40** | **Acceptable** |

## Design Specificity Verdict

LLM assessment: half grounded. Content and the label strip are unmistakably this product; the container (greeting banner, photo box, bento of "my items" cards with pill tag and round arrow) is the stock consulting/SaaS template the brief asked to move toward. The page promises triage ("what needs you today") and lists tickets in array order.

Deterministic scan: 52 findings, exit 2. 30 design-system-color and 4 design-system-radius are DESIGN.md drift (the doc still describes the old stone/graphite palette and 3/6/10 radii; `document` resolves it). 15 cramped-padding, 1 low-contrast (disabled swatch), 1 font (token-name monospace) and 1 em-dash are false positives. Greps: 0 physical CSS properties, 0 raw colours outside tokens.css, en/ar key parity exact at 323 keys, no missing keys. Real: `<title>` is hard-coded English; due dates and the role/site separator bypass i18n/Intl.

Visual overlays: not attempted (no browser-mutation tool); CDP screenshots used instead.

## What's Working

1. The label strip: real fields, tabular Latin digits in both languages.
2. Accent and highlight engineering: lime only ever carries deep pine (11.8:1) and has a 3:1 keyline.
3. RTL and accessibility groundwork: logical properties throughout, 44px targets, no photo on phone.

## Priority Issues

- **[P0] Home has no loading, failure or zero-data state except one card.** render() only paints the full-data case; renderPage() has no skeleton and no catch. Weak 3G is the baseline. Fix: skeleton before import, catch with retry, an inline empty branch per card, a populated "waiting on you" list. Command: harden / polish.
- **[P1] Records do not triage and have flat hierarchy.** Overdue P1 sits under a P2; strip values and title share one size and weight; no cap on list length; uneven wrap at 360px. Fix: overdue first, cap with "+N more", step the strip below the title, weekday instead of numeric date. Command: polish.
- **[P1] Phone IA hides Rooms, one of the two primary jobs, under More; the search placeholder truncates at 360px.** Fix: bottom nav Home, Tickets, Rooms, Directory, More; short placeholder on phones. Command: adapt.
- **[P1] Phone text is under the system's own 16px sunlight floor** (record titles 14px, keys and badges 11px). Fix: step record text up on phones. Command: typeset.
- **[P2] Banner edge cases.** Every employee sees the "HQ or site photo" placeholder; a one-company user gets a switcher with nothing to switch. Fix: placeholder for admins only; static company block for one company. Command: polish.

## Persona Red Flags

- Alex (HQ power user): overdue P1 not on top; booking titles are not links; two searches.
- Sam (keyboard / screen reader): tickets section name reads "Open right now4 open"; popovers stay open on tab-out; "Administration" h2 precedes the h1.
- Casey (phone, Arabic, weak signal): blank page until i18n and home.js arrive; Rooms hidden under More; empty card costs a full card of scroll.

## Minor Observations

Tags repeat nav labels; lime discs are the brightest things in dark mode; dashed empty box inside a card; sticky hover on touch; hard-coded `<title>`.

## Questions to Consider

1. Should the strip sit under the subject rather than above it in a list?
2. Is Home one page or three (site engineer, agent, admin)?
3. Beyond three records, should the strip become a real compact table?
