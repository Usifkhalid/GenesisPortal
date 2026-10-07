# Progress

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
