# MG Holding: the portal and the IT Helpdesk

Two applications for MG Holding (HLD) and its companies, Genesis Mining (GEN) and Masar
(MSR), in English and Arabic with full right-to-left support. Further companies are added
by configuration, never in code.

| App | Folder | Port | Database | README |
| --- | --- | --- | --- | --- |
| Employee portal | `apps/portal` | 3000 | `mgportal` (`_live`, `_test`) | [apps/portal/README.md](apps/portal/README.md) |
| IT Helpdesk | `apps/helpdesk` | 3001 | `mghelpdesk` (`_live`, `_test`) | [apps/helpdesk/README.md](apps/helpdesk/README.md) |

Both are deployed on their own (docs/DEPLOY.md) and run from `packages/shared`: sign-in
(Entra ID, backend-for-frontend), sessions, Microsoft Graph, notifications, the ticket
rules, the scripts, the design system, the shared components and the ticket pages. Each app
has its own `.env`, its own Prisma schema and its own static files, served over
`packages/shared/web` at the same URLs.

Read `CLAUDE.md` for the rules that bind every change, `PRODUCT.md` for what the portal is
for, and `DESIGN.md` for the visual system.

## What you need

- **Node.js 24 LTS**
- **SQL Server Developer edition** on `localhost:1433` (both apps run in memory without one)

No bundler, no build step.

## Run both side by side

```bash
npm install                                         # links the workspaces, generates the helpdesk's client
cp apps/portal/.env.example apps/portal/.env        # edit: DATABASE_URL (mgportal), SESSION_SECRET
cp apps/helpdesk/.env.example apps/helpdesk/.env    # edit: DATABASE_URL (mghelpdesk), SESSION_SECRET
npm run helpdesk:db:reset                           # create, migrate and seed mghelpdesk (demo)
npm run dev                                         # terminal 1: portal,   http://localhost:3000
npm run dev:helpdesk                                # terminal 2: helpdesk, http://localhost:3001
```

The two keep separate session cookies (`mgp.sid`, `mgh.sid`), so signing in to one does not
sign you out of the other on `localhost`.

## Checks

```bash
npm test                   # both apps' API and unit tests (test:portal, test:helpdesk)
npm run test:e2e           # the portal's Playwright suite (test:e2e:helpdesk for the helpdesk)
npm run lint               # ESLint + Prettier over everything
```

## Layout

```
apps/portal/           the portal: frontend/, backend/, tests/e2e/
apps/helpdesk/         the IT Helpdesk: frontend/, backend/, tests/e2e/
packages/shared/
  server/              config (env rules, runtime), lib, middleware, integrations/graph,
                       modules (auth, directory, notifications, tickets, helpdesk routes),
                       jobs, cli (db, sync, HR import), demo (seed data), testing
  web/                 design system (css, fonts, img), i18n.js, api.js, router.js,
                       components/, the ticket, IT, notification and sign-in pages,
                       common.<lang>.json strings, sw.js
  e2e/                 Playwright helpers both apps' specs use
docs/                  PROGRESS.md, DECISIONS.md, API.md, DEPLOY.md, ADD-A-COMPANY.md
```
