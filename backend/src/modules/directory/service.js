/**
 * service.js — the directory's rules, apart from HTTP and from storage.
 *
 * Reading: any signed-in person reads the directory, limited to the companies
 * in their scope (lib/scope.js: their own, plus any they administer; a
 * HoldingAdmin reads all). It returns work information only. A mobile number
 * appears only for a company that has turned showMobileInDirectory on.
 *
 * Administering: the data-quality report is for administrators (a
 * CompanyAdmin sees their own companies); running a sync and reading its
 * history are HoldingAdmin only. Exporting the report is audited.
 *
 * Errors a screen can act on carry a stable code (docs/API.md):
 *   sync_in_progress.
 */

import { writeAudit } from '../../lib/audit.js';
import {
  adminCompanyIdsFor,
  assertCompanyAccess,
  assertCompanyAdmin,
  assertHoldingAdmin,
  companyIdsFor,
  requireUser,
} from '../../lib/scope.js';
import { searchTokens } from '../../lib/text-search.js';
import { HttpError } from '../../middleware/errors.js';
import { toCsv } from '../admin/csv.js';

const notFound = () => new HttpError(404, 'not_found');
const MAX_LIST = 200;

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
    if (companyId) assertCompanyAccess(req, companyId);

    const candidates = await store.searchCandidates({
      companyIds: companyIdsFor(req),
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
    assertCompanyAccess(req, row.companyId);

    const ids = companyIdsFor(req);
    const visible = (r) => r && r.isActive && (ids === null || ids.includes(r.companyId));

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
    };
  }

  /** Companies and departments the filters offer: only those in scope. */
  async function filters(req) {
    requireUser(req);
    const ids = companyIdsFor(req);
    const companies = await store.listCompanies(ids);
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
    syncHistory,
    runSync,
  };
}
