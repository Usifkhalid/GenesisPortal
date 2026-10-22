/**
 * hr-import.js — HR's staff list into the portal's people (D140). Run with
 * `npm run import:hr` (backend/scripts/import-hr.js); nothing here reads files
 * or the environment, so every rule is tested on fake data.
 *
 * Two files: the departments (company_code, department, name_ar, people) and
 * the people (staff_id, full_name, position, company_code, department,
 * hr_department_original, location, employment_category, hire_date). A
 * company code starting with PENDING_ is a company the portal does not have
 * yet: its rows are listed and nothing else.
 *
 * HR's list has no email, so people are matched to portal accounts, in order:
 *   1. a hand-made file (staff_id, email), which wins over everything;
 *   2. the staff id a previous import stored on the account;
 *   3. the name: equal first names, and every word of the portal's name in
 *      HR's (HR names are longer). One account for one row is a match; an
 *      account that fits several rows, or a row that fits several accounts,
 *      is ambiguous and left alone.
 *
 * A match gets HR's company, department, job title (position), office
 * (location), staff id, employment category and hire date. The four profile
 * fields HR gave a value for become HR's (UserProfile.hrFields,
 * lib/hr-fields.js): sync and the sign-in refresh leave them alone from then
 * on. Each change, and each department created, is one audit row.
 */

import { z } from 'zod';

import { writeAudit } from '../../lib/audit.js';
import { HR_OWNED_FIELDS, hrFieldsValue } from '../../lib/hr-fields.js';
import { normalizeText, searchKeyOf } from '../../lib/text-search.js';
import { parseCsv, toCsv } from '../../lib/csv.js';

export const PENDING_PREFIX = 'PENDING_';

/** Joined to the word after them: "El Shal" and "El-Shal" are both "elshal". */
const NAME_PREFIXES = new Set(['el', 'al', 'abd', 'abdel', 'abdul', 'abo', 'abu', 'abou']);

/**
 * A name as comparable words: lower case, accents and apostrophes removed,
 * hyphens and other punctuation read as word breaks, and the prefixes above
 * joined with the next word ("Abd El Rahman" = "Abdelrahman").
 * @param {string} name
 * @returns {string[]}
 */
export function nameWords(name) {
  const words = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const out = [];
  let prefix = '';
  for (const word of words) {
    if (NAME_PREFIXES.has(word)) prefix += word;
    else {
      out.push(prefix + word);
      prefix = '';
    }
  }
  if (prefix) out.push(prefix);
  return out;
}

/** Same first name, and every word of the portal's name is in HR's. */
export function namesMatch(portalWords, hrWords) {
  if (portalWords.length === 0 || hrWords.length === 0) return false;
  if (portalWords[0] !== hrWords[0]) return false;
  const hr = new Set(hrWords);
  return portalWords.every((w) => hr.has(w));
}

/* ---- reading the files */

const isRealDate = (ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
};

const PERSON = z.object({
  staff_id: z.string().regex(/^[A-Za-z0-9-]{1,20}$/, 'bad_staff_id'),
  full_name: z.string().min(1, 'missing_name').max(200),
  position: z.string().max(200),
  company_code: z.string().regex(/^[A-Za-z0-9_]{1,40}$/, 'bad_company_code'),
  department: z.string().max(200),
  hr_department_original: z.string().max(500),
  location: z.string().max(200),
  employment_category: z.string().max(50),
  hire_date: z
    .string()
    .refine((v) => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && isRealDate(v)), 'bad_date'),
});

const DEPARTMENT = z.object({
  company_code: z.string().regex(/^[A-Za-z0-9_]{1,40}$/, 'bad_company_code'),
  department: z.string().min(1, 'missing_department').max(200),
  name_ar: z.string().min(1, 'missing_arabic_name').max(200),
  people: z.string(),
});

const HAND_MATCH = z.object({
  staff_id: z.string().regex(/^[A-Za-z0-9-]{1,20}$/, 'bad_staff_id'),
  email: z.email('bad_email').max(320),
});

/**
 * Rows of a CSV file as objects keyed by `schema`'s columns, trimmed and
 * validated. Rows that fail are returned apart, by line number and reason.
 * @param {string} text
 * @param {z.ZodObject} schema
 * @param {string} label  the file, for error messages
 */
function readTable(text, schema, label) {
  const columns = Object.keys(schema.shape);
  const table = parseCsv(String(text ?? ''));
  if (table.length === 0) throw new Error(`${label}: the file is empty.`);
  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = columns.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new Error(`${label}: missing column(s) ${missing.join(', ')}.`);

  const rows = [];
  const invalid = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const raw = Object.fromEntries(
      columns.map((c) => [c, (cells[header.indexOf(c)] ?? '').trim()])
    );
    const parsed = schema.safeParse(raw);
    if (parsed.success) rows.push({ line, ...parsed.data });
    else invalid.push({ line, raw, reason: parsed.error.issues[0]?.message ?? 'invalid' });
  });
  return { rows, invalid };
}

export function readHrPeople(text) {
  const { rows, invalid } = readTable(text, PERSON, 'hr-people.csv');
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    if (seen.has(row.staff_id))
      invalid.push({ line: row.line, raw: row, reason: 'duplicate_staff_id' });
    else {
      seen.add(row.staff_id);
      unique.push({ ...row, company_code: row.company_code.toUpperCase() });
    }
  }
  return { rows: unique, invalid };
}

export function readHrDepartments(text) {
  const { rows, invalid } = readTable(text, DEPARTMENT, 'hr-departments.csv');
  return {
    rows: rows.map((r) => ({ ...r, company_code: r.company_code.toUpperCase() })),
    invalid,
  };
}

export function readHandMatches(text) {
  const { rows, invalid } = readTable(text, HAND_MATCH, 'hr-matches.csv');
  return { rows: rows.map((r) => ({ ...r, email: r.email.toLowerCase() })), invalid };
}

/* ---- planning */

const isPending = (code) => code.startsWith(PENDING_PREFIX);
const ymd = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);

/**
 * @typedef {object} HrState  what the portal holds now
 * @property {{ id: string, code: string }[]} companies
 * @property {{ id: string, companyId: string, nameEn: string, nameAr: string }[]} departments
 * @property {object[]} users  every UserProfile (store loadHrImportState)
 */

/**
 * Pure: what the import would do. Nothing is written.
 * @param {object} input
 * @param {ReturnType<typeof readHrPeople>['rows']} input.people
 * @param {ReturnType<typeof readHrDepartments>['rows']} input.departments
 * @param {ReturnType<typeof readHandMatches>['rows']} [input.handMatches]
 * @param {object[]} [input.invalid]  rows the readers refused, reported as such
 * @param {HrState} input.state
 */
export function planHrImport({ people, departments, handMatches = [], invalid = [], state }) {
  const companyByCode = new Map(state.companies.map((c) => [c.code.toUpperCase(), c]));
  const codeOf = new Map(state.companies.map((c) => [c.id, c.code]));
  const report = [];
  const counts = {};
  const countsOf = (code) =>
    (counts[code] ??= {
      matched: 0,
      changed: 0,
      ambiguous: 0,
      unmatched: 0,
      notInHr: 0,
      pending: 0,
      skipped: 0,
      departmentsCreated: 0,
    });
  const tally = (code, key) => {
    countsOf(code)[key] += 1;
  };
  // Every portal company shows, with nobody too.
  for (const c of state.companies) countsOf(c.code);

  /* departments: existing ones by either name, and the ones to create */
  const index = new Map(); // companyId → normalised name → { id } | { key }
  const indexOf = (companyId) => {
    if (!index.has(companyId)) index.set(companyId, new Map());
    return index.get(companyId);
  };
  for (const d of state.departments) {
    for (const name of [d.nameEn, d.nameAr]) {
      if (name) indexOf(d.companyId).set(normalizeText(name), { id: d.id });
    }
  }
  const departmentCreates = [];
  for (const row of departments) {
    const base = {
      result: 'department',
      hr_company: row.company_code,
      hr_department: row.department,
    };
    if (isPending(row.company_code)) {
      report.push({ ...base, reason: 'company_pending' });
      continue;
    }
    const company = companyByCode.get(row.company_code);
    if (!company) {
      report.push({ ...base, reason: 'company_not_in_portal' });
      continue;
    }
    const names = indexOf(company.id);
    const found =
      names.get(normalizeText(row.department)) ?? names.get(normalizeText(row.name_ar));
    if (found) {
      names.set(normalizeText(row.department), found);
      report.push({
        ...base,
        reason: found.key ? 'department_listed_twice' : 'department_exists',
      });
      continue;
    }
    const ref = { key: `${company.id}\u0000${normalizeText(row.department)}` };
    names.set(normalizeText(row.department), ref);
    names.set(normalizeText(row.name_ar), ref);
    departmentCreates.push({
      key: ref.key,
      companyId: company.id,
      nameEn: row.department,
      nameAr: row.name_ar,
    });
    tally(company.code, 'departmentsCreated');
    report.push({ ...base, reason: 'department_created' });
  }

  /* matching */
  const byEmail = new Map(state.users.map((u) => [u.email.toLowerCase(), u]));
  const byStaffId = new Map(state.users.filter((u) => u.staffId).map((u) => [u.staffId, u]));
  const rowById = new Map(people.map((p) => [p.staff_id, p]));
  /** staff_id → { user, how } */
  const pairs = new Map();
  /** staff_id → reason: a row decided without a match */
  const unpaired = new Map();
  const claimed = new Set();

  for (const m of handMatches) {
    const user = byEmail.get(m.email);
    if (!rowById.has(m.staff_id)) {
      report.push({
        result: 'hand_match',
        reason: 'hand_match_staff_id_not_in_hr_list',
        staff_id: m.staff_id,
        portal_email: m.email,
      });
    } else if (!user) unpaired.set(m.staff_id, 'hand_match_email_not_in_portal');
    else if (claimed.has(user.id) || pairs.has(m.staff_id)) {
      unpaired.set(m.staff_id, 'hand_match_used_twice');
    } else {
      pairs.set(m.staff_id, { user, how: 'matched_by_hand' });
      claimed.add(user.id);
    }
  }
  for (const p of people) {
    if (pairs.has(p.staff_id) || unpaired.has(p.staff_id)) continue;
    const user = byStaffId.get(p.staff_id);
    if (user && !claimed.has(user.id)) {
      pairs.set(p.staff_id, { user, how: 'matched_by_staff_id' });
      claimed.add(user.id);
    }
  }

  const pool = state.users
    .filter((u) => u.isActive && !claimed.has(u.id))
    .map((u) => ({ user: u, words: nameWords(u.displayNameEn) }));
  const open = people.filter((p) => !pairs.has(p.staff_id) && !unpaired.has(p.staff_id));
  const candidates = new Map(); // staff_id → users
  const rowsOfUser = new Map(); // user id → staff ids
  for (const p of open) {
    const words = nameWords(p.full_name);
    const found = pool.filter((c) => namesMatch(c.words, words)).map((c) => c.user);
    candidates.set(p.staff_id, found);
    for (const u of found) rowsOfUser.set(u.id, [...(rowsOfUser.get(u.id) ?? []), p.staff_id]);
  }
  const ambiguous = new Map(); // staff_id → { reason, users }
  for (const p of open) {
    const found = candidates.get(p.staff_id);
    if (found.length === 0) continue;
    if (found.length > 1) {
      ambiguous.set(p.staff_id, { reason: 'several_portal_accounts_match', users: found });
      continue;
    }
    const [user] = found;
    if (rowsOfUser.get(user.id).length > 1) {
      ambiguous.set(p.staff_id, { reason: 'account_matches_several_hr_rows', users: found });
      continue;
    }
    pairs.set(p.staff_id, { user, how: 'matched_by_name' });
    claimed.add(user.id);
  }
  // Accounts any row might be: not "missing from HR's list", only unresolved.
  const touched = new Set([...claimed, ...rowsOfUser.keys()]);

  /* what each row means */
  const updates = [];
  const portalOf = (u) => ({
    portal_email: u.email,
    portal_name: u.displayNameEn,
    portal_company: codeOf.get(u.companyId) ?? '',
  });
  for (const p of people) {
    const code = p.company_code;
    const base = {
      staff_id: p.staff_id,
      hr_name: p.full_name,
      hr_company: code,
      hr_department: p.department,
      position: p.position,
      location: p.location,
    };
    const pair = pairs.get(p.staff_id);
    const company = companyByCode.get(code);

    if (isPending(code) || !company) {
      const reason = isPending(code) ? 'company_pending' : 'company_not_in_portal';
      tally(code, isPending(code) ? 'pending' : 'skipped');
      report.push({
        result: isPending(code) ? 'pending' : 'skipped',
        reason,
        ...base,
        ...(pair ? portalOf(pair.user) : {}),
      });
      continue;
    }
    if (ambiguous.has(p.staff_id)) {
      const { reason, users } = ambiguous.get(p.staff_id);
      tally(code, 'ambiguous');
      // Several accounts: their emails. One account fitting several rows: it,
      // and the other rows' staff ids.
      const candidates =
        users.length > 1
          ? users.map((u) => u.email)
          : [
              users[0].email,
              ...rowsOfUser
                .get(users[0].id)
                .filter((id) => id !== p.staff_id)
                .map((id) => `staff ${id}`),
            ];
      report.push({ result: 'ambiguous', reason, ...base, candidates: candidates.join(' | ') });
      continue;
    }
    if (!pair) {
      tally(code, 'unmatched');
      report.push({
        result: 'unmatched',
        reason: unpaired.get(p.staff_id) ?? 'no_microsoft_account',
        ...base,
      });
      continue;
    }

    const { user, how } = pair;
    tally(code, 'matched');
    const department = p.department
      ? indexOf(company.id).get(normalizeText(p.department))
      : null;
    const notes = [];
    if (p.department && !department) notes.push('department_not_found');

    // HR's values. A field HR left empty stays as it is and is not HR's, so
    // Microsoft 365 may fill it.
    const given = {
      companyId: true,
      departmentId: Boolean(department),
      jobTitle: Boolean(p.position),
      officeLocation: Boolean(p.location),
    };
    const owned = new Set(HR_OWNED_FIELDS.filter((f) => given[f]));
    const data = {};
    const before = {};
    const after = {};
    const change = (field, value, same = (a, b) => (a ?? null) === (b ?? null)) => {
      if (same(user[field], value)) return;
      data[field] = value;
      before[field] = user[field] ?? null;
      after[field] = value;
    };
    change('companyId', company.id);
    if (p.position) change('jobTitle', p.position);
    if (p.location) change('officeLocation', p.location);
    let departmentKey = null;
    if (department?.key) {
      departmentKey = department.key;
      data.departmentId = null; // filled in once the department exists
      before.departmentId = user.departmentId ?? null;
      after.departmentId = `(new) ${p.department}`;
    } else if (department) change('departmentId', department.id);
    change('staffId', p.staff_id);
    if (p.employment_category) change('employmentCategory', p.employment_category);
    if (p.hire_date) {
      change('hireDate', new Date(`${p.hire_date}T00:00:00Z`), (a, b) => ymd(a) === ymd(b));
      if ('hireDate' in after) after.hireDate = p.hire_date;
      if ('hireDate' in before) before.hireDate = ymd(before.hireDate);
    }
    change('hrFields', hrFieldsValue(owned));

    const changed = Object.keys(before);
    if (changed.length > 0) {
      if ('jobTitle' in data) data.searchKey = searchKeyOf({ ...user, ...data });
      updates.push({
        id: user.id,
        companyCode: company.code,
        fromCompanyId: user.companyId,
        data,
        departmentKey,
        before: { id: user.id, companyId: user.companyId, ...before },
        after: { id: user.id, companyId: data.companyId ?? user.companyId, ...after },
      });
      tally(code, 'changed');
    }
    report.push({
      result: 'matched',
      reason: [how, ...notes].join('; '),
      ...base,
      ...portalOf(user),
      changes: changed.join(' '),
    });
  }

  /* portal accounts HR's list does not have */
  for (const u of state.users) {
    if (!u.isActive || touched.has(u.id)) continue;
    const code = codeOf.get(u.companyId) ?? '';
    tally(code, 'notInHr');
    report.push({
      result: 'not_in_hr_list',
      reason: 'portal_account_not_in_hr_list',
      ...portalOf(u),
    });
  }

  for (const row of invalid) {
    report.push({
      result: 'invalid_row',
      reason: `${row.reason} (line ${row.line})`,
      staff_id: row.raw?.staff_id ?? '',
    });
  }

  return { departmentCreates, updates, counts, report };
}

/** The report as CSV, one row per HR row, department and unmatched account. */
export const REPORT_COLUMNS = [
  'result',
  'reason',
  'staff_id',
  'hr_name',
  'hr_company',
  'hr_department',
  'position',
  'location',
  'portal_email',
  'portal_name',
  'portal_company',
  'candidates',
  'changes',
];

export function reportCsv(report) {
  return toCsv([REPORT_COLUMNS, ...report.map((r) => REPORT_COLUMNS.map((c) => r[c] ?? ''))]);
}

/* ---- applying */

/**
 * Writes the plan: departments first, then each person, each change in its
 * own transaction with its audit row, then one summary audit row.
 * @param {object} deps
 * @param {object} deps.store  directory store (store-prisma.js or store-memory.js)
 * @param {ReturnType<typeof planHrImport>} deps.plan
 * @param {{ id: string }} deps.actor  the HoldingAdmin running it
 * @param {() => Date} [deps.now]
 */
export async function applyHrImport({ store, plan, actor, now = () => new Date() }) {
  const as = { user: { id: actor.id }, ip: null };
  const departmentIds = new Map();
  for (const d of plan.departmentCreates) {
    await store.transaction(async (tx) => {
      const row = await tx.createDepartment({
        companyId: d.companyId,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
      });
      departmentIds.set(d.key, row.id);
      await writeAudit(as, 'department.create', 'Department', null, row, { tx });
    });
  }

  for (const u of plan.updates) {
    const data = { ...u.data, hrImportedAt: now() };
    const after = { ...u.after };
    if (u.departmentKey) {
      data.departmentId = departmentIds.get(u.departmentKey) ?? null;
      after.departmentId = data.departmentId;
    }
    await store.transaction(async (tx) => {
      await tx.updateHrProfile(u.id, data, {
        fromCompanyId: u.fromCompanyId,
        toCompanyId: data.companyId,
      });
      await writeAudit(as, 'user.hr_import', 'UserProfile', u.before, after, {
        tx,
        companyId: after.companyId,
      });
    });
  }

  await store.transaction((tx) =>
    writeAudit(
      as,
      'directory.hr_import',
      'UserProfile',
      null,
      {
        departmentsCreated: plan.departmentCreates.length,
        peopleChanged: plan.updates.length,
        counts: plan.counts,
      },
      { tx, companyId: null, entityId: null }
    )
  );
  return {
    departmentsCreated: plan.departmentCreates.length,
    peopleChanged: plan.updates.length,
  };
}

/**
 * One import: the guard, the files read, the plan, and (unless a dry run) the
 * writes. The command line (scripts/import-hr.js) reads the files and prints.
 * @param {object} input
 * @param {string} input.portalData  the app's PORTAL_DATA (HELPDESK_DATA): only "live" is allowed
 * @param {string} [input.dataVar]  that variable's name, for the message
 * @param {object} input.store  directory store
 * @param {{ people: string, departments: string, matches?: string | null }} input.files
 * @param {string} input.asEmail  the HoldingAdmin running it
 * @param {boolean} [input.dryRun]
 * @param {() => Date} [input.now]
 */
export async function runHrImport({
  portalData,
  dataVar = 'PORTAL_DATA',
  store,
  files,
  asEmail,
  dryRun = false,
  now,
}) {
  if (portalData !== 'live') {
    throw new Error(`The HR import runs only with ${dataVar}=live (the real people).`);
  }
  if (!asEmail) throw new Error('Say who is running it: --as <your email>.');
  const actor = await store.findHoldingAdminByEmail(asEmail);
  if (!actor) {
    throw new Error(
      'Only an active HoldingAdmin may run the HR import (--as names no such person).'
    );
  }

  const people = readHrPeople(files.people);
  const departments = readHrDepartments(files.departments);
  const hand = files.matches ? readHandMatches(files.matches) : { rows: [], invalid: [] };
  const invalid = [...people.invalid, ...departments.invalid, ...hand.invalid];
  const plan = planHrImport({
    people: people.rows,
    departments: departments.rows,
    handMatches: hand.rows,
    invalid,
    state: await store.loadHrImportState(),
  });
  const applied = dryRun ? null : await applyHrImport({ store, plan, actor, now });
  return { plan, invalid, applied };
}
