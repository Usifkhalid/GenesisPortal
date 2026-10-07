# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain HTML, CSS and JavaScript. No framework.

## Users

- **HQ office staff (Cairo):** work on Windows desktops in Edge or Chrome.
- **Site staff (engineers, lab, field):** at mines and construction sites, on Android phones over weak 3G/4G, sometimes outdoors in bright sun.
- **Company admins:** configure their company's portal.
- **Support teams (IT, HR, facilities, admin):** work the ticket queues.

Many users read Arabic first.

## Product Purpose

MG Holding Employee Portal is the internal portal for a holding company and its subsidiaries. Current subsidiaries: Genesis Mining (phosphate, gold, quarries) and Masar (roads, railways, bridges, dredging). Two more companies will join later.

Employee jobs: book a meeting room, open and track a support ticket, read company announcements, find a colleague.

Admin jobs: configure companies, manage ticket queues, publish announcements.

Success: an employee finishes one of these jobs quickly, on any device and connection, in the language they read best.

## Positioning

One shared portal across a multi-company group. Each company appears under its own logo and accent colour, while the shell and workflows stay common.

## Operating Context

- HQ: Windows desktops, Edge/Chrome, stable network.
- Sites: Android phones, weak 3G/4G, bright outdoor light, quick task-in-hand use.
- Industrial sector (mining, roads, railways, bridges, dredging); not a startup or consumer context.

## Capabilities and Constraints

- English and Arabic (RTL) are both first-class. Layout, content and behaviour must work equally in both directions.
- Multi-company: company name, logo and accent colour are supplied at runtime. The design must work with any accent colour.
- Must be fast on slow networks and work at 360 px width.
- Plain HTML/CSS/JS only.
- Open decision: the two future companies are not yet known, so nothing may assume only two companies.

## Brand Commitments

- The portal shell is neutral; brand identity comes from each company's logo and accent colour.
- Voice: calm, clear, trustworthy, corporate but not cold. Plain words.

## Evidence on Hand

None provided. Company logos, accent colours, announcements and staff data are not yet supplied; do not fabricate them.

## Product Principles

1. **Task first.** The four core jobs (room, ticket, announcements, colleague) are reachable at once and finish in few steps.
2. **Built for the worst connection.** Weak 3G/4G is the baseline, not an edge case; light pages and clear states when loading or offline.
3. **Two languages, equal footing.** Arabic is designed for, not mirrored as an afterthought.
4. **Neutral shell, company identity on top.** No design choice may depend on a specific accent or logo.
5. **Plain and trustworthy.** Plain words, clear status, no hype.

## Accessibility & Inclusion

- WCAG AA required.
- Legible in bright sun on phones, so contrast must hold up.
- Full RTL support for Arabic readers.

## Product Principles

- **Task first.** Every screen exists to finish one of the main jobs (book a room, track a ticket, read an announcement, find a colleague) in as few steps as possible.
- **Equal in both languages.** English and Arabic are designed together, not translated after the fact. Arabic-first readers get the same quality as English readers.
- **Built for the weakest connection.** Design for a phone on weak 3G/4G first. Anything that slows that user down needs a strong reason.
- **Neutral shell, company identity on top.** The portal never assumes a particular company, logo or accent colour. Adding a company is configuration, not redesign.
- **Plain and trustworthy.** Short, plain words; clear status; no jargon and no hype.

## Accessibility & Inclusion

- WCAG AA is required, including in bright outdoor light on phones.
- Must work at 360 px width and with keyboard-only use.
- Full RTL support; many users read Arabic first.
