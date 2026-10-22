# MG Holding Employee Portal

## What this is
Internal portal for MG Holding (code HLD) and its companies Genesis Mining (GEN, genesismining-eg.com) and Masar (MSR, masar.eg). More companies join later through configuration only: never hard-code a company.
Users: HQ staff in Cairo on desktops, and site staff (mines, construction sites) on Android phones with weak connectivity.
Languages: English and Arabic, both first-class, full RTL.
Roles: HoldingAdmin (all companies), CompanyAdmin (one company), User. Ticket agents are members of a support team.
MVP modules: app shell, sign-in, company admin, announcements, directory, room booking, support tickets (an IT helpdesk: one holding team serves every company), notifications, audit log.

## Stack
- Frontend: plain HTML, CSS, JavaScript (ES modules). No framework, no bundler, no build step. Served as static files by each app's backend: its own frontend/ over packages/shared/web, at the same URLs.
- Backend: Node.js 24 LTS, Express 5, ES modules, zod for validation.
- Database: SQL Server (local Developer edition), Azure SQL in production. Prisma ORM and migrations.
- Auth: Entra ID (tenant "mgholding") via @azure/msal-node, backend-for-frontend pattern: server-side session, httpOnly Secure SameSite cookie. The browser never holds tokens.
- AUTH_MODE=mock (default in dev): login screen lists seeded fake users per company and role.
- Microsoft Graph only through packages/shared/server/integrations/graph/ with two implementations: mock (GRAPH_MODE=mock, default in dev) and real. Real tenant access is not granted yet.
- Tests: node:test + supertest for the API; Playwright for a few end-to-end flows.
- Hosting target: Azure App Service, South Africa North.

## Folder layout
A monorepo (npm workspaces, docs/DECISIONS.md D144). Two apps, each deployed on its own, and the code both run:
/apps/portal: the portal (port 3000, database mgportal)
  /frontend: index.html, helpdesk.html (the old IT workspace, D135, removed in session 2), login.html, no-access.html, styleguide.html; assets/js (app.js, pages/*), assets/i18n/portal.<lang>.json
  /backend/src: server.js, app.js, config/env.js, modules/<module>/ (admin, announcements, rooms, directory routes); /backend/prisma; /backend/scripts (thin wrappers); /backend/tests
  /tests/e2e: Playwright specs and helpers.js (re-exports packages/shared/e2e); playwright.config.js beside it
/apps/helpdesk: the IT Helpdesk (port 3001, database mghelpdesk; same layout; its Prisma client is generated into backend/generated/client)
/packages/shared (@mg/shared)
  /server: config (env-core.js rules, runtime.js: what the running app is), lib/, middleware/, integrations/graph/, jobs/, modules/ (auth, directory, notifications, tickets, helpdesk routes), cli/ (db, sync, HR import), demo/ (seed data), db/, testing/
  /web: assets/css (tokens.css, base.css, layout.css, components.css, pages/*.css), assets/js (router.js, api.js, i18n.js, auth.js, components/*, the ticket, IT, notification, sign-in pages), assets/i18n/common.<lang>.json, assets/fonts, assets/img, sw.js
  /e2e: Playwright helpers (signIn, signOut, t, expectLanguage, expectNoSidewaysScroll) and axe helpers
Shared code never imports an app: each app's config/env.js calls configureRuntime() and shared modules read it when called.
/storage: the portal's uploads (apps/helpdesk/storage: the helpdesk's) from the local storage adapter (packages/shared/server/lib/storage.js, STORAGE_DIR); gitignored, never served. Production uses Azure Blob (STORAGE_DRIVER=azure). Uploads are wrapped by lib/file-scan.js: a file is served only once its malware scan is clean.
/docs: PROGRESS.md, DECISIONS.md, API.md, ADD-A-COMPANY.md, SECURITY-CHECKLIST.md, DEPLOY.md
PRODUCT.md and DESIGN.md (written by Impeccable) at the root.

## Rules (always)
1. Company scoping: every business table has companyId. All reads and writes go through lib/scope.js using req.user. Never trust a companyId from the client without checking the user's scope. Every module has a test proving a user of one company cannot read or change another company's records. One exception, for helpdesk agents only: a ticket is read by its requester and by its support team across companies, never through company scope (docs/DECISIONS.md D99, packages/shared/server/modules/tickets/rules.js).
2. No hard-coded UI text. Every string lives in assets/i18n/<bundle>.<lang>.json (common in packages/shared/web, portal or helpdesk in the app) with the same keys in en and ar. A page names its bundles in <meta name="mg-i18n">.
3. RTL: CSS logical properties only (margin-inline-start, padding-inline, inset-inline-end, text-align: start). Never left/right. <html lang dir> follows the language. Directional icons flip in RTL.
4. Design: follow PRODUCT.md and DESIGN.md. Page CSS uses tokens from tokens.css only, no raw colours or sizes. Use /impeccable commands for design work. Company branding (logo, accent colour) comes from the Company record at runtime as CSS variables, so every screen must work with any accent.
5. Accessibility: semantic HTML, a visible label on every input, full keyboard use, visible focus, WCAG AA contrast.
6. Performance for site staff: no frontend library over 30 kB without asking; lazy-load page modules; small images.
7. Security: no inline scripts or styles (strict CSP: per-element values go in data-css and applyCss() from html.js, never a style attribute); every new route needs a row in backend/tests/authz-matrix.test.js; validate every input with zod; Prisma only, no raw SQL string building; helmet; CSRF protection for cookie sessions; rate-limit auth routes; secrets only in .env (commit .env.example with placeholders). Write every admin action to AuditLog.
8. Dates stored in UTC, shown in Africa/Cairo time. Working week Sunday to Thursday.

## Commands
From the root (each also runs inside its app folder without the prefix):
npm run dev / npm run dev:helpdesk            portal at :3000 / helpdesk at :3001
npm test                                      both apps' API and unit tests (test:portal, test:helpdesk; 2 workers)
npm run test:e2e / npm run test:e2e:helpdesk  Playwright, Chromium, 1440 and 360 px, English and Arabic
npm run lint                                  ESLint + Prettier check
npm run db:migrate / db:seed / db:live:setup  the portal's; helpdesk:db:deploy / helpdesk:db:seed / helpdesk:db:setup-live / helpdesk:sync:users / helpdesk:import:hr

## Session protocol (keeps usage low)
- Each session does only the task in its prompt. Do not start other work.
- First read docs/PROGRESS.md. Then read only the files the task needs; do not scan the whole repo.
- Keep chat replies short. Do not paste whole files into chat.
- Never print .env values, passwords or secrets to the terminal or chat. When checking settings, show them masked (first 2 characters + ***, e.g. `ho***`), and do not echo connection strings.
- Browser checks: run npm run test:e2e. Do not write throwaway browser scripts. A new flow gets a spec in the app's tests/e2e built on its helpers.js (signIn, signOut, t, expectLanguage, expectNoSidewaysScroll).
- At the end: run npm test, npm run test:e2e (when the frontend or sign-in changed) and npm run lint and fix failures; update docs/PROGRESS.md (done, files touched, open issues, next step; max 15 lines for this session); add decisions to docs/DECISIONS.md; make one git commit with a clear message.
