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

## The two links to publish

| Link | For | Opens |
| --- | --- | --- |
| `<helpdesk host>/new` | every employee | the New ticket form, with My tickets beside it |
| `<helpdesk host>/queue` | the IT team | the Queue |

- Opened signed out, the link goes through the Microsoft sign-in (mock sign-in in development)
  and returns to the link. The address is carried as `login.html?next=<path>`, then through
  `/auth/login?next=<path>` and the session; only a path on this site is accepted
  (`packages/shared/server/lib/return-path.js`: no other site, no `//`, no backslash, nothing
  under `/api`, `/auth` or the sign-in page), anything else lands on the bare address.
- Someone not on the IT team who opens `/queue` is sent to `/new`, with no error page.
- The bare address sends employees to `/new` and the IT team to `/queue`. An address that
  already names a page (`/#tickets/<id>`, an emailed link) is left alone.
- The server answers both links with the one page (`/new/` redirects to `/new`);
  `frontend/assets/js/app.js` (`settleEntryAddress`) picks the screen once it knows who is signed in.

## Raising a ticket for someone else

An IT agent or lead opens the Queue, **Log a ticket for someone**, searches the helpdesk's
people, chooses how it came in (phone or walk-in) and fills the usual fields. The employee is
the requester: it is under their My tickets, they are told by bell and email, and the ticket
says "Raised by <agent> on behalf of <employee>". Each one writes an audit row
(`ticket.create_on_behalf`, naming both people).

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
already in the database. After a migration from the portal (below) the team is already
there, and `db:setup-live` keeps the portal's companies and settings as they are.

## Moving the portal's helpdesk here (D145)

The portal's live tickets, IT team and settings are copied once into `mghelpdesk_live`.
The script creates and migrates that database itself; `db:setup-live` is not needed first.

```bash
# the portal no longer runs helpdesk jobs (D146); one that still has the old code must be stopped first
# apps/helpdesk/.env: HELPDESK_DATA=live, PORTAL_SOURCE_DATABASE_URL=<mgportal_live, read-only login>
# stop the helpdesk server while it runs
npm run helpdesk:migrate:from-portal -- --as <you> --dry-run   # counts per table and company; nothing written
npm run helpdesk:migrate:from-portal -- --as <you>             # create + migrate mghelpdesk_live, copy, check
npm run helpdesk:migrate:from-portal -- --as <you> --verify    # the check again, nothing written
```

- **Read-only portal:** it reads `PORTAL_SOURCE_DATABASE_URL` through a wrapper that refuses
  every write before it is sent, and the portal's files from `PORTAL_SOURCE_STORAGE_DIR`
  (default `<repo>/storage`). A `db_datareader` login on `mgportal_live` is the second lock.
  The server never opens either (`backend/tests/standalone.test.js`).
- **What comes:** companies and domains, departments, every person (HR's fields and staff ids
  kept), plain User roles and `--as`'s HoldingAdmin (they become the helpdesk's first
  administrator; other admin roles stay in the portal), the IT team with leads, agents, hours,
  SLA, categories, locations, holidays, canned replies, every ticket with its number, dates,
  replies, internal notes, history, SLA clock and pause, rating, feedback and close reason,
  attachments (bytes copied, scan verdict kept: a pending or unknown file is scanned before it is
  served), ticket notifications that are unread or carry an alert key (so no SLA alert or
  reminder goes out twice), and the ticket and IT-settings audit rows (`origin = 'portal'`,
  original time and actor). The yearly counter continues after the highest number.
- **Matching:** a company by code, a person by Entra object id then email: someone the
  directory sync already brought keeps their row, never a second one. Later `sync:users` and
  `import:hr` match the same rows (HR by the stored staff id).
- **Safe twice:** `PortalImport` records every row copied; a second run copies nothing. It
  refuses when `mghelpdesk_live` holds tickets that did not come from the portal (unless
  `--force-merge`), when a portal number is taken here, while the portal's helpdesk jobs or a
  helpdesk server ran in the last 15 minutes, or when `--as` is not an active holding-wide
  HoldingAdmin of the portal. Nothing sends mail or alerts.
- **Report:** counts to the terminal; `reports/helpdesk-migration-<Cairo time>.json`
  (git-ignored) with counts per table and company, warnings and the check (every table's count,
  every ticket number, every file's size and SHA-256). Exit code 1 if the check fails. The run
  is audited (`helpdesk.migrate_from_portal`).

### After it ran: the portal links here (D146)

The portal has no helpdesk code any more. Its menu and Home open this app (its `HELPDESK_URL`),
and the addresses of the old portal lead here: `<portal>/#tickets/<number or id>` and
`<portal>/helpdesk#tickets/...` (earlier emails) arrive as `<helpdesk>/#tickets/<number or id>`.
`GET /api/tickets/by-number/:number` turns a number into the ticket's id for the people allowed
to see it, and the ticket page replaces the number in the address with the id. The migration
reads the portal's old tables, which stay in `mgportal_live` until the cleanup migration
(`apps/portal/backend/prisma/pending-cleanup`, docs/DEPLOY.md) is applied: `--verify` stops
working after that, so run it a last time before.

## Runs on its own

The helpdesk needs nothing from the portal at runtime. Its process runs its own jobs, each
behind a JobLease row so two instances never both work a round: session pruning, the nightly
user sync (02:00 Cairo), the SLA watch (75% and 100%, every five minutes), the 24-hour
confirmation reminders and the malware-scan sweep. Notifications (bell and email) are written
and sent at the moment of the change. `/api/health` and `/api/ready`, its own session store
(`mgh.sid`), rate limits, CSP, the scan gate and the production guard are the portal's.

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
backend/src/         server.js, app.js, config/env.js, modules/me, modules/admin,
                     modules/migration (the one-time copy from the portal, D145)
backend/prisma/      schema.prisma (generated into backend/generated/client), migrations/, seed.js
backend/scripts/     thin wrappers over packages/shared/server/cli
backend/tests/       app, authorisation matrix, SQL Server, strings, the migration,
                     the helpdesk with the portal switched off, and the ticket rules
                     (tickets, SLA, notifications, attachments, seed: moved here from the portal)
tests/e2e/           Playwright specs (tickets story, notifications, a11y, the app)
```
