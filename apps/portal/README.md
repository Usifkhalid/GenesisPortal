# MG Holding Employee Portal (apps/portal)

One of the two apps in this repository; the other is the IT Helpdesk (apps/helpdesk).
Both use the code in packages/shared (see the README at the repository's root).

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
npm install                                   # at the repository's root
cp apps/portal/.env.example apps/portal/.env   # then edit DATABASE_URL and SESSION_SECRET
npm run dev                                   # from the root, or from apps/portal
```

Open <http://localhost:3000>. The design system is at
<http://localhost:3000/styleguide.html> and the health check at
<http://localhost:3000/api/health>.

`npm run dev` runs under `node --watch`, so backend changes restart the process. Frontend
changes need only a browser reload.

Out of the box `AUTH_MODE=mock` and `GRAPH_MODE=mock`: sign-in lists seeded fake users and
Microsoft Graph returns canned data, so no Entra ID tenant is needed. For the real tenant
see "Demo and live data" below.

## Database

```bash
npm run db:migrate       # create and apply a migration (development)
npm run db:seed          # development data: companies, departments, 12 fake users
npm run db:reset         # DROP the development database, migrate, seed
```

All read `DATABASE_URL` from `apps/portal/.env`. From the repository's root they run in
the portal (`npm run db:seed` = `npm run db:seed -w @mg/portal`). `db:reset` loses everything in that database and
refuses to run unless `NODE_ENV` is `development` (the default), the server is on this
machine and the database is not a test one.

### Demo and live data

One switch in `apps/portal/.env`, `PORTAL_DATA`, chooses which database a developer's machine uses.
Both live on the same SQL Server; only the database name differs.

| `PORTAL_DATA` | Database | Contents | Needs |
| --- | --- | --- | --- |
| `demo` (default) | `DATABASE_URL` as written (`mgportal`) | seeded fake people, rooms, helpdesk, demo content | `AUTH_MODE=mock`, `GRAPH_DIRECTORY_MODE=mock` (or absent) |
| `live` | the same name plus `_live` (`mgportal_live`) | the three companies with their domains; people only from the real tenant | `AUTH_MODE=entra`, `GRAPH_DIRECTORY_MODE=real` |

The server refuses a mix (real directory on demo data, or mock sign-in on live data), so fake
and real people never share a database. Mail, calendar and rooms follow `GRAPH_MODE`
separately and can stay `mock` while the directory is real.

```bash
npm run db:live:setup                          # create + migrate mgportal_live, add GEN, MSR, HLD and the IT helpdesk defaults
npm run db:live:setup -- --domain HLD=<domain> # a company's real mail domain
npm run db:live:setup -- --it-leads a@x.com,b@x.com --it-members c@x.com  # IT team by email (active users only)
npm run sync:users -- --dry-run                # what a sync would do, nothing written
npm run sync:users                             # one sync now, with a report
npm run import:hr -- --as <email> --dry-run    # HR's staff list (private/*.csv): report only
npm run import:hr -- --as <email>              # write it (HoldingAdmin only, audited)
```

`db:seed` and `db:reset` refuse to run with `PORTAL_DATA=live`. `db:migrate` is Prisma's own
CLI and always works on the demo database; after pulling new migrations, run `db:live:setup`
again to apply them to the live one. Departments are never created
by the sync: it lists the Entra department names that match none, for an admin to add under
Administration. The sync keeps its safety stops (nothing written when Entra returns nobody, or
when more than 20% of active people would be deactivated). It also runs from Administration >
Directory sync and nightly at 02:00 Cairo time.

`import:hr` matches HR's staff list to portal accounts by name (or by hand in
`private/hr-matches.csv`), creates HR's departments and sets company, department, job title,
office, staff id, employment category and hire date. Those four profile fields are then HR's:
sync and sign-in no longer overwrite them (docs/DECISIONS.md D140). Counts go to the terminal,
details with a reason per row to `reports/hr-import-<date>.csv`. `private/` and `reports/`
hold personal data and are git-ignored.

The live tickets, IT team and settings move to the IT Helpdesk app with
`npm run helpdesk:migrate:from-portal` (apps/helpdesk/README.md, D145). Before it, set
`PORTAL_HELPDESK_JOBS=off` here and restart the portal: its SLA alerts and confirmation
reminders stop, and the helpdesk sends them from then on.

### Test database

`npm test` and `npm run test:e2e` never use `DATABASE_URL`. They run on `mgportal_test`
(`DATABASE_URL_TEST` in `apps/portal/.env`, or `DATABASE_URL` with `_test` added to the
database name). With `PORTAL_DATA=live` in `.env`, set `DATABASE_URL_TEST` to the
`mgportal_test` address. Before every run `backend/scripts/prepare-test-db.js` creates it if it is missing, applies the
migrations and empties every table (seeding it first for the e2e server). A test database
must be named `*_test`; anything else is refused.

## Checks

```bash
npm test                 # both apps (npm run test:portal for this one), on the test databases
npm run test:e2e         # Playwright, Chromium, 1440 and 360 px, EN and AR (includes axe,
                         # resilience, offline/PWA and page-weight specs)
npm run lint             # ESLint + Prettier check
npm run format           # Prettier write
```

## Layout

```
apps/portal/
  frontend/              the portal's own static files, served at / over packages/shared/web
    assets/js/           app.js, helpdesk.js (the old IT workspace), pages/ (home, rooms, …)
    assets/i18n/         portal.<lang>.json (common.<lang>.json is in packages/shared/web)
  backend/src/
    server.js            process entry point
    app.js               builds the Express app (no listening)
    config/env.js        the one place that reads process.env
    modules/<module>/    admin, announcements, rooms, directory routes, helpdesk page gate
    jobs/                pinned announcements
  backend/prisma/        schema.prisma, migrations/, seed.js
  backend/scripts/       thin wrappers over packages/shared/server/cli
  backend/tests/
  tests/e2e/             Playwright specs; playwright.config.js beside tests/
packages/shared/         sign-in, sessions, Graph, notifications, tickets, design system
docs/                    PROGRESS.md, DECISIONS.md, API.md, DEPLOY.md
```

## Conventions worth knowing before the first change

- Every business table carries `companyId`, and every read and write goes through
  `lib/scope.js`. A user of one company must never see another's records.
- No text in markup or JavaScript. Strings live in `assets/i18n/<bundle>.<lang>.json`
  (`common` in packages/shared/web, `portal` here) under the same key in both languages.
- CSS uses logical properties only (`margin-inline-start`, not `margin-left`) and tokens
  from `tokens.css`, never raw colours or sizes. Company accent colour arrives at runtime
  as a CSS variable, so every screen must work with any accent.
- Timestamps are stored in UTC and shown in Africa/Cairo. The working week is Sunday to
  Thursday.
- Secrets live only in `apps/portal/.env`, which is not committed. `.env.example` lists
  the keys.

## Hosting

Azure App Service, South Africa North, with Azure SQL.
