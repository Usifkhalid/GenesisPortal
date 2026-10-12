# MG Holding Employee Portal

## What this is
Internal portal for MG Holding (code HLD) and its companies Genesis Mining (GEN, genesismining-eg.com) and Masar (MSR, masar.eg). More companies join later through configuration only: never hard-code a company.
Users: HQ staff in Cairo on desktops, and site staff (mines, construction sites) on Android phones with weak connectivity.
Languages: English and Arabic, both first-class, full RTL.
Roles: HoldingAdmin (all companies), CompanyAdmin (one company), User. Ticket agents are members of a support team.
MVP modules: app shell, sign-in, company admin, announcements, directory, room booking, support tickets (an IT helpdesk: one holding team serves every company), notifications, audit log.

## Stack
- Frontend: plain HTML, CSS, JavaScript (ES modules). No framework, no bundler, no build step. Served as static files by the backend from /frontend.
- Backend: Node.js 24 LTS, Express 5, ES modules, zod for validation.
- Database: SQL Server (local Developer edition), Azure SQL in production. Prisma ORM and migrations.
- Auth: Entra ID (tenant "mgholding") via @azure/msal-node, backend-for-frontend pattern: server-side session, httpOnly Secure SameSite cookie. The browser never holds tokens.
- AUTH_MODE=mock (default in dev): login screen lists seeded fake users per company and role.
- Microsoft Graph only through backend/src/integrations/graph/ with two implementations: mock (GRAPH_MODE=mock, default in dev) and real. Real tenant access is not granted yet.
- Tests: node:test + supertest for the API; Playwright for a few end-to-end flows.
- Hosting target: Azure App Service, South Africa North.

## Folder layout
/frontend: index.html, login.html, styleguide.html
  /assets/css: tokens.css, base.css, layout.css, components.css, pages/*.css
  /assets/js: app.js, router.js, api.js, i18n.js, auth.js, components/*, pages/*
  /assets/i18n: en.json, ar.json
  /assets/fonts, /assets/img
/backend/src: server.js, app.js, config/, middleware/, lib/, jobs/, integrations/, modules/<module>/ (routes.js, service.js, schema.js)
/backend/prisma: schema.prisma, migrations/, seed.js
/backend/tests
/tests/e2e: Playwright specs (*.spec.js) and helpers.js; playwright.config.js at the root
/storage: uploaded files (company logos) from the local storage adapter (backend/src/lib/storage.js, STORAGE_DIR); gitignored, outside frontend/ so never served statically. Azure Blob later.
/docs: PROGRESS.md, DECISIONS.md, API.md, ADD-A-COMPANY.md
PRODUCT.md and DESIGN.md (written by Impeccable) at the root.

## Rules (always)
1. Company scoping: every business table has companyId. All reads and writes go through lib/scope.js using req.user. Never trust a companyId from the client without checking the user's scope. Every module has a test proving a user of one company cannot read or change another company's records. One exception, for helpdesk agents only: a ticket is read by its requester and by its support team across companies, never through company scope (docs/DECISIONS.md D99, backend/src/modules/tickets/rules.js).
2. No hard-coded UI text. Every string lives in assets/i18n/en.json and ar.json with the same keys.
3. RTL: CSS logical properties only (margin-inline-start, padding-inline, inset-inline-end, text-align: start). Never left/right. <html lang dir> follows the language. Directional icons flip in RTL.
4. Design: follow PRODUCT.md and DESIGN.md. Page CSS uses tokens from tokens.css only, no raw colours or sizes. Use /impeccable commands for design work. Company branding (logo, accent colour) comes from the Company record at runtime as CSS variables, so every screen must work with any accent.
5. Accessibility: semantic HTML, a visible label on every input, full keyboard use, visible focus, WCAG AA contrast.
6. Performance for site staff: no frontend library over 30 kB without asking; lazy-load page modules; small images.
7. Security: validate every input with zod; Prisma only, no raw SQL string building; helmet; CSRF protection for cookie sessions; rate-limit auth routes; secrets only in .env (commit .env.example with placeholders). Write every admin action to AuditLog.
8. Dates stored in UTC, shown in Africa/Cairo time. Working week Sunday to Thursday.

## Commands
npm run dev       backend + frontend at http://localhost:3000
npm test          all API and unit tests
npm run test:e2e  Playwright smoke tests (tests/e2e), Chromium, 1440 and 360 px, English and Arabic
npm run lint      ESLint + Prettier check
npm run db:migrate / npm run db:seed

## Session protocol (keeps usage low)
- Each session does only the task in its prompt. Do not start other work.
- First read docs/PROGRESS.md. Then read only the files the task needs; do not scan the whole repo.
- Keep chat replies short. Do not paste whole files into chat.
- Never print .env values, passwords or secrets to the terminal or chat. When checking settings, show them masked (first 2 characters + ***, e.g. `ho***`), and do not echo connection strings.
- Browser checks: run npm run test:e2e. Do not write throwaway browser scripts. A new flow gets a spec in tests/e2e built on tests/e2e/helpers.js (signIn, signOut, t, expectLanguage, expectNoSidewaysScroll).
- At the end: run npm test, npm run test:e2e (when the frontend or sign-in changed) and npm run lint and fix failures; update docs/PROGRESS.md (done, files touched, open issues, next step; max 15 lines for this session); add decisions to docs/DECISIONS.md; make one git commit with a clear message.
