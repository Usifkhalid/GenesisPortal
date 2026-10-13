# Deploying the portal to Azure

For the IT person who will set this up. Follow the steps in order; each ends with a check.
Region: **South Africa North** (`southafricanorth`) for everything.

> **Status, 13 October 2026.** Nothing has been deployed yet and none of this has been run
> against a real subscription: the project has had no Azure or tenant access. The application
> side (configuration checks, Blob storage adapter, malware-scan states, health checks, job
> leases) is tested locally. Treat the `az` commands as a careful draft: where a command's exact
> flags could not be confirmed it says so, and the Azure portal path is given beside it.

## What you will build

| Piece                | Azure service                            | Why                                                                |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| The portal           | App Service, Linux, Node 24 LTS, 2 instances | Serves the pages and the API                                       |
| Database             | Azure SQL Database                       | All data, sessions, audit log                                      |
| Uploaded files       | Storage account, one private Blob container | Logos, covers, room photos, ticket attachments                     |
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
  --startup-file "node backend/src/server.js" \
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
  AUTH_MODE=entra GRAPH_MODE=real \
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
npm ci
npx prisma generate --schema backend/prisma/schema.prisma

# 1. Schema. (Add a temporary SQL firewall rule for your address; remove it after.)
MIGRATE_DATABASE_URL="$(az keyvault secret show --vault-name $KV -n MIGRATE-DATABASE-URL --query value -o tsv)" \
  npm run db:deploy
# Then, once: the DENY statement in step 5, and the first data (companies, IT team):
#   see docs/ADD-A-COMPANY.md; `npm run db:seed` loads the development sample data and
#   must NOT be run against production.

# 2. Code.
npm prune --omit=dev
zip -r release.zip backend frontend package.json package-lock.json node_modules \
  -x "backend/tests/*" "backend/mock/outbox/*"
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
4. **Malware scanning.** Raise a test ticket and attach a small text file: within a few minutes
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
#      SELECT COUNT(*) FROM UserProfile; SELECT COUNT(*) FROM Ticket;
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
