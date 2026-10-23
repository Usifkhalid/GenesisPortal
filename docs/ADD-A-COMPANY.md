# Adding a company

Adding a company to the portal is configuration, not code. This is the procedure, in the
order it must be done. Steps 1 and 2 are in Microsoft 365; steps 3 to 6 are in the portal.

Who does what:

| Step | Who |
|---|---|
| 1, 2 | A **Global Administrator** (or Domain Name Administrator) of the "mgholding" Microsoft 365 tenant |
| 3 to 6 | A portal **Holding admin** |

**The IT Helpdesk is a separate app with its own database (D144).** After step 3 here, add
the same company (same code, names, colour and mail domains) in the helpdesk too: sign in
there as its administrator → **Administration** → **Companies** → **Add company**. Its people
arrive at the helpdesk's next directory sync (nightly, or `npm run helpdesk:sync:users`).

You need: the company's code (2 to 5 capital letters, for example `TST`), its English and
Arabic names, its mail domain, its logo (PNG, JPEG or WebP, up to 512 KB) and its brand
colour as `#rrggbb`.

## 1. Add and verify the domain in Microsoft 365

1. Open the Microsoft 365 admin center → **Settings** → **Domains** → **Add domain**.
2. Enter the company's domain (for example `tst.example`) and choose how to verify it.
   The usual way is a TXT record the company's DNS administrator adds at their registrar.
3. Wait for DNS to propagate, then **Verify**. The domain shows as **Healthy** or
   **Setup in progress**.
4. When asked how to set up the domain's services, choose the option that does **not**
   move the company's mail unless that is intended. For the portal only the domain
   needs to exist in the tenant, so people can have `name@tst.example` accounts.

Check: the domain is listed with status **Healthy** (or at least **Verified**).

## 2. Create the accounts, with `companyName` set

For each person, create a user (or update the existing one) with:

- a user principal name and primary email on the company's domain;
- **Company name** (`companyName`) set to the company's name, exactly as entered in the portal in step 3. The directory sync that fills the portal's people (not built yet; see docs/PROGRESS.md) is to place people in a company by this field and by the mail domain, so set it now and keep it consistent.
- display name, job title, department, manager and office location as usual; the portal
  reads these from the directory.

Check: sign in to the Microsoft 365 admin center, open one of the accounts, and confirm the
email domain and **Company name**.

## 3. Create the company in the portal

1. Sign in to the portal as a holding admin.
2. Open **Company admin** → **Companies** → **New company**.
3. Fill in:
   - **Code**: it cannot be changed later, and it prefixes ticket numbers;
   - **Name in English** and **Name in Arabic**;
   - **Mail domains**: one per line, the primary first. A domain can belong to one
     company only. Use exactly what was verified in step 1;
   - **Logo file** (optional here; it can be added or replaced later);
   - **Accent colour**: pick it and read the verdict. The form will not save a colour the
     design system cannot make readable. The preview beside the form shows the top bar,
     a button and the current navigation item in the light and the dark theme.
4. **Create company**. A toast confirms it and the company appears in the list.

Check: the company is in the list as **Active**; open it and confirm the code, the two
names, the domain and the accent.

The portal has no tickets (D146). The IT Helpdesk is another app with its own companies:
add the company there too (see above); creating it in the helpdesk's Administration makes
sure the IT team and its categories, SLA targets, locations and canned replies exist, so the
company's people can file tickets at once. The one IT team serves every company.

## 4. Add its departments

1. **Company admin** → **Departments**. Choose the company at the top.
2. For each department, enter the English and Arabic names and **Add department**. Names
   are unique per company, in each language.

Check: the departments are listed. Their people count fills in as accounts sync from the
directory.

## 5. Assign the company admin

1. **Company admin** → **Administrators**.
2. In the company's section choose **Add**, search for the person by name (English or
   Arabic) or email, select them and **Add as administrator**. They must already exist in
   the portal as a person; until the directory sync exists that means they are in the
   seeded or imported people list.
3. A company admin manages only their company's departments and sees only its audit log.
   They cannot see other companies, assign roles or change company settings.

Check: the person appears under the company. Your own role cannot be removed from here,
and the last holding admin cannot be removed.

## 6. Check with a test sign-in

1. Ask the new company admin (or use a test account of the company) to sign in to the
   portal.
2. They should see the company's name, logo and accent colour in the top bar, and
   **Company admin** and **Audit log** under Administration.
3. In **Company admin** → **Departments** they should see only their company's departments;
   in **Audit log** only entries for their company, including the three you made above.
4. A normal user of the company should sign in and see no Administration section.

If something is wrong: a person who lands in the wrong company has the wrong **Company
name** or mail domain on their account (steps 1 and 2); a colour that was refused needs another colour; a
company that was entered wrongly can be edited (everything but the code) or deactivated
and a new one created.

## 7. Import the company's staff from HR

Once its people have signed in or the directory sync has brought them in, HR's staff list
gives them their department, job title, office, staff id, employment category and hire date,
and places holding staff who use another company's mail address.

1. Put the company's rows in `private/hr-people.csv` and its departments (English and Arabic
   names) in `private/hr-departments.csv` with the company's portal **code** in
   `company_code`. Rows for a company not in the portal yet use `PENDING_<NAME>`; they are
   listed and skipped, so the same file can be rerun once the company exists: change the
   code from `PENDING_<NAME>` to the new code.
2. `npm run import:hr -- --as <your email> --dry-run` (PORTAL_DATA=live, you must be a
   HoldingAdmin). Read `reports/hr-import-<date>.csv`: `ambiguous` rows name the possible
   accounts; `unmatched` rows (`no_microsoft_account`) are people who need a Microsoft 365
   account.
3. For a row that should match but does not, add `staff_id,email` to
   `private/hr-matches.csv`; it wins over name matching.
4. `npm run import:hr -- --as <your email>` writes it. Rerunning is safe: people are found
   again by staff id and only differences are written.

From then on company, department, job title and office are HR's: the nightly sync and
sign-in do not overwrite them (docs/DECISIONS.md D140).

## Everything is in the audit log

Creating the company, each department and each role assignment is recorded, with who did
it and what it was before and after: **Audit log** → filter by the company. Nothing here
can be deleted from the log.

## Taking a company out of service

**Company admin** → **Companies** → open the company → **Deactivate company**. Its people
are signed out at their next request and cannot sign in until it is reactivated. Nothing is
deleted.
