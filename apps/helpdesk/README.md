# MG Holding IT Helpdesk (apps/helpdesk)

The IT Helpdesk as an application of its own (docs/DECISIONS.md D144): employees of every
MG Holding company raise and follow their IT tickets here; the IT team works them. It has
its own server (port 3001), its own database, its own copy of the people from Microsoft 365
and its own notifications. It signs in with the same Microsoft app registration as the
portal (MGH-Portal-Web), and the portal will only link to it.

The design system, the ticket rules and screens, sign-in, sessions, Graph, notifications and
the scripts are shared with the portal (packages/shared); this app adds its shell, its
Administration and its database.

## Who sees what

| Who | Pages |
| --- | --- |
| everyone signed in | My tickets, New ticket, a ticket with its replies, confirm a resolution and rate it (D143), notifications |
| IT agents and leads | the above, plus Queue, My assigned tickets, Reports; leads also IT settings |
| the helpdesk's administrators (HoldingAdmin here) | Administration: who is on the IT team, companies and their mail domains |

The first administrator comes from `INITIAL_HELPDESK_ADMINS` at their first Microsoft
sign-in (only while no real one exists, audited). A person is placed in a company by their
email's domain; a domain no company owns gets no account.

## Run it

```bash
npm install                                        # at the repository's root; also generates
                                                   # the helpdesk's Prisma client
cp apps/helpdesk/.env.example apps/helpdesk/.env   # then edit DATABASE_URL and SESSION_SECRET
npm run helpdesk:db:deploy                         # create the tables in mghelpdesk (once the database exists)
npm run helpdesk:db:seed                           # demo: companies, fake people, the IT team
npm run dev:helpdesk                               # http://localhost:3001
```

`db:reset` (drop, migrate, seed the demo database) creates the database when it is missing:
`npm run helpdesk:db:reset`. In `apps/helpdesk` the same scripts run without the prefix:
`npm run dev`, `npm test`, `npm run db:reset`, …

## Demo and live data

| `HELPDESK_DATA` | Database | Contents | Needs |
| --- | --- | --- | --- |
| `demo` (default) | `mghelpdesk` | seeded fake people and the IT team | `AUTH_MODE=mock` |
| `live` | `mghelpdesk_live` | real people only | `AUTH_MODE=entra`, `GRAPH_DIRECTORY_MODE=real` |

```bash
npm run helpdesk:db:setup-live                                  # create + migrate mghelpdesk_live: GEN, MSR, HLD and the IT team's defaults
npm run helpdesk:db:setup-live -- --domain HLD=<domain>         # a company's real mail domain
npm run helpdesk:db:setup-live -- --it-leads a@x.com --it-members b@x.com,c@x.com   # the IT team (active people only)
npm run helpdesk:sync:users -- --dry-run                        # the people from Microsoft 365, nothing written
npm run helpdesk:sync:users                                     # one sync now, with a report
npm run helpdesk:import:hr -- --as <email> --dry-run            # HR's staff list (private/*.csv), same rules as the portal
```

Set the IT team after the first sync: `--it-leads` and `--it-members` take people who are
already in the database.

## Checks

```bash
npm run test:helpdesk          # node:test + supertest; SQL Server tests on mghelpdesk_test
npm run test:e2e:helpdesk      # Playwright: EN/AR, 1440/360 px, axe
```

## Layout

```
frontend/            index.html (the shell), login.html, offline.html, manifest
  assets/js/         app.js, pages/requests.js, pages/administration/*
  assets/i18n/       helpdesk.<lang>.json over packages/shared/web's common.<lang>.json
  assets/css/pages/  helpdesk-app.css
backend/src/         server.js, app.js, config/env.js, modules/me, modules/admin
backend/prisma/      schema.prisma (generated into backend/generated/client), migrations/, seed.js
backend/scripts/     thin wrappers over packages/shared/server/cli
backend/tests/       app, authorisation matrix, SQL Server, strings
tests/e2e/           Playwright specs
```
