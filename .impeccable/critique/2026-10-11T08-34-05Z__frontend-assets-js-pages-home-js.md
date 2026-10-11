---
target: Home
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:c:\\Users\\youssef.elshal\\Desktop\\Portal\\frontend\\assets\\js\\pages\\home.js"
target_fingerprint: "sha256:21ae3f7fb31fc861c9b487dee6734a1dc554ec51af1055373c8e5d9da80e4d95"
target_path: "c:\\Users\\youssef.elshal\\Desktop\\Portal\\frontend\\assets\\js\\pages\\home.js"
timestamp: 2026-10-11T08-34-05Z
slug: frontend-assets-js-pages-home-js
---
Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Per-card skeletons and failures are good; the page skeleton did not match the real page |
| 2 | Match System / Real World | 3 | "SLA due" and "P1" are queue jargon for a site engineer; short news dates beside a long banner date |
| 3 | User Control and Freedom | 3 | Nothing destructive; nothing to dismiss or reorder |
| 4 | Consistency and Standards | 3 | Record titles are links with no link affordance until hover; every person row goes to #directory |
| 5 | Error Prevention | 3 | Few inputs; an empty search submits harmlessly |
| 6 | Recognition Rather Than Recall | 3 | Top-bar search is placeholder-only; two searches on one desktop screen |
| 7 | Flexibility and Efficiency | 2 | Only "/"; no shortcut for the two primary actions |
| 8 | Aesthetic and Minimalist Design | 2 | Keys repeat on every row; the tag repeats the nav name; four lime discs out-shout the primaries |
| 9 | Error Recovery | 3 | Inline, plain, retryable; focus was dropped after "Try again" |
| 10 | Help and Documentation | 1 | None anywhere |
| **Total** | | **26/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment:** authored at the record level (ruled label strip, Cairo-time strip, Latin tabular digits in Arabic, runtime accent), ordinary at the page level (greeting banner over a bento of equal cards, each with a pill tag and a round arrow).

**Deterministic scan:** 3 advisory findings, all `design-system-color` on frontend/index.html, all false positives: the dark-theme ground and card (`#0d1611`, `#15201a`, named in DESIGN.md prose but not its front matter) and the derived accent ink on the skip link. Nothing in home.js, status.js, skeleton.js, toast.js or notice.js.

**Visual overlays:** none. The page's CSP (`script-src 'self'`) blocked the injected detector and its WebAssembly core; measured facts were taken instead: no horizontal overflow at 1440 or 360; 0 of 19 targets under 44px at 360; heading outline h1 > h2 > h3 with no skipped level.

## Overall Impression

Calm and competent on arrival, then a long even ledger. The biggest opportunity was that Home did not lead with what its own lead sentence promises.

## What's Working

- Each card loads, fails and empties on its own, at its own size, in the right voice.
- Arabic is designed, not mirrored; dark mode holds.
- Status is encoded twice and overdue sorts first.

## Priority Issues

- **[P1] Home does not lead with what it promises.** "Waiting on you" was the third and smallest card, about 1,300px down a phone. Fix: order the cards waiting, bookings, open tickets, directory, news. *Fixed this session.*
- **[P1] Phone records too tall, small text under the Sunlight Floor.** Badge beside the title forced 2–3 line titles at 360px; "N more", person roles and empty/failed text were 12px; "N more" had no 44px target. *Fixed this session.*
- **[P2] The page skeleton caused the jump it claimed to prevent.** No button row, three cards instead of five. *Fixed this session.*
- **[P2] Arabic and accessibility seams.** Latin comma between role and site; bottom-nav "Rooms" truncated in Arabic; focus lost after "Try again"; loading lists unlabelled. *Fixed this session.*
- **[P2] The tickets card can leave a large void** when its neighbours are much taller (seen only in a forced state). Open.

## Persona Red Flags

- **Casey (site phone, 3G):** both primaries sit at the top of the page, out of thumb reach; Home is still a long scroll.
- **Sam (keyboard / screen reader):** `#globalSearch` has no visible label; record links look like text until hover.
- **Jordan (first-timer, Arabic-first):** "SLA due" and "P1" unexplained; two "Tickets" tags over different cards; the round arrow is icon-only.

## Minor Observations

- The notification count is a literal "2" in index.html (demo).
- The company appears three times on desktop (rail, banner strip, news "From").
- No help entry point anywhere.
- An admin's third banner button wraps at 360px.

## Questions to Consider

1. If the label keys were printed once per card, would the Assay Card survive, or is the repetition the identity?
2. Does a phone user need the banner at all, or should the greeting be one line and the two actions live in the bottom nav?
3. Should "Waiting on you" and "Open right now" be one card with a pinned group?
