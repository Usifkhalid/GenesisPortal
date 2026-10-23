# Deploying the portal and the IT Helpdesk

For the IT person who will set this up. The repository holds **two independent apps** (D144,
D146): the employee portal (`apps/portal`) and the IT Helpdesk (`apps/helpdesk`). Each has its
own process, port, database, `.env`, session cookie, file storage and background jobs. Neither
calls the other while it runs; they are linked only by an address each is given (the portal's
`HELPDESK_URL`, the helpdesk's optional `PORTAL_URL`) and by sharing one Entra app
registration. Both are built from the same release, with the code they share in
`packages/shared`.

> **Status, 22 October 2026.** Nothing has been deployed to a server, and none of this has been
> run against a real subscription or an on-premises server. The application side
> (configuration checks, Blob storage adapter, malware-scan states, health checks, job leases)
> is tested locally. The Azure commands are a careful draft: where a command's exact flags
> could not be confirmed it says so, and the Azure portal path is given beside it. The
> on-premises section is a plan, and lists what still blocks it.

## Choose how to run it

| Option | What it is | When |
| --- | --- | --- |
| **(a) Both on one server** | One Windows (or Linux) server runs both Node processes (ports 3000 and 3001) behind one reverse proxy, with one SQL Server holding two databases | The first target: simplest, one thing to patch and back up |
| **(b) The helpdesk on its own server** | The portal as in (a); the helpdesk on a second server with its own SQL Server (or the same one over the network) | When IT wants the helpdesk to stay up while the portal is down for maintenance, or to keep tickets on separate hardware |
| **(c) One Azure App Service each** | Two web apps in South Africa North, Azure SQL, one Blob container each, Key Vault | When the company moves to Azure. Steps 1 to 12 and "A second app" below |

Because the apps are independent, you can start with (a) and later move either app to (b) or
(c) with a database restore and an address change; nothing in the code assumes where the other
one is. Windows Server details for (a) and (b) are in "On-premises Windows Server".

### Reference: what each app needs

Names and example values only. Real values go in `apps/<app>/.env` on a server, or in Key Vault
references on Azure (never in the repository). The full list with comments is each app's
`.env.example`. In production **both refuse to start** with anything mocked, a demo database, a
`CHANGE_ME` value, a session secret under 32 characters or an `http://` address.

| Setting | Portal (`apps/portal`) | IT Helpdesk (`apps/helpdesk`) |
| --- | --- | --- |
| `NODE_ENV` | `production` | `production` |
| `PORT` | `3000` | `3001` |
| `APP_BASE_URL` | `https://portal.example.com` | `https://helpdesk.example.com` |
| `DATABASE_URL` | `sqlserver://db01:1433;database=mgportal;user=portal_app;password={...};encrypt=true;trustServerCertificate=false` | `sqlserver://db01:1433;database=mghelpdesk;user=helpdesk_app;password={...};encrypt=true;trustServerCertificate=false` |
| `MIGRATE_DATABASE_URL` (deploy step only, never the running app) | the `portal_migrate` login | the `helpdesk_migrate` login |
| `SESSION_SECRET` | 48 random bytes, its own | 48 random bytes, its own, not the portal's |
| Session cookie | `mgp.sid` | `mgh.sid` |
| `AUTH_MODE` | `entra` | `entra` |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | the registration's | the same registration's (or its own, see "Production sign-in") |
| `GRAPH_MODE` / `GRAPH_MAIL_MODE` | `real` | `real` (`GRAPH_MAIL_MODE`) |
| `GRAPH_DIRECTORY_MODE` | `real` | `real` |
| `NOREPLY_MAILBOX` | `no-reply@example.com` | the same or its own mailbox |
| `PORTAL_DATA` / `HELPDESK_DATA` | `live` (the default in production) | `live` |
| `STORAGE_DRIVER`, `STORAGE_DIR` or `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER` | `azure`, `https://acct.blob.core.windows.net`, `portal-files` | `azure`, the same account, `helpdesk-files` |
| `SCAN_MODE` | `defender` | `defender` |
| `HELPDESK_URL` | `https://helpdesk.example.com` (https in production; absent: no "IT Support" link and a warning in the log) | n/a |
| `PORTAL_URL` | n/a | `https://portal.example.com` (optional; the "Back to portal" link) |
| `INITIAL_HOLDING_ADMINS` / `INITIAL_HELPDESK_ADMINS` | `first.admin@example.com` (remove once they exist) | `first.admin@example.com` (remove once they exist) |
| `TRUST_PROXY_HOPS` | `1` behind one proxy (IIS, App Service) | `1` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | optional | optional |

Each app, in the same way:

- **Database and login.** One database per app on any SQL Server (Azure SQL, Standard or Express).
  Two logins per database: `portal_app` / `helpdesk_app` (read, write, execute: nothing that
  changes the schema) and `portal_migrate` / `helpdesk_migrate` (schema changes, used only by the
  deploy step). The T-SQL is in step 5 (Azure SQL) and its local-server variant. Never run the
  apps as `sa` or as a database owner.
- **Migrations.** A step of their own, run with the migration login before the new code starts:
  `npm run db:deploy` (portal) and `npm run helpdesk:db:deploy` (helpdesk), with the
  `MIGRATE_DATABASE_URL` of that app. The running app cannot change its schema. After the first
  migration run the `DENY UPDATE, DELETE ON dbo.AuditLog` line of step 5 for the app login.
- **File storage.** Its own location: a private Blob container (`portal-files`,
  `helpdesk-files`) on Azure; on a server, a folder outside the application folder that only the
  service account can read and write (see the blockers in the on-premises section: production
  currently accepts Azure Blob only). Files are served only once their malware scan is clean.
- **HTTPS.** Required: `APP_BASE_URL` is `https://`, session cookies are `Secure`, and HSTS is
  sent. On Azure, App Service terminates TLS; on a server, IIS does.
- **Backups.** Both databases and both file stores, nightly at least, one copy off the server,
  and a restore tried once before go-live and then every quarter (step 11, and the on-premises
  section).
- **Job leases.** Each app starts its own timed jobs (portal: session pruning, nightly directory
  sync at 02:00 Cairo, pinned-announcement sweep, malware-scan sweep; helpdesk: session pruning,
  nightly sync, SLA watch every five minutes, 24-hour confirmation reminders, malware-scan
  sweep). Each job takes a row in its own app's `JobLease` table before it works, so with two
  instances of one app (Azure's two-instance plan, or two Node processes behind a proxy) each
  round runs on exactly one of them. The portal's leases and the helpdesk's live in different
  databases and never interfere. A single instance needs nothing.
- **Health.** `GET /api/health` (alive) and `GET /api/ready` (database and storage reachable,
  not shutting down) on each app: point the load balancer, App Service health check or
  monitoring at `/api/ready`.


## Option (c): one Azure App Service each

Steps 1 to 12 set up the portal; "A second app: the IT Helpdesk" adds the helpdesk beside it.
First, what you will build:

| Piece                | Azure service                            | Why                                                                |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| The portal           | App Service, Linux, Node 24 LTS, 2 instances | Serves the pages and the API                                       |
| Database             | Azure SQL Database                       | All data, sessions, audit log                                      |
| Uploaded files       | Storage account, one private Blob container each | Portal: logos, covers, room photos. Helpdesk: ticket attachments |
| Malware scanning     | Microsoft Defender for Storage           | Scans every upload; the portal serves a file only once it is clean |
| Secrets              | Key Vault                                | Database passwords, session secret, Entra client secret            |
| Identity for the app | System-assigned managed identity         | The app reaches Key Vault and Storage with no stored key           |
| Sign-in and mail     | Entra ID app registration, Microsoft Graph | Staff sign-in, directory sync, room calendars, email               |
| Monitoring           | Application Insights + Log Analytics     | Requests, errors, background job runs, logs                        |

## Before you start

- An Azure subscription where you are **Owner** (role assignments are needed).
- Rights in the `mgholding` Entra tenant to register an application and grant admin consent.
- Access to the DNS zone for the portal's address (this guide uses `portal.mgholding.example`;
  replace it everywhere).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.60 or newer, and Node.js 24.
- A password manager to hold what you generate until it is in Key Vault. Never email a secret.

Open a terminal (bash; on Windows use Git Bash or Azure Cloud Shell) and set the names once.
Storage account and Key Vault names must be unique in all of Azure, so add a short suffix.

```bash
az login
az account set --subscription "<subscription name or id>"

LOCATION=southafricanorth
RG=rg-mgportal-prod
APP=mgportal-prod                 # becomes https://mgportal-prod.azurewebsites.net
PLAN=plan-mgportal-prod
SQLSERVER=sql-mgportal-prod-<suffix>
SQLDB=mgportal
STORAGE=stmgportalprod<suffix>    # lowercase letters and digits only, 3-24
CONTAINER=portal-files
KV=kv-mgportal-prod-<suffix>
LOGS=log-mgportal-prod
AI=appi-mgportal-prod
DOMAIN=portal.mgholding.example
```

## Step 1. Resource group

```bash
az group create --name $RG --location $LOCATION
```

Check: `az group show -n $RG --query location` prints `southafricanorth`.

## Step 2. Monitoring

```bash
az monitor log-analytics workspace create -g $RG -n $LOGS -l $LOCATION --retention-time 90
az extension add --name application-insights
az monitor app-insights component create -g $RG -a $AI -l $LOCATION \
  --workspace $(az monitor log-analytics workspace show -g $RG -n $LOGS --query id -o tsv)
```

`--retention-time 90` is the log retention this project settled on (docs/SECURITY-CHECKLIST.md,
L7): 90 days of application logs. The audit trail is not in these logs: it is the `AuditLog`
table in the database and is kept.

## Step 3. App Service

```bash
az appservice plan create -g $RG -n $PLAN -l $LOCATION --is-linux --sku P0v3 --number-of-workers 2
az webapp list-runtimes --os linux | grep -i node      # confirm the exact Node 24 name
az webapp create -g $RG -p $PLAN -n $APP --runtime "NODE:24-lts"
az webapp identity assign -g $RG -n $APP                # the managed identity
az webapp update -g $RG -n $APP --https-only true --client-affinity-enabled false
az webapp config set -g $RG -n $APP \
  --always-on true --http20-enabled true --min-tls-version 1.2 --ftps-state Disabled \
  --startup-file "node apps/portal/backend/src/server.js" \
  --generic-configurations '{"healthCheckPath": "/api/ready"}'

PRINCIPAL=$(az webapp identity show -g $RG -n $APP --query principalId -o tsv)
```

- **Two instances** is deliberate: one can be restarted or replaced with nobody noticing.
  Sessions are in the database, so affinity (sticky sessions) is switched off. Background jobs
  run on one instance per round by a lease in the database.
- **Health check path `/api/ready`**: App Service stops sending traffic to an instance whose
  database or storage check fails, and to one that is shutting down.
- Leave **TRUST_PROXY_HOPS** at its default of 1. If Azure Front Door or an Application Gateway
  is ever put in front of the app, set it to 2, or sign-in rate limiting will see the proxy as
  the client.

## Step 4. Azure SQL

```bash
az sql server create -g $RG -n $SQLSERVER -l $LOCATION \
  --enable-ad-only-auth false \
  --external-admin-principal-type User \
  --external-admin-name "<your Entra sign-in name>" \
  --external-admin-sid "$(az ad signed-in-user show --query id -o tsv)" \
  --admin-user sqladmin-breakglass --admin-password "<generate 32+ characters; store in the password manager>" \
  --minimal-tls-version 1.2
az sql db create -g $RG -s $SQLSERVER -n $SQLDB --service-objective S2 \
  --backup-storage-redundancy Geo --collation SQL_Latin1_General_CP1_CI_AS
# Let Azure services (the web app) reach the server; nothing else from the internet.
az sql server firewall-rule create -g $RG -s $SQLSERVER -n AllowAzureServices \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

The collation is the one the local databases were built with: Arabic text is stored in
`NVARCHAR` columns and does not depend on it.

Stronger, when there is time: a virtual network, a private endpoint for the SQL server and
VNet integration on the web app, then remove the firewall rule. Not needed to go live.

## Step 5. Two database logins (least privilege)

The portal runs as a login that can **read, write and execute, and nothing else**: it cannot
create, alter or drop a table, and it cannot switch off the trigger that keeps the audit log
append-only. Schema changes are made by a second login, used only by the deploy step.

Generate two long passwords (`openssl rand -base64 36`), then connect to the **`mgportal`
database** (not `master`) as yourself, the Entra admin: Azure portal → the database → Query
editor, or `sqlcmd -S $SQLSERVER.database.windows.net -d mgportal -G`. Add a temporary firewall
rule for your own address if you connect from your machine, and remove it afterwards.

```sql
-- 1. The application: data only.
CREATE USER [portal_app] WITH PASSWORD = '<password A>';
ALTER ROLE db_datareader ADD MEMBER [portal_app];
ALTER ROLE db_datawriter ADD MEMBER [portal_app];
GRANT EXECUTE TO [portal_app];

-- 2. Migrations: may change the schema. Used by the deploy step only.
CREATE USER [portal_migrate] WITH PASSWORD = '<password B>';
ALTER ROLE db_ddladmin  ADD MEMBER [portal_migrate];
ALTER ROLE db_datareader ADD MEMBER [portal_migrate];
ALTER ROLE db_datawriter ADD MEMBER [portal_migrate];
```

After the first migration has run (step 8), run this once more as yourself. It makes the audit
log append-only for the application at the permission level too, on top of the trigger:

```sql
DENY UPDATE, DELETE ON OBJECT::dbo.AuditLog TO [portal_app];
```

Check, as yourself:

```sql
SELECT r.name AS role, m.name AS member
FROM sys.database_role_members rm
JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id
WHERE m.name IN ('portal_app', 'portal_migrate') ORDER BY member, role;
-- portal_app: db_datareader, db_datawriter.   portal_migrate: those two and db_ddladmin.
```

Not yet proven: `prisma migrate deploy` has only ever run here as a local administrator. If the
migration login is refused a permission in step 8, the error names it; grant that one
permission to `portal_migrate` (never to `portal_app`) and record it in this file.

The same on a local SQL Server (not Azure), where logins live in `master`:

```sql
USE master;   CREATE LOGIN portal_app WITH PASSWORD = '<password A>';
              CREATE LOGIN portal_migrate WITH PASSWORD = '<password B>';
USE mgportal; CREATE USER portal_app FOR LOGIN portal_app;
              CREATE USER portal_migrate FOR LOGIN portal_migrate;
-- then the ALTER ROLE / GRANT / DENY lines above, unchanged.
```

The two connection strings (a password containing `;`, `=`, `{`, `}` or a space goes in braces):

```
sqlserver://<SQLSERVER>.database.windows.net:1433;database=mgportal;user=portal_app;password={<password A>};encrypt=true;trustServerCertificate=false
sqlserver://<SQLSERVER>.database.windows.net:1433;database=mgportal;user=portal_migrate;password={<password B>};encrypt=true;trustServerCertificate=false
```

## Step 6. Storage account with malware scanning

```bash
az storage account create -g $RG -n $STORAGE -l $LOCATION --sku Standard_ZRS --kind StorageV2 \
  --allow-blob-public-access false --min-tls-version TLS1_2 --https-only true \
  --allow-shared-key-access false
az storage account blob-service-properties update -g $RG --account-name $STORAGE \
  --enable-delete-retention true --delete-retention-days 14 --enable-versioning true
az storage container create --account-name $STORAGE -n $CONTAINER --auth-mode login --public-access off

# The app's identity: read, write, delete blobs and read their index tags (the scan verdict).
az role assignment create --assignee-object-id $PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Owner" \
  --scope "$(az storage account show -g $RG -n $STORAGE --query id -o tsv)/blobServices/default/containers/$CONTAINER"
```

(If `Standard_ZRS` is refused in this region, use `Standard_LRS`. You need the
"Storage Blob Data Contributor" role on yourself to create the container with `--auth-mode login`.)

- **Private**: public access is off for the whole account, key access is off, and the portal
  never creates sharing links. A file leaves only through the portal, after it has checked who
  is asking.
- "Storage Blob Data Owner" is used, scoped to this one container, because reading a blob's
  index tags needs it; "Contributor" alone cannot read the scan verdict.

**Turn on Defender for Storage with on-upload malware scanning.** Azure portal → the storage
account → **Microsoft Defender for Cloud** → **Enable on storage account** → switch **On-upload
malware scanning** on → set the monthly cap (50 GB is far more than the portal uploads) → Save.
Leave "sensitive data discovery" off. The CLI equivalent is believed to be the following; if it
is rejected, use the portal:

```bash
az security defender-for-storage create -g $RG --storage-account $STORAGE \
  --is-enabled true --malware-scanning-on-upload true --cap-gb-per-month 50 \
  --sensitive-data-discovery false
```

Two things to confirm in the portal while you are there, because they could not be checked from
here: that on-upload malware scanning is offered in South Africa North, and that scan results
are written as **blob index tags** (the default). The portal reads the tag
`Malware Scanning scan result`, whose values are `No threats found` and `Malicious`. If the
region does not offer scanning, stop and tell the developers: production will not start
without it (`SCAN_MODE=defender` is required).

How it behaves: a new upload is "being checked" for a few seconds to a few minutes and cannot
be downloaded; then it is either available, or blocked and deleted, with a notification to the
person who uploaded it and to the IT leads.

## Step 7. Entra app registration

In the Entra admin centre → App registrations → New registration:

1. Name `MG Holding Portal`; accounts in this organisational directory only.
2. Redirect URI, type **Web**: `https://portal.mgholding.example/auth/callback`.
   Front-channel logout is not used.
3. Certificates & secrets → New client secret (12 months). Copy the value now; put a renewal
   reminder in the IT calendar a month before it expires.
4. API permissions (Microsoft Graph), then **Grant admin consent**: the list is in the header of
   `backend/src/integrations/graph/real.js` and `docs/DECISIONS.md` (sign-in: `openid`,
   `profile`, `email`; directory sync: `User.Read.All`; rooms: `Place.Read.All`,
   `Calendars.Read`, `Calendars.ReadWrite`; mail: `Mail.Send`, limited to the no-reply mailbox
   with an application access policy).
   The helpdesk's redirect URI is added to the same registration ("Production sign-in" below).
5. Note the **Directory (tenant) ID** and **Application (client) ID**.

This part has never been run against the real tenant; expect to work through it with the
developers the first time.

## Step 8. Key Vault and app settings

```bash
az keyvault create -g $RG -n $KV -l $LOCATION --enable-rbac-authorization true \
  --enable-purge-protection true --retention-days 90
KVID=$(az keyvault show -g $RG -n $KV --query id -o tsv)
az role assignment create --assignee-object-id $PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope $KVID
# Yourself, to write the secrets:
az role assignment create --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --role "Key Vault Secrets Officer" --scope $KVID
```

Put the secrets in. Type each value at the prompt so it does not land in your shell history:

```bash
put() { read -r -s -p "$1: " v; echo; az keyvault secret set --vault-name $KV -n "$1" --value "$v" -o none; }
put DATABASE-URL            # the portal_app connection string from step 5
put MIGRATE-DATABASE-URL    # the portal_migrate connection string
put SESSION-SECRET          # node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
put ENTRA-CLIENT-SECRET     # from step 7
put APPINSIGHTS-CONNECTION  # az monitor app-insights component show -g $RG -a $AI --query connectionString -o tsv
```

Now the app settings. Secrets are **Key Vault references**: the setting holds a pointer, App
Service fetches the value with the managed identity, and the secret itself is never in the
app's configuration.

```bash
ref() { echo "@Microsoft.KeyVault(SecretUri=https://$KV.vault.azure.net/secrets/$1/)"; }
az webapp config appsettings set -g $RG -n $APP --settings \
  NODE_ENV=production \
  APP_BASE_URL=https://$DOMAIN \
  AUTH_MODE=entra GRAPH_MODE=real \n  HELPDESK_URL=https://<helpdesk host> \
  ENTRA_TENANT_ID=<tenant id> ENTRA_CLIENT_ID=<client id> \
  NOREPLY_MAILBOX=<no-reply address in the tenant> \
  STORAGE_DRIVER=azure SCAN_MODE=defender \
  AZURE_STORAGE_ACCOUNT_URL=https://$STORAGE.blob.core.windows.net \
  AZURE_STORAGE_CONTAINER=$CONTAINER \
  WEBSITE_RUN_FROM_PACKAGE=1 \
  DATABASE_URL="$(ref DATABASE-URL)" \
  SESSION_SECRET="$(ref SESSION-SECRET)" \
  ENTRA_CLIENT_SECRET="$(ref ENTRA-CLIENT-SECRET)" \
  APPLICATIONINSIGHTS_CONNECTION_STRING="$(ref APPINSIGHTS-CONNECTION)"
```

Check: Azure portal → the web app → Environment variables: each of the four referenced
settings shows a green tick ("Key Vault Reference"). A red cross means the identity cannot read
the vault (wait five minutes for the role assignment, then restart).

**The portal refuses to start in production** if anything is still a development value: mock
sign-in, mock Graph, mock scanner, local storage, a `CHANGE_ME`, a session secret under 32
characters, a missing or `http://` `APP_BASE_URL`, or a missing `NODE_ENV=production`. The log
stream then shows one line naming the setting (never its value). That is the first place to
look if the site shows "Application Error".

Optional settings and their defaults are in `.env.example` (session lifetimes 8 h idle and 12 h
absolute, rate limits, `TRUST_PROXY_HOPS`).

## Step 9. First deployment

Migrations are **a separate step from starting the app**, run with the migration login. The
app never changes the schema.

By hand, from a clean checkout of the release on your machine:

```bash
npm ci                      # also generates the helpdesk's client (its postinstall)
npx prisma generate --schema apps/portal/backend/prisma/schema.prisma

# 1. Schema. (Add a temporary SQL firewall rule for your address; remove it after.)
MIGRATE_DATABASE_URL="$(az keyvault secret show --vault-name $KV -n MIGRATE-DATABASE-URL --query value -o tsv)" \
  npm run db:deploy
# Then, once: the DENY statement in step 5, and the first data (companies and domains):
#   see docs/ADD-A-COMPANY.md; `npm run db:seed` loads the development sample data and
#   must NOT be run against production.

# 2. Code: the root files, node_modules, the shared package and this app. zip follows the
#    workspace links in node_modules/@mg, so the apps' copies there are left out.
npm prune --omit=dev
zip -r release.zip package.json package-lock.json node_modules packages/shared apps/portal \
  -x "apps/portal/backend/tests/*" "apps/portal/tests/*" "apps/portal/backend/mock/outbox/*" \
     "node_modules/@mg/helpdesk/*" "node_modules/@mg/portal/*"
az webapp deploy -g $RG -n $APP --src-path release.zip --type zip
```

The package must be built on Linux x64 (or in the GitHub workflow, below), because the Prisma
engine inside `node_modules` is built for the machine that ran `npm ci`. Building on Windows and
deploying to Linux fails at the first database query.

Routine releases use the workflow in `.github/workflows/deploy.yml.disabled` (build, test,
migrate, deploy). It is committed switched off; the file's header says how to enable it.

Check, in this order:

1. `curl -s https://$APP.azurewebsites.net/api/health` → `{"status":"ok"}`
2. `curl -s https://$APP.azurewebsites.net/api/ready` →
   `{"status":"ready","checks":{"database":"ok","storage":"ok"}}`. `"database":"failed"`: the
   connection string or firewall. `"storage":"failed"`: the storage role assignment or the
   container name.
3. Sign in with your own account.
4. **Malware scanning.** The portal's uploads are images (logos, covers, room photos), checked by
   signature and then scanned. To see the scan end to end use the helpdesk, which takes any file
   (after "A second app" below): raise a test ticket and attach a small text file: within a few minutes
   it becomes downloadable. Then attach the EICAR test file (a harmless standard test string,
   <https://www.eicar.org/download-anti-malware-testfile/>, saved as `eicar.txt`): it must end
   up "Blocked", you and the IT leads must get a notification, and the blob must be gone from
   the container. If a clean file stays "being checked" for more than 15 minutes, look at the
   blob's index tags in the portal and send the developers the tag's exact name and value.
5. Application Insights → Transaction search shows requests, and custom events named `job.run`
   within five minutes.

## Step 10. Custom domain and HTTPS

1. In DNS create `CNAME portal → mgportal-prod.azurewebsites.net` and
   `TXT asuid.portal → <the value from>`
   `az webapp show -g $RG -n $APP --query customDomainVerificationId -o tsv`.
2. Bind the name and a free managed certificate:

```bash
az webapp config hostname add -g $RG --webapp-name $APP --hostname $DOMAIN
az webapp config ssl create -g $RG -n $APP --hostname $DOMAIN
THUMB=$(az webapp config ssl list -g $RG --query "[?subjectName=='$DOMAIN'].thumbprint" -o tsv)
az webapp config ssl bind -g $RG -n $APP --certificate-thumbprint $THUMB --ssl-type SNI
```

3. `APP_BASE_URL` (step 8) and the Entra redirect URI (step 7) must both be
   `https://portal.mgholding.example` exactly, or sign-in fails with a redirect mismatch.

HTTP is redirected to HTTPS by App Service, and the portal sends HSTS (one year), so browsers
stop trying HTTP at all. The certificate renews itself.

Check: <https://www.ssllabs.com/ssltest/> grade A; <https://securityheaders.com> grade A or A+.

## Step 11. Backups, and a restore test

```bash
# Point-in-time restore: any second of the last 14 days.
az sql db str-policy set -g $RG -s $SQLSERVER -n $SQLDB --retention-days 14 --diffbackup-hours 12
# Long-term: weekly for 5 weeks, monthly for 12 months, yearly for 3 years.
az sql db ltr-policy set -g $RG -s $SQLSERVER -n $SQLDB \
  --weekly-retention P5W --monthly-retention P12M --yearly-retention P3Y --week-of-year 1
```

Files: soft delete (14 days) and versioning were switched on in step 6. Key Vault: soft delete
and purge protection in step 8. Logs: 90 days (step 2).

**A backup that has never been restored is a hope, not a backup.** Do this once before go-live
and then every quarter; write the date and the result in the IT log:

```bash
# 1. Restore the database as it was one hour ago, under another name.
az sql db restore -g $RG -s $SQLSERVER -n $SQLDB --dest-name mgportal-restoretest \
  --time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)"
# 2. In the Query editor on mgportal-restoretest:
#      SELECT COUNT(*) FROM UserProfile; SELECT COUNT(*) FROM Announcement;
#      SELECT TOP 1 at FROM AuditLog ORDER BY at DESC;
#    The counts match production and the newest audit row is about an hour old.
# 3. Delete the copy.
az sql db delete -g $RG -s $SQLSERVER -n mgportal-restoretest --yes
# 4. Files: delete one test blob in the container, then restore it:
#    portal → container → "Show deleted blobs" → Undelete.
```

Note how long step 1 took: that is the realistic recovery time to quote to management.

## Step 12. Alerts

In Application Insights → Alerts, at least these three, to the IT on-call address:

- Availability test on `https://portal.mgholding.example/api/ready` every 5 minutes from two
  locations; alert when it fails twice in a row.
- Failed requests (5xx) above 10 in 5 minutes.
- Custom event `job.run` with `outcome = failed`, any in 15 minutes.

## What it costs per month

Estimates in US dollars from Azure's list prices as the developers recall them, **not a quote**:
South Africa North is dearer than Europe, prices change, and the company may have an agreement.
Price the same list in the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/)
with the region set to South Africa North before budgeting.

| Item                                             | Recommended                          | About (USD/month) |
| ------------------------------------------------ | ------------------------------------ | ----------------- |
| App Service plan, Linux, P0v3 × 2 instances      | 1 vCPU, 4 GB each                    | 150 – 180         |
| Azure SQL Database, Standard S2 (50 DTU), geo backup | 250 GB included                      | 80 – 100          |
| Storage account (a few GB, ZRS, versioning)      |                                      | 1 – 5             |
| Defender for Storage + malware scanning          | per account, plus per GB scanned     | 10 – 15           |
| Key Vault                                        | a few thousand operations            | under 1           |
| Application Insights + Log Analytics, 90 days    | first 5 GB a month are free          | 0 – 20            |
| Managed certificate, managed identity            |                                      | 0                 |
| **Total**                                        |                                      | **about 240 – 320** |

A cheaper start for a pilot (one B2 instance, SQL S1): roughly 90 – 120 a month, at the price of
no spare instance and slower reports. Microsoft 365 licences and Entra ID are not included: the
company already has them.

## A second app: the IT Helpdesk

The helpdesk is its own App Service with its own database, container and settings
(docs/DECISIONS.md D144). It reuses the plan, the SQL server, the storage account, Key Vault,
Application Insights and the Entra app registration. Names below: `HD_APP` (for example
`mgh-helpdesk`), database `mghelpdesk`, container `helpdesk-files`.

1. **App Service** (as step 3, on the same plan): `az webapp create -g $RG -p $PLAN -n $HD_APP
   --runtime "NODE:24-lts"`, the identity, https only, affinity off, always on, health check
   `/api/ready`, and `--startup-file "node apps/helpdesk/backend/src/server.js"`.
2. **Database** (as steps 4 and 5): `az sql db create ... -n mghelpdesk`, with two logins of
   its own (`helpdesk_app`, `helpdesk_migrate`) and the same DENY on AuditLog. The helpdesk
   never reads the portal's database.
3. **Storage** (as step 6): a second private container, `helpdesk-files`, in the same account
   (Defender scans the whole account), and the same role assignments for `$HD_APP`'s identity.
4. **Entra** (as step 7): add `https://<helpdesk host>/auth/callback` as a redirect URI on the
   same registration (MGH-Portal-Web), and `https://<helpdesk host>/login.html` for sign-out.
   No new permission: sign-in, `User.Read.All` (sync) and `Mail.Send` are the portal's.
5. **Settings** (as step 8), secrets as Key Vault references (`HD-DATABASE-URL`,
   `HD-SESSION-SECRET`; the same `ENTRA-CLIENT-SECRET`):

   | Setting | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | the `helpdesk_app` login on `mghelpdesk` |
   | `SESSION_SECRET` | its own, 32+ characters (not the portal's) |
   | `APP_BASE_URL` | `https://<helpdesk host>` |
   | `AUTH_MODE` | `entra` |
   | `GRAPH_MAIL_MODE`, `GRAPH_DIRECTORY_MODE` | `real` |
   | `HELPDESK_DATA` | `live` (the default in production) |
   | `NOREPLY_MAILBOX` | the sending mailbox |
   | `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | the registration's |
   | `STORAGE_DRIVER`, `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER` | `azure`, the account, `helpdesk-files` |
   | `SCAN_MODE` | `defender` |
   | `INITIAL_HELPDESK_ADMINS` | the first administrator's email (remove once they exist) |
   | `PORTAL_URL` | `https://<portal host>` (the "Back to portal" link; optional) |
   | `APPLICATIONINSIGHTS_CONNECTION_STRING` | the same as the portal's |

   Production refuses to start with anything mocked or with demo data, as the portal does.
6. **First deployment** (as step 9), from the same clean checkout and `npm ci`:

   ```bash
   MIGRATE_DATABASE_URL="<helpdesk_migrate login>" npm run helpdesk:db:deploy
   # Companies, domains and the IT team's defaults (D141), then the people, then the team:
   #   npm run helpdesk:db:setup-live; npm run helpdesk:sync:users;
   #   npm run helpdesk:db:setup-live -- --it-leads <emails> --it-members <emails>
   zip -r helpdesk.zip package.json package-lock.json node_modules packages/shared apps/helpdesk \
     -x "apps/helpdesk/backend/tests/*" "apps/helpdesk/tests/*" "apps/helpdesk/backend/mock/outbox/*" \
        "node_modules/@mg/helpdesk/*" "node_modules/@mg/portal/*"
   az webapp deploy -g $RG -n $HD_APP --src-path helpdesk.zip --type zip
   ```

   `apps/helpdesk/backend/generated/client` (its Prisma client, made by `npm ci` on Linux) must
   be in the zip. Check `/api/health`, `/api/ready`, then sign in.

The portal links to it with its `HELPDESK_URL` setting (step 8), and sends old ticket links
there. The portal's old helpdesk tables stay in its database for now: see "Retiring the
portal's helpdesk tables".

## On-premises Windows Server (options a and b)

Our likely first target. This is a plan written from how the apps behave; **it has not been run
on a real server**, and the section "What still blocks production on-premises" must be cleared
before it can be. Everything here is done once per server; for option (b) do the helpdesk parts
on the second server and leave the portal's out.

Assumed: Windows Server 2022, 4 vCPU and 8 GB for both apps and SQL Server Express (more for
Standard), a data disk `D:`, outbound HTTPS to `login.microsoftonline.com` and
`graph.microsoft.com` (sign-in, directory, mail), and inbound HTTPS from the office network and
the sites. Hostnames in this guide: `portal.example.com`, `helpdesk.example.com`; replace them.

### 1. Node.js

1. Install **Node.js 24 LTS** (the Windows `.msi` from nodejs.org) for all users. Check in a new
   PowerShell: `node -v` prints `v24.x`.
2. Create a local account for the services, for example `svc-mg` (not an administrator, no
   interactive logon). Make a folder per app and a folder for data:

```powershell
New-Item -ItemType Directory D:\mg\portal, D:\mg\helpdesk, D:\mg\data\portal-files, D:\mg\data\helpdesk-files, D:\mg\logs, D:\mg\backups
```

3. Put a release in each app folder: the root `package.json` and `package-lock.json`,
   `node_modules`, `packages/shared` and `apps/<app>` (the zip built in step 9 of the Azure steps
   is the same thing; unzip it into `D:\mg\<app>`). On the server run `npm ci --omit=dev` once if
   `node_modules` was built on another operating system, so Prisma gets its Windows engine.
4. Give `svc-mg` read on `D:\mg\portal` and `D:\mg\helpdesk`, and change (read, write) on
   `D:\mg\data` and `D:\mg\logs`. Nothing else.
5. Each app reads `apps\<app>\.env` next to its code. Create it from `.env.example` with the
   values from the table above, then take everyone else off it:

```powershell
icacls D:\mg\portal\apps\portal\.env /inheritance:r /grant "svc-mg:(R)" "Administrators:(F)"
icacls D:\mg\helpdesk\apps\helpdesk\.env /inheritance:r /grant "svc-mg:(R)" "Administrators:(F)"
```

### 2. SQL Server

- **Edition.** **SQL Server Standard**, or **Express** (free, production use allowed). **Developer
  edition is licensed for development and test only and must not run production data.** Express
  limits to know: 10 GB per database, about 1.4 GB of memory for the engine, one socket and four
  cores, and no SQL Server Agent (so backups are scheduled with Windows Task Scheduler, below).
  Both apps together are far below these limits for a long time; check the database sizes every
  quarter. Standard has no such limits and has the Agent.
- **Network.** In SQL Server Configuration Manager enable TCP/IP and give the instance a fixed
  port (1433) so the connection string needs no instance name. If SQL Server runs on the same
  machine as the apps, bind nothing outside: Windows Firewall keeps 1433 closed to the network.
- **Databases and logins.** Create `mgportal` and `mghelpdesk` and the four logins as in step 5
  (the "local SQL Server" T-SQL variant). Use strong generated passwords. Connection string, one
  per app (a password containing `;`, `=`, `{`, `}` or a space goes in braces):

```
sqlserver://localhost:1433;database=mgportal;user=portal_app;password={...};encrypt=true;trustServerCertificate=true
```

  `trustServerCertificate=true` is acceptable only for a server talking to itself over the
  loopback; to a different SQL Server host use a certificate its clients trust and set it to
  `false`.
- **Recovery model.** Standard: `FULL` plus log backups every hour if losing an hour is too
  much; Express: `SIMPLE` with a nightly full backup (below), so up to a day of changes can be
  lost. Decide with the business which it is.
- **Migrations**, from the release folder, with the migration login:

```powershell
$env:MIGRATE_DATABASE_URL = "sqlserver://localhost:1433;database=mgportal;user=portal_migrate;password={...};encrypt=true;trustServerCertificate=true"
npm run db:deploy
$env:MIGRATE_DATABASE_URL = "sqlserver://localhost:1433;database=mghelpdesk;user=helpdesk_migrate;password={...};encrypt=true;trustServerCertificate=true"
npm run helpdesk:db:deploy
Remove-Item Env:MIGRATE_DATABASE_URL
```

  Then, once per database, the `DENY UPDATE, DELETE ON OBJECT::dbo.AuditLog` line for the app
  login (step 5). First data (companies, domains, the IT team, the people) follows
  docs/ADD-A-COMPANY.md: `npm run db:live:setup`, `npm run helpdesk:db:setup-live`,
  `npm run sync:users`, `npm run helpdesk:sync:users`.

### 3. Run each app as a Windows service, restarted when it stops

Use a service wrapper: **NSSM** (nssm.cc) is the simplest; WinSW does the same from an XML
file. With NSSM, from an elevated PowerShell (one service per app):

```powershell
$node = "C:\Program Files\nodejs\node.exe"
nssm install MGPortal $node "apps\portal\backend\src\server.js"
nssm set MGPortal AppDirectory D:\mg\portal
nssm set MGPortal ObjectName ".\svc-mg" "<the account's password>"
nssm set MGPortal AppEnvironmentExtra NODE_ENV=production
nssm set MGPortal Start SERVICE_AUTO_START
nssm set MGPortal AppExit Default Restart          # restart whenever the process ends
nssm set MGPortal AppRestartDelay 5000             # wait 5 s, so a crash loop is not a spin
nssm set MGPortal AppThrottle 10000                # a start that ends within 10 s counts as failing
nssm set MGPortal AppStopMethodConsole 15000       # Ctrl+C first: the app finishes requests in flight
nssm set MGPortal AppStdout D:\mg\logs\portal.log
nssm set MGPortal AppStderr D:\mg\logs\portal.log
nssm set MGPortal AppRotateFiles 1
nssm set MGPortal AppRotateBytes 10485760
nssm start MGPortal
# The helpdesk: the same, as MGHelpdesk, on apps\helpdesk\backend\src\server.js in D:\mg\helpdesk.
```

Also set Windows' own recovery for each service (Services → the service → Recovery: restart on
first, second and later failures; reset the count after one day), and make `MGPortal` depend on
the SQL Server service (`sc config MGPortal depend= MSSQLSERVER`; for an Express named instance
the service is `MSSQL$SQLEXPRESS`) so a reboot starts them in order. A restart after a crash
loses no data: sessions and all state are in the database.

Windows Firewall: **do not open 3000 or 3001** to the network. The apps listen on every address
of the machine, and only IIS (on the same machine) should reach them.

Check: `Invoke-WebRequest http://localhost:3000/api/ready` and `:3001/api/ready` answer 200.

### 4. IIS as the reverse proxy, with HTTPS

1. Install the **IIS** role, then **URL Rewrite** and **Application Request Routing (ARR)**
   (Web Platform Installer or the downloads on iis.net). In IIS Manager → the server →
   Application Request Routing Cache → Server Proxy Settings → tick *Enable proxy*.
2. Add **one site per app**, each with its own hostname binding on port 443 and a certificate
   (from the company's certificate authority, or a public one such as Let's Encrypt via
   win-acme). A third site on port 80 for both hostnames only redirects to HTTPS.
3. Allow the forwarded-protocol server variable: site → URL Rewrite → View Server Variables →
   Add `HTTP_X_FORWARDED_PROTO`. The apps trust one proxy (`TRUST_PROXY_HOPS=1`, the default)
   and use it to see that the request came over HTTPS; without it the secure session cookie is
   not set and sign-in loops.
4. Each site's `web.config` (the portal's; the helpdesk's is the same with port 3001):

```xml
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="To the portal" stopProcessing="true">
          <match url="(.*)" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
          </serverVariables>
          <action type="Rewrite" url="http://localhost:3000/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <!-- The apps compress and cache their own files; IIS must not do it twice. -->
    <urlCompression doStaticCompression="false" doDynamicCompression="false" />
    <security>
      <!-- Uploads are at most 10 MB (ticket attachments); allow a little more. -->
      <requestFiltering>
        <requestLimits maxAllowedContentLength="15728640" />
      </requestFiltering>
    </security>
  </system.webServer>
</configuration>
```

   And in the server's ARR settings keep *Preserve client IP in the following header* on
   `X-Forwarded-For` (the apps read the client address from it), set the proxy timeout to 60
   seconds, and leave response buffering at its default.
5. Check: `https://portal.example.com/api/ready` and `https://helpdesk.example.com/api/ready`
   answer `{"status":"ok"…}`-style JSON with a valid certificate. The security headers (CSP, HSTS)
   come from the apps and pass through the proxy. Then sign in (after the next section).

### 5. Nightly database and file backups

Express has no Agent, so Windows Task Scheduler runs a script; on Standard use an Agent job or
a maintenance plan and the same commands. `D:\mg\backup.ps1`, run nightly at 01:30 as an
account that can back up the databases (a SQL login or Windows account with the `db_backupoperator`
role on both, never the app login):

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
foreach ($db in "mgportal", "mghelpdesk") {
  $file = "D:\mg\backups\$db-$stamp.bak"
  # Standard and Enterprise can add WITH COMPRESSION; leave it out on Express.
  sqlcmd -S localhost -E -b -Q "BACKUP DATABASE [$db] TO DISK = N'$file' WITH CHECKSUM, INIT"
  if ($LASTEXITCODE -ne 0) { throw "Backup of $db failed" }
  sqlcmd -S localhost -E -b -Q "RESTORE VERIFYONLY FROM DISK = N'$file' WITH CHECKSUM"
  if ($LASTEXITCODE -ne 0) { throw "Backup of $db did not verify" }
}
# Uploaded files: a mirror of the two data folders, kept as a dated copy.
robocopy D:\mg\data "D:\mg\backups\files-$stamp" /MIR /R:2 /W:5 /NP /NFL /NDL
# Keep 14 days here.
Get-ChildItem D:\mg\backups | Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) | Remove-Item -Recurse -Force
```

- **Off the server.** A second copy somewhere else (another server's share, or a cloud storage
  account) every night: a backup on the machine that fails is not a backup. Keep at least 30
  daily copies there and a monthly one for a year.
- **Restore test**, before go-live and every quarter: restore the latest `.bak` under another
  name (`RESTORE DATABASE [mgportal_restoretest] FROM DISK = ... WITH MOVE ...`), run the three
  queries of step 11 (counts, newest audit row), and delete the copy. Restore one file from the
  file mirror too.
- Task Scheduler's history must show success; a failed run should email IT (a task that sends
  mail on failure, or monitoring that watches the newest `.bak`'s age).

### What still blocks production on-premises

The production guard (`packages/shared/server/config/env-core.js`) refuses to start the apps
with development values. On a server inside the company three of its rules cannot be met yet.
**Nothing here is built; it is listed so that it can be decided and done before go-live.**

1. **Malware scanning.** The guard requires `SCAN_MODE=defender`, and today the only scanner is
   the Azure one: Microsoft Defender for Storage tags each blob in an Azure storage account
   with its verdict. `SCAN_MODE=mock` is refused in production, rightly: it passes everything
   but a test file. On-premises needs a **local Microsoft Defender scanner**: a new scan mode
   that, for each upload, runs Defender on the server (`MpCmdRun.exe -Scan -ScanType 3 -File
   <path>`, or the Defender APIs) and records clean / infected in the `FileScan` table, which the
   existing gate (`lib/file-scan.js`) and the sweep job already understand. Until it exists,
   no uploaded file would ever be served.
2. **File storage.** The guard also requires `STORAGE_DRIVER=azure` in production, because
   today the local folder adapter exists only for development. A server needs the local adapter
   (`STORAGE_DRIVER=local`, `STORAGE_DIR=D:\mg\data\portal-files`) allowed in production, which
   is a small change to the guard that goes with item 1 (a scanned local folder). Not in the
   brief's list; found while writing this section.
3. **Real mail.** `GRAPH_MAIL_MODE=real` (and `GRAPH_MODE=real`) needs a **real no-reply
   mailbox** in the tenant (`NOREPLY_MAILBOX`) and the app registration's **`Mail.Send`**
   application permission with admin consent, ideally limited to that one mailbox with an
   application access policy. Mock mail is refused in production. Until then the bell works and
   no email is sent. The same registration needs the directory permission `User.Read.All` for
   the nightly sync.
4. **Sign-in has never run against the real tenant** in a hosted setting; allow time for the
   first Entra sign-in on the server (redirect URIs below).

When 1 and 2 are done the on-premises settings differ from Azure's only in
`STORAGE_DRIVER`/`STORAGE_DIR`/`SCAN_MODE`, the connection strings, and `TRUST_PROXY_HOPS=1`
(IIS).

## Production sign-in (Entra)

Both apps use Entra ID with the code flow on the server; the browser never holds a token. Each
app builds its redirect address from its own `APP_BASE_URL`. On the app registration (Entra
admin centre → App registrations → Authentication → Web) register, **exactly as the apps
send them** (scheme, host, no trailing slash, case):

| App | Redirect URI | Sign-out landing |
| --- | --- | --- |
| Portal | `https://portal.<domain>/auth/callback` | `https://portal.<domain>/login.html` |
| IT Helpdesk | `https://helpdesk.<domain>/auth/callback` | `https://helpdesk.<domain>/login.html` |

(`http://localhost:3000/auth/callback` and `http://localhost:3001/auth/callback` stay for
developers; remove them from a production-only registration.) A mismatch shows as a redirect
error from Microsoft before the app is reached.

The helpdesk shares the portal's registration today (one set of `ENTRA_*` values, one client
secret to renew). **Later it can have a registration of its own**, for example `MG Holding IT
Helpdesk`, if IT wants to renew or revoke the two secrets separately, show a different name on
the consent screen, or limit what the helpdesk may do to Graph: create it with the redirect
URIs of the helpdesk row only, give it the permissions the helpdesk uses (sign-in `openid`,
`profile`, `email`; `User.Read.All` for its nightly sync; `Mail.Send` for its mail), grant
admin consent, and put its three values in `apps/helpdesk/.env`. No code changes: the app only
reads `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET`. People sign in to both
with the same work account either way, and a user must be assigned to the registration if
"assignment required" is on.

## Retiring the portal's helpdesk tables

The portal stopped using its helpdesk tables when the helpdesk became an app (D146), but
`mgportal_live` still holds them, with every ticket as it was at the move, as a safety copy
(`schema.prisma` marks the 14 models DEPRECATED). **They are not dropped by any migration that
runs by itself.** The cleanup is a separate migration, written and not applied:
`apps/portal/backend/prisma/pending-cleanup/20261022020000_drop_helpdesk_tables`.

Apply it only when **all** of these are true:

1. The IT Helpdesk has run live for some weeks (suggested: at least four) with nobody missing
   anything that exists only in the portal's copy.
2. `npm run helpdesk:migrate:from-portal -- --as <email> --verify` still says "Check passed" for
   the tickets (run it one last time first: it reads the old tables, so it cannot run after).
3. A fresh full backup of `mgportal` exists and a restore of it has been tried (step 11, or the
   on-premises backup section).

Then follow `apps/portal/backend/prisma/pending-cleanup/README.md`: remove the 14 models from
the schema, move the folder into `migrations/`, `npm run db:generate`, deploy with the
migration login, and delete the ticket attachment files from the portal's storage by hand.
Development and test databases can simply be reset (`npm run db:reset`) once the models are out
of the schema.

## Day-to-day

- **Release**: run the workflow (or step 9 by hand). Migrations first, then the code.
- **Rotate the session secret**: put the current value in a new secret `SESSION-SECRET-PREVIOUS`
  and add the app setting `SESSION_SECRET_PREVIOUS` as a reference to it; set a new
  `SESSION-SECRET`; restart. Nobody is signed out. Remove the previous one a day later.
- **Rotate a database password**: `ALTER USER [portal_app] WITH PASSWORD = '<new>';`, update the
  Key Vault secret, restart the app (Key Vault references refresh within 24 hours on their own;
  a restart is immediate).
- **Entra client secret** expires: create a new one, update `ENTRA-CLIENT-SECRET`, restart.
- **Add a company**: docs/ADD-A-COMPANY.md. No deployment needed.
- **Something is wrong**: `/api/ready` first; then App Service → Log stream; then Application
  Insights → Failures. Every error a user sees carries a request id that finds its log line.
- **Roll back**: redeploy the previous `release.zip`. Migrations are written to be additive, so
  the previous code runs on the newer schema; never restore the database to undo a release
  unless data is actually damaged.
