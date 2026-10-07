# MG Holding Employee Portal

Internal portal for MG Holding (HLD) and its companies, Genesis Mining (GEN) and Masar
(MSR). English and Arabic are both first-class, with full right-to-left support. Further
companies are added by configuration, never in code.

Read `CLAUDE.md` for the rules that bind every change, `PRODUCT.md` for what the portal is
for, and `DESIGN.md` for the visual system.

## What you need

- **Node.js 24 LTS** — `node -v` should print `v24.x`.
- **SQL Server Developer edition**, reachable on `localhost:1433`. Only needed once the
  database is in use; the server and its tests run without it today.

No bundler, no build step: the frontend is plain HTML, CSS and ES modules, served as
static files by the backend.

## Run it

```bash
npm install
cp .env.example .env     # then edit DATABASE_URL and SESSION_SECRET
npm run dev
```

Open <http://localhost:3000>. The design system is at
<http://localhost:3000/styleguide.html> and the health check at
<http://localhost:3000/api/health>.

`npm run dev` runs under `node --watch`, so backend changes restart the process. Frontend
changes need only a browser reload.

Out of the box `AUTH_MODE=mock` and `GRAPH_MODE=mock`: sign-in lists seeded fake users and
Microsoft Graph returns canned data, so no Entra ID tenant is needed. Real tenant access
has not been granted yet.

## Database

```bash
npm run db:migrate       # create and apply a migration
npm run db:seed          # development data
```

Both read `DATABASE_URL` from `.env`. The schema is still empty, so there is nothing to
migrate or seed yet.

## Checks

```bash
npm test                 # node:test + supertest
npm run lint             # ESLint + Prettier check
npm run format           # Prettier write
```

## Layout

```
frontend/                static files, served at /
  assets/css/            tokens.css first; pages/ holds per-page sheets
  assets/js/             app.js, components/, pages/
  assets/i18n/           en.json and ar.json, same keys in both
backend/src/
  server.js              process entry point
  app.js                 builds the Express app (no listening)
  config/env.js          the one place that reads process.env
  middleware/            cross-cutting request handling
  lib/                   shared helpers (company scoping, Prisma client)
  modules/<module>/      routes.js, service.js, schema.js
  integrations/graph/    the only door to Microsoft Graph (mock and real)
  jobs/                  scheduled work
backend/prisma/          schema.prisma, migrations/, seed.js
backend/tests/
docs/                    PROGRESS.md, DECISIONS.md, API.md
```

## Conventions worth knowing before the first change

- Every business table carries `companyId`, and every read and write goes through
  `lib/scope.js`. A user of one company must never see another's records.
- No text in markup or JavaScript. Strings live in `assets/i18n/en.json` and `ar.json`
  under the same key.
- CSS uses logical properties only (`margin-inline-start`, not `margin-left`) and tokens
  from `tokens.css`, never raw colours or sizes. Company accent colour arrives at runtime
  as a CSS variable, so every screen must work with any accent.
- Timestamps are stored in UTC and shown in Africa/Cairo. The working week is Sunday to
  Thursday.
- Secrets live only in `.env`, which is not committed. `.env.example` lists the keys.

## Hosting

Azure App Service, South Africa North, with Azure SQL.
