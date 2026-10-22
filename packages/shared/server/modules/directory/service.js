/**
 * service.js — the directory's rules, apart from HTTP and from storage.
 *
 * Reading: the directory is group-wide. Any signed-in person finds and opens
 * the active people of every company: the one deliberate exception to company
 * scoping (CLAUDE.md rule 1, docs/DECISIONS.md D82), and it covers this
 * reference data only. It returns work information only. A mobile number
 * appears only for a person whose own company has turned
 * showMobileInDirectory on, whoever is reading.
 *
 * Administering stays company-scoped: the data-quality report and Arabic
 * names are for administrators (a CompanyAdmin, their own companies); running
 * a sync and reading its history are HoldingAdmin only. Every change, and
 * exporting the report, is audited.
 *
 * Errors a screen can act on carry a stable code (docs/API.md):
 *   sync_in_progress, csv_invalid, csv_too_many_rows, empty_upload.
 */

import { writeAudit } from '../../lib/audit.js';
import {
  adminCompanyIdsFor,
  assertCompanyAdmin,
  assertHoldingAdmin,
  canAdminCompany,
  requireUser,
} from '../../lib/scope.js';
import { searchKeyOf, searchTokens } from '../../lib/text-search.js';
import { HttpError } from '../../middleware/errors.js';
import { parseCsv, toCsv } from '../../lib/csv.js';

const notFound = () => new HttpError(404, 'not_found');
const MAX_LIST = 200;
/** An Arabic-names file: its size in bytes and in rows. */
export const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;
const MAX_NAME = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const brief = (row) => ({
  id: row.id,
  displayNameEn: row.displayNameEn,
  displayNameAr: row.displayNameAr,
  jobTitle: row.jobTitle ?? null,
  email: row.email,
});

/** A person as the list returns them: work information only. */
function card(row) {
  return {
    ...brief(row),
    department: row.department
      ? { id: row.department.id, nameEn: row.department.nameEn, nameAr: row.department.nameAr }
      : null,
    company: {
      id: row.company.id,
      code: row.company.code,
      nameEn: row.company.nameEn,
      nameAr: row.company.nameAr,
    },
  };
}

/** Case-insensitive, language-aware sort key with an English fallback. */
function sorter(lang) {
  const collator = new Intl.Collator(lang === 'ar' ? 'ar' : 'en', { sensitivity: 'base' });
  const nameOf = (p) => (lang === 'ar' && p.displayNameAr ? p.displayNameAr : p.displayNameEn);
  return (a, b) => collator.compare(nameOf(a), nameOf(b)) || (a.id < b.id ? -1 : 1);
}

/** The ways a record can be incomplete, as the report counts them. */
const ISSUES = [
  ['missingCompany', (u) => !u.graphCompanyName],
  ['missingDepartment', (u) => !u.departmentId],
  ['missingJobTitle', (u) => !u.jobTitle],
  ['missingManager', (u) => !u.managerId],
  ['missingBusinessPhone', (u) => !u.phone],
  ['missingArabicName', (u) => !u.displayNameAr],
];

/**
 * @param {object} deps
 * @param {object} deps.store  see store-prisma.js
 * @param {{ start: Function }} deps.syncRunner  jobs/syncUsers.js
 */
export function createDirectoryService({ store, syncRunner }) {
  /* --------------------------------------------------------------- reading */

  async function searchPeople(req, { q, companyId, departmentId, lang, page, pageSize }) {
    const user = requireUser(req);

    // Group-wide (D82): no company scope. A companyId only narrows the list.
    const candidates = await store.searchCandidates({
      companyIds: null,
      companyId: companyId ?? null,
      departmentId: departmentId ?? null,
      tokens: searchTokens(q),
    });
    candidates.sort(sorter(lang ?? user.language ?? 'en'));

    const start = (page - 1) * pageSize;
    const ids = candidates.slice(start, start + pageSize).map((c) => c.id);
    const rows = await store.getUsers(ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      items: ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map(card),
      total: candidates.length,
      page,
      pageSize,
    };
  }

  async function getPerson(req, id) {
    requireUser(req);
    const row = await store.getUser(id);
    if (!row?.isActive) throw notFound();

    const visible = (r) => r && r.isActive;

    const manager = row.managerId ? await store.getUser(row.managerId) : null;
    const reports = await store.listReports(row.id);
    const showMobile = row.company.showMobileInDirectory;

    return {
      ...card(row),
      officeLocation: row.officeLocation ?? null,
      phone: row.phone ?? null,
      mobilePhone: showMobile ? (row.mobilePhone ?? null) : null,
      manager: visible(manager) ? card(manager) : null,
      directReports: reports.filter(visible).sort(sorter('en')).map(card),
      // Whether this reader may set the person's Arabic name (their admin scope).
      canEditArabicName: canAdminCompany(req, row.companyId),
    };
  }

  /** Companies and departments the filters offer: every active company. */
  async function filters(req) {
    requireUser(req);
    const companies = await store.listCompanies(null);
    const departments = await store.listDepartments(companies.map((c) => c.id));
    return {
      companies: companies.map((c) => ({
        id: c.id,
        code: c.code,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
      })),
      departments: departments.map((d) => ({
        id: d.id,
        companyId: d.companyId,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
      })),
    };
  }

  /* ---------------------------------------------------------- data quality */

  /** The companies a report may cover: all for a HoldingAdmin, theirs otherwise. */
  async function reportScope(req, companyId) {
    const adminIds = adminCompanyIdsFor(req);
    if (companyId) assertCompanyAdmin(req, companyId);
    const all = await store.listCompanies(companyId ? [companyId] : adminIds);
    return { companies: all, holding: adminIds === null };
  }

  async function buildReport(req, companyId) {
    const { companies, holding } = await reportScope(req, companyId);
    const users = await store.listActiveUsers(companies.map((c) => c.id));

    const rows = companies.map((company) => {
      const own = users.filter((u) => u.companyId === company.id);
      const counts = {};
      const lists = {};
      for (const [key, test] of ISSUES) {
        const hit = own.filter(test);
        counts[key] = hit.length;
        lists[key] = hit.slice(0, MAX_LIST).map(brief);
      }
      const unmatched = new Map();
      for (const u of own) {
        if (u.departmentId || !u.graphDepartment) continue;
        unmatched.set(u.graphDepartment, (unmatched.get(u.graphDepartment) ?? 0) + 1);
      }
      return {
        company: {
          id: company.id,
          code: company.code,
          nameEn: company.nameEn,
          nameAr: company.nameAr,
        },
        activeUsers: own.length,
        counts,
        lists,
        unmatchedDepartments: [...unmatched]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      };
    });

    // The people no company took come from the last run that finished well:
    // a run still going, or one that stopped, has not listed them.
    const runs = await store.listRuns(10);
    const latest = runs[0] ?? null;
    const reported = runs.find((r) => r.status === 'success') ?? null;
    return {
      companies: rows,
      // People Graph could place in no company belong to none, so only an
      // administrator of the whole group sees them.
      unplaced: holding
        ? (reported?.warnings ?? [])
            .filter((w) => w.code === 'unplaced_user')
            .map(({ email, displayName, companyName, domain }) => ({
              email,
              displayName,
              companyName,
              domain,
            }))
        : [],
      latestRun: latest
        ? {
            id: latest.id,
            status: latest.status,
            startedAt: latest.startedAt,
            finishedAt: latest.finishedAt,
          }
        : null,
    };
  }

  const qualityReport = (req, { companyId }) => buildReport(req, companyId);

  async function exportQuality(req, { companyId }) {
    const report = await buildReport(req, companyId);
    const header = ['company', 'issue', 'name_en', 'name_ar', 'email', 'job_title', 'detail'];
    const rows = [header];
    for (const entry of report.companies) {
      for (const [key] of ISSUES) {
        for (const p of entry.lists[key]) {
          rows.push([
            entry.company.code,
            key,
            p.displayNameEn,
            p.displayNameAr,
            p.email,
            p.jobTitle,
            '',
          ]);
        }
      }
      for (const d of entry.unmatchedDepartments) {
        rows.push([
          entry.company.code,
          'unmatchedDepartment',
          '',
          '',
          '',
          '',
          `${d.name} (${d.count})`,
        ]);
      }
    }
    for (const u of report.unplaced) {
      rows.push(['', 'unplacedUser', u.displayName, '', u.email, '', u.domain ?? '']);
    }

    await store.transaction((tx) =>
      writeAudit(
        req,
        'directory.quality.export',
        'DirectoryReport',
        null,
        { companyId: companyId ?? null, rows: rows.length - 1 },
        { tx, entityId: companyId ?? 'all', companyId: companyId ?? null }
      )
    );
    return toCsv(rows);
  }

  /* ---------------------------------------------------------- Arabic names */

  const cleanName = (value) =>
    String(value ?? '')
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim();

  const nameSnapshot = (row) => ({
    id: row.id,
    email: row.email,
    companyId: row.companyId,
    displayNameAr: row.displayNameAr,
  });

  /** One person's Arabic name, set by an administrator of their company. */
  async function setArabicName(req, id, { displayNameAr }) {
    requireUser(req);
    const row = await store.getUser(id);
    if (!row?.isActive) throw notFound();
    // The person is visible to everyone (D82), so a refusal is 403, not 404.
    if (!canAdminCompany(req, row.companyId)) throw new HttpError(403, 'forbidden');

    const name = cleanName(displayNameAr);
    if (name !== row.displayNameAr) {
      await store.transaction(async (tx) => {
        await tx.setArabicName(id, name, searchKeyOf({ ...row, displayNameAr: name }));
        await writeAudit(
          req,
          'directory.person.arabic_name',
          'UserProfile',
          nameSnapshot(row),
          nameSnapshot({ ...row, displayNameAr: name }),
          { tx }
        );
      });
    }
    return getPerson(req, id);
  }

  /**
   * Reads an "email, arabicName" file against the directory. Nothing is
   * written: applyArabicNames runs the same reading and then writes.
   */
  async function readArabicNames(req, buffer) {
    requireUser(req);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new HttpError(400, 'empty_upload', 'No file was sent.');
    }
    const invalidFile = (message) => new HttpError(400, 'csv_invalid', message);

    let rows;
    try {
      rows = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    } catch {
      throw invalidFile('The file is not a UTF-8 CSV file.');
    }
    const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/[\s_]/g, ''));
    const emailAt = head.indexOf('email');
    const nameAt = head.indexOf('arabicname');
    if (emailAt < 0 || nameAt < 0) {
      throw invalidFile('The first row must name the columns: email, arabicName.');
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new HttpError(
        400,
        'csv_too_many_rows',
        `The file has more than ${MAX_IMPORT_ROWS} rows.`,
        { max: MAX_IMPORT_ROWS }
      );
    }

    const invalid = [];
    const wanted = new Map();
    rows.forEach((cells, index) => {
      const line = index + 2;
      const email = (cells[emailAt] ?? '').trim().toLowerCase();
      const name = cleanName(cells[nameAt]);
      const bad = (reason) => invalid.push({ line, email: email.slice(0, 320), reason });
      if (!EMAIL.test(email) || email.length > 320) return bad('email');
      // An empty name never means "clear it": a half-filled sheet must not wipe names.
      if (!name) return bad('empty');
      if (name.length > MAX_NAME) return bad('tooLong');
      if (wanted.has(email)) return bad('duplicate');
      wanted.set(email, name);
      return undefined;
    });

    const people = await store.findUsersByEmails([...wanted.keys()]);
    const byEmail = new Map(people.map((person) => [person.email.toLowerCase(), person]));
    const changes = [];
    const unknown = [];
    const outOfScope = [];
    let unchanged = 0;
    for (const [email, name] of wanted) {
      const person = byEmail.get(email);
      if (!person?.isActive) unknown.push(email);
      else if (!canAdminCompany(req, person.companyId)) outOfScope.push(email);
      else if (person.displayNameAr === name) unchanged += 1;
      else changes.push({ person, to: name });
    }
    return { rows: rows.length, changes, unchanged, unknown, outOfScope, invalid };
  }

  const importView = (read) => ({
    rows: read.rows,
    matched: read.changes.length + read.unchanged,
    unchanged: read.unchanged,
    changes: read.changes.map(({ person, to }) => ({
      id: person.id,
      email: person.email,
      displayNameEn: person.displayNameEn,
      companyCode: person.company.code,
      from: person.displayNameAr,
      to,
    })),
    unknown: read.unknown,
    outOfScope: read.outOfScope,
    invalid: read.invalid,
  });

  async function previewArabicNames(req, buffer) {
    return importView(await readArabicNames(req, buffer));
  }

  /** Applies the file: one transaction, one audit row per company touched. */
  async function applyArabicNames(req, buffer) {
    const read = await readArabicNames(req, buffer);

    const byCompany = new Map();
    for (const change of read.changes) {
      const list = byCompany.get(change.person.companyId) ?? [];
      list.push(change);
      byCompany.set(change.person.companyId, list);
    }

    if (read.changes.length > 0) {
      await store.transaction(
        async (tx) => {
          for (const { person, to } of read.changes) {
            await tx.setArabicName(
              person.id,
              to,
              searchKeyOf({ ...person, displayNameAr: to })
            );
          }
          for (const [companyId, list] of byCompany) {
            await writeAudit(
              req,
              'directory.arabic_names.import',
              'DirectoryImport',
              {
                names: list.map(({ person }) => ({
                  email: person.email,
                  displayNameAr: person.displayNameAr,
                })),
              },
              {
                changed: list.length,
                fileRows: read.rows,
                unchanged: read.unchanged,
                unknown: read.unknown.length,
                outOfScope: read.outOfScope.length,
                invalid: read.invalid.length,
                names: list.map(({ person, to }) => ({
                  email: person.email,
                  displayNameAr: to,
                })),
              },
              { tx, entityId: companyId, companyId }
            );
          }
        },
        { timeout: 60_000 }
      );
    }
    return { ...importView(read), applied: read.changes.length };
  }

  /* ------------------------------------------------------------------ sync */

  async function syncHistory(req) {
    assertHoldingAdmin(req);
    const runs = await store.listRuns(20);
    return {
      items: runs.map((run, index) => {
        const { warnings, ...rest } = run;
        return {
          ...rest,
          warningCount: warnings.length,
          // Only the latest run's warnings are shown; older ones stay stored.
          warnings: index === 0 ? warnings : [],
        };
      }),
    };
  }

  async function runSync(req, { allowLargeDeactivation }) {
    assertHoldingAdmin(req);
    return syncRunner.start({ source: 'manual', req, allowLargeDeactivation });
  }

  return {
    searchPeople,
    getPerson,
    filters,
    qualityReport,
    exportQuality,
    setArabicName,
    previewArabicNames,
    applyArabicNames,
    syncHistory,
    runSync,
  };
}
