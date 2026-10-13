/**
 * syncUsers.js — mirrors the Entra directory (through integrations/graph) into
 * UserProfile. Three parts, so each can be tested alone:
 *
 *   planSync          pure: Graph's users + the portal's rows → what to change
 *   createSyncRunner  one run at a time: lock, plan, apply, record, audit
 *   startNightlySync  the 02:00 Cairo timer
 *
 * What sync owns: email, English name, job title, office, business and mobile
 * phone, company, department, manager and whether the account is active. What
 * it never touches: the Arabic display name, language, roles. People who
 * vanish from Graph or are disabled become inactive, never deleted, so their
 * history stays.
 *
 * Two safety stops leave the database exactly as it was and record a Failed
 * run: Graph returning no users at all, and a run that would deactivate more
 * than 20% of the people currently active (unless a HoldingAdmin reruns it
 * with allowLargeDeactivation).
 */

import { writeAudit } from '../lib/audit.js';
import { runLeased } from '../lib/job-lease.js';
import { logger } from '../lib/logger.js';
import { normalizeText, searchKeyOf } from '../lib/text-search.js';
import { HttpError } from '../middleware/errors.js';

/** A run left "running" by a crash stops blocking new ones after this. */
export const SYNC_STALE_MS = 30 * 60 * 1000;
export const MAX_DEACTIVATION_SHARE = 0.2;
const MAX_UNPLACED_LISTED = 500;

const clean = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
};

const domainOf = (email) =>
  email?.includes('@') ? email.split('@').pop().toLowerCase() : null;

/**
 * @typedef {object} SyncState  what the portal holds now
 * @property {{ id: string, code: string, nameEn: string, nameAr: string, domains: string[] }[]} companies
 * @property {{ id: string, companyId: string, nameEn: string, nameAr: string }[]} departments
 * @property {object[]} users  every UserProfile, active or not
 */

/**
 * @param {object} input
 * @param {import('../integrations/graph/index.js').GraphUser[]} input.graphUsers
 * @param {Map<string, string | null>} input.managerIds  Graph user id → manager's Graph id
 * @param {SyncState} input.state
 * @param {boolean} [input.allowLargeDeactivation]
 * @param {Date} [input.now]
 */
export function planSync({
  graphUsers,
  managerIds,
  state,
  allowLargeDeactivation = false,
  now = new Date(),
}) {
  const warnings = [];
  const plan = {
    creates: [],
    updates: [],
    deactivations: [],
    managerLinks: [],
    warnings,
    counts: { created: 0, updated: 0, deactivated: 0, unchanged: 0 },
    abort: null,
  };

  if (graphUsers.length === 0) {
    plan.abort = { code: 'graph_empty' };
    return plan;
  }

  const companyByName = new Map();
  const companyByDomain = new Map();
  const codeById = new Map();
  for (const c of state.companies) {
    codeById.set(c.id, c.code);
    for (const name of [c.nameEn, c.nameAr, c.code]) companyByName.set(normalizeText(name), c);
    for (const d of c.domains) companyByDomain.set(d.toLowerCase(), c);
  }

  const departments = new Map();
  for (const d of state.departments) {
    if (!departments.has(d.companyId)) departments.set(d.companyId, new Map());
    for (const name of [d.nameEn, d.nameAr]) {
      if (name) departments.get(d.companyId).set(normalizeText(name), d);
    }
  }

  const byEntra = new Map(state.users.map((u) => [u.entraObjectId, u]));
  const byEmail = new Map(state.users.map((u) => [u.email.toLowerCase(), u]));
  const entraOfId = new Map(state.users.map((u) => [u.id, u.entraObjectId]));

  const seenEmails = new Set();
  const seenEntra = new Set();
  const unmatchedDepartments = new Map();
  const currentlyActive = state.users.filter((u) => u.isActive).length;
  /** Graph ids of people the portal will hold after this run. */
  const placed = new Set(state.users.map((u) => u.entraObjectId));
  const toPlace = [];

  for (const g of graphUsers) {
    const email = clean(g.mail ?? g.userPrincipalName)?.toLowerCase();
    if (!email) {
      warnings.push({ code: 'missing_email', id: g.id });
      continue;
    }
    if (seenEmails.has(email) || seenEntra.has(g.id)) {
      warnings.push({ code: 'duplicate_email', email });
      continue;
    }
    seenEmails.add(email);
    seenEntra.add(g.id);

    let existing = byEntra.get(g.id) ?? null;
    if (!existing) {
      const sameEmail = byEmail.get(email);
      // An email held by a row that Graph already gave another id: not ours.
      if (sameEmail && !graphUsers.some((o) => o !== g && o.id === sameEmail.entraObjectId)) {
        existing = sameEmail;
      } else if (sameEmail) {
        warnings.push({ code: 'duplicate_email', email });
        continue;
      }
    }

    const graphCompanyName = clean(g.companyName);
    const domain = domainOf(email) ?? domainOf(clean(g.userPrincipalName));
    let company =
      (graphCompanyName && companyByName.get(normalizeText(graphCompanyName))) ||
      (domain && companyByDomain.get(domain)) ||
      null;
    if (!company && existing) {
      company = state.companies.find((c) => c.id === existing.companyId) ?? null;
    }
    if (!company) {
      plan.unplaced ??= [];
      plan.unplaced.push({
        email,
        displayName: clean(g.displayName),
        companyName: graphCompanyName,
        domain,
      });
      continue;
    }

    const graphDepartment = clean(g.department);
    const department = graphDepartment
      ? (departments.get(company.id)?.get(normalizeText(graphDepartment)) ?? null)
      : null;
    const enabled = g.accountEnabled !== false;
    if (graphDepartment && !department && enabled) {
      const key = `${company.id}\u0000${graphDepartment}`;
      const tally = unmatchedDepartments.get(key) ?? {
        code: 'unmatched_department',
        name: graphDepartment,
        companyCode: company.code,
        count: 0,
      };
      tally.count += 1;
      unmatchedDepartments.set(key, tally);
    }

    const displayNameEn =
      clean(g.displayName) ?? existing?.displayNameEn ?? email.split('@')[0];
    const fields = {
      entraObjectId: g.id,
      email,
      displayNameEn,
      jobTitle: clean(g.jobTitle),
      officeLocation: clean(g.officeLocation),
      phone: clean(g.businessPhones?.[0]),
      mobilePhone: clean(g.mobilePhone),
      companyId: company.id,
      departmentId: department?.id ?? null,
      graphDepartment,
      graphCompanyName,
      isActive: enabled,
    };
    const searchKey = searchKeyOf({
      displayNameEn,
      displayNameAr: existing?.displayNameAr ?? '',
      email,
      jobTitle: fields.jobTitle,
    });

    toPlace.push({ g, existing, fields, searchKey });
    placed.add(g.id);
  }

  // Rows first, then manager links, which may point at a row created above.
  // A failed manager lookup leaves the existing link alone.
  const resolvedManager = (g, existing) => {
    if (!managerIds.has(g.id)) {
      const kept = existing?.managerId ? (entraOfId.get(existing.managerId) ?? null) : null;
      return { entra: kept };
    }
    const wanted = managerIds.get(g.id) ?? null;
    if (!wanted) return { entra: null };
    if (placed.has(wanted)) return { entra: wanted };
    return { entra: null, unresolved: true };
  };

  for (const { g, existing, fields, searchKey } of toPlace) {
    const manager = resolvedManager(g, existing);
    if (manager.unresolved) {
      warnings.push({ code: 'manager_unresolved', email: fields.email });
    }

    if (!existing) {
      plan.creates.push({ data: { ...fields, searchKey, lastSyncedAt: now } });
      plan.managerLinks.push({ entraObjectId: g.id, managerEntraObjectId: manager.entra });
      plan.counts.created += 1;
      continue;
    }

    const changedFields = Object.keys(fields).filter(
      (k) => k !== 'isActive' && (existing[k] ?? null) !== fields[k]
    );
    const wasManager = existing.managerId ? (entraOfId.get(existing.managerId) ?? null) : null;
    const managerChanged = wasManager !== manager.entra;
    const reactivated = fields.isActive && !existing.isActive;
    const deactivated = !fields.isActive && existing.isActive;
    const changed = changedFields.length > 0 || managerChanged || reactivated;

    plan.updates.push({
      id: existing.id,
      data: { ...fields, searchKey, lastSyncedAt: now },
      changed,
    });
    if (managerChanged) {
      plan.managerLinks.push({ entraObjectId: g.id, managerEntraObjectId: manager.entra });
    }
    if (deactivated) {
      plan.deactivations.push(existing.id);
      plan.counts.deactivated += 1;
    } else if (changed) plan.counts.updated += 1;
    else plan.counts.unchanged += 1;
  }

  // Active in the portal but not in Graph at all.
  const inGraph = new Set(graphUsers.map((g) => g.id));
  for (const u of state.users) {
    if (!u.isActive || inGraph.has(u.entraObjectId)) continue;
    // Skipped (unplaced or no email) people are in Graph, so they stay as they are.
    plan.deactivations.push(u.id);
    plan.counts.deactivated += 1;
    plan.updates.push({
      id: u.id,
      data: { isActive: false, lastSyncedAt: now },
      changed: true,
    });
  }

  warnings.push(...unmatchedDepartments.values());
  for (const u of (plan.unplaced ?? []).slice(0, MAX_UNPLACED_LISTED)) {
    warnings.push({ code: 'unplaced_user', ...u });
  }

  const share = currentlyActive === 0 ? 0 : plan.counts.deactivated / currentlyActive;
  if (share > MAX_DEACTIVATION_SHARE && !allowLargeDeactivation) {
    plan.abort = {
      code: 'deactivation_limit',
      wouldDeactivate: plan.counts.deactivated,
      active: currentlyActive,
    };
  }
  return plan;
}

/** Looks up every manager, a few at a time. A failed lookup is a warning. */
async function fetchManagers(client, graphUsers, warnings, concurrency = 8) {
  const managerIds = new Map();
  let next = 0;
  async function worker() {
    while (next < graphUsers.length) {
      const g = graphUsers[next++];
      try {
        const manager = await client.getManager(g.id);
        managerIds.set(g.id, manager?.id ?? null);
      } catch (err) {
        managerIds.set(g.id, undefined);
        warnings.push({
          code: 'manager_lookup_failed',
          id: g.id,
          // The error's code, not its text: this is stored and shown to an
          // admin, and a provider's message can carry internals.
          message: String(err.code ?? err.name ?? 'error'),
        });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return managerIds;
}

/**
 * @param {object} deps
 * @param {object} deps.store  directory store (modules/directory/store-*.js)
 * @param {() => Promise<import('../integrations/graph/index.js').GraphClient>} deps.getGraph
 * @param {{ info: Function, warn: Function, error: Function }} [deps.log]
 * @param {() => Date} [deps.now]
 */
export function createSyncRunner({ store, getGraph, log = logger, now = () => new Date() }) {
  /** True from the moment a start is accepted until its run has finished. */
  let busy = false;
  let current = Promise.resolve();

  async function execute(run, { req, allowLargeDeactivation }) {
    let result;
    try {
      const client = await getGraph();
      const graphUsers = await client.listUsers();
      const lookupWarnings = [];
      const managerIds = await fetchManagers(client, graphUsers, lookupWarnings);
      const state = await store.loadSyncState();
      const plan = planSync({
        graphUsers,
        managerIds: new Map([...managerIds].filter(([, v]) => v !== undefined)),
        state,
        allowLargeDeactivation,
        now: now(),
      });
      const warnings = [...lookupWarnings, ...plan.warnings];

      if (plan.abort) {
        result = {
          status: 'failed',
          created: 0,
          updated: 0,
          deactivated: 0,
          warnings: [plan.abort, ...warnings],
        };
      } else {
        await store.applySyncChanges(plan);
        result = {
          status: 'success',
          created: plan.counts.created,
          updated: plan.counts.updated,
          deactivated: plan.counts.deactivated,
          warnings,
        };
      }
    } catch (err) {
      log.error({ err }, 'user sync failed');
      result = {
        status: 'failed',
        created: 0,
        updated: 0,
        deactivated: 0,
        warnings: [{ code: 'error', message: String(err?.message ?? err).slice(0, 300) }],
      };
    }

    try {
      await store.transaction(async (tx) => {
        const finished = await tx.finishRun(run.id, { ...result, finishedAt: now() });
        await writeAudit(
          req ?? {},
          result.status === 'success' ? 'directory.sync' : 'directory.sync.failed',
          'SyncRun',
          null,
          {
            source: run.source,
            status: result.status,
            created: result.created,
            updated: result.updated,
            deactivated: result.deactivated,
            warnings: result.warnings.length,
            allowLargeDeactivation,
          },
          { tx, entityId: finished.id, companyId: null }
        );
      });
    } catch (err) {
      log.error({ err }, 'could not record the sync run');
    }
  }

  return {
    /**
     * Starts a run and returns it (status "running") without waiting for it.
     * @param {object} [options]
     * @param {'manual' | 'schedule'} [options.source]
     * @param {import('express').Request} [options.req]  the HoldingAdmin's request
     * @param {boolean} [options.allowLargeDeactivation]
     */
    async start({ source = 'manual', req = null, allowLargeDeactivation = false } = {}) {
      const inProgress = () =>
        new HttpError(409, 'sync_in_progress', 'A directory sync is already running.');
      if (busy) throw inProgress();
      busy = true;
      try {
        const since = new Date(now().getTime() - SYNC_STALE_MS);
        if (await store.findRunningRun(since)) throw inProgress();
        const run = await store.createRun({
          source,
          requestedById: req?.user?.id ?? null,
          startedAt: now(),
        });
        current = execute(run, { req, allowLargeDeactivation }).finally(() => {
          busy = false;
        });
        return run;
      } catch (err) {
        busy = false;
        throw err;
      }
    },

    /** Settles when the run in progress, if any, has finished. For tests. */
    idle: () => current,
  };
}

/** Cairo's calendar day and hour for an instant. */
export function cairoParts(date, timeZone = 'Africa/Cairo') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/**
 * Runs the sync once a night, in the first minute of the 02:00 Cairo hour
 * that the process is up for. With two app instances the job lease
 * (lib/job-lease.js), held for that hour, lets only one of them start it.
 * @returns {{ stop: () => void }}
 */
export function startNightlySync(
  runner,
  log = logger,
  { hour = 2, checkMs = 60_000, now = () => new Date(), lease, telemetry } = {}
) {
  let lastDay = null;
  const tick = async () => {
    const at = cairoParts(now());
    if (at.hour !== hour || at.day === lastDay) return;
    lastDay = at.day;
    try {
      await runLeased({ name: 'user-sync', periodMs: 60 * 60_000, lease, telemetry, log }, () =>
        runner.start({ source: 'schedule' })
      );
    } catch (err) {
      if (err?.code === 'sync_in_progress')
        log.info('nightly user sync skipped: already running');
      else log.error({ err }, 'nightly user sync could not start');
    }
  };
  const timer = setInterval(tick, checkMs);
  timer.unref();
  return { stop: () => clearInterval(timer), tick };
}
