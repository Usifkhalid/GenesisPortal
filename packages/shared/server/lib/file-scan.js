/**
 * file-scan.js — no uploaded file is handed out until it has been scanned for
 * malware and found clean.
 *
 * Every upload (logos, covers, room photos, ticket attachments) goes through
 * the storage this module wraps. Each file has one FileScan row:
 *
 *   pending   stored, not yet judged: `get` refuses with 409 file_scan_pending
 *   clean     served as before
 *   infected  blocked for good: the bytes are deleted, `get` refuses with 410
 *             file_blocked, and the uploader and the IT leads are told once
 *
 * A file with no row at all is treated as pending and checked on the spot, so
 * a missing verdict can never mean "serve it".
 *
 * Who judges is the scanner (SCAN_MODE):
 *   mock      for development and tests: clean at once, except the industry's
 *             harmless EICAR test file, which is reported infected so the
 *             blocked path can be seen working
 *   defender  Microsoft Defender for Storage scans each blob as it lands and
 *             writes the verdict on the blob as an index tag; the app reads
 *             that tag, right after upload, when the file is asked for, and
 *             from a sweep every minute (jobs/scanFiles.js)
 *
 * The signature checks (lib/image-type.js, lib/file-type.js) still run first,
 * in the modules: this is a second gate, not a replacement.
 */

import { HttpError } from '../middleware/errors.js';
import { logger } from './logger.js';
import { getPrisma } from './prisma.js';

export const SCAN = Object.freeze({ PENDING: 'pending', CLEAN: 'clean', INFECTED: 'infected' });

/** The EICAR test file: 68 harmless bytes every scanner reports as a virus. */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** A pending file older than this is worth a warning: the scanner may be off. */
const STUCK_AFTER_MS = 30 * 60 * 1000;

/** Rows looked at per sweep. */
const SWEEP_BATCH = 100;

/* ------------------------------------------------------------- scanners */

/** Development and tests. */
export function createMockScanner() {
  const judge = (buffer) =>
    buffer && buffer.includes(EICAR, 0, 'latin1') ? SCAN.INFECTED : SCAN.CLEAN;
  return {
    name: 'mock',
    /** The verdict on a file that has just been stored. */
    async scan(key, buffer) {
      return judge(buffer);
    },
    /** The verdict on a stored file, asked again later. */
    async check(key, storage) {
      const buffer = await storage.get(key);
      return buffer ? judge(buffer) : SCAN.PENDING;
    },
  };
}

/** The index tag Defender for Storage writes on a scanned blob, and its values. */
export const DEFENDER_TAG = 'Malware Scanning scan result';
const DEFENDER_VERDICTS = { 'no threats found': SCAN.CLEAN, malicious: SCAN.INFECTED };

/**
 * Microsoft Defender for Storage. It scans on upload (seconds to a few
 * minutes), so a new file starts as pending. Any tag value other than the two
 * known verdicts (a scan error, a file it would not scan) stays pending and
 * therefore blocked.
 */
export function createDefenderScanner() {
  const read = async (key, storage) => {
    const tags = (await storage.tags?.(key)) ?? {};
    return DEFENDER_VERDICTS[String(tags[DEFENDER_TAG] ?? '').toLowerCase()] ?? SCAN.PENDING;
  };
  return {
    name: 'defender',
    scan: async () => SCAN.PENDING,
    check: read,
  };
}

/** @param {{ SCAN_MODE: string }} config */
export function createScanner(config) {
  return config.SCAN_MODE === 'defender' ? createDefenderScanner() : createMockScanner();
}

/* --------------------------------------------------------------- stores */

/**
 * FileScan rows in SQL Server.
 * @param {object} [options]
 * @param {boolean} [options.supportTeams]  tell the leads of the support teams
 *   about an infected file. The IT Helpdesk does; the portal has no teams (D146).
 */
export function createPrismaScanStore(getDb = getPrisma, { supportTeams = true } = {}) {
  return {
    async get(storageKey) {
      return (await getDb()).fileScan.findUnique({ where: { storageKey } });
    },
    async getMany(storageKeys) {
      if (storageKeys.length === 0) return [];
      return (await getDb()).fileScan.findMany({ where: { storageKey: { in: storageKeys } } });
    },
    /** A new upload: pending, whatever a row under that key said before. */
    async start(row) {
      const db = await getDb();
      const { storageKey, ...values } = row;
      const reset = { ...values, state: SCAN.PENDING, scannedAt: null };
      if ((await db.fileScan.updateMany({ where: { storageKey }, data: reset })).count > 0)
        return;
      try {
        await db.fileScan.create({ data: { storageKey, ...reset } });
      } catch (err) {
        if (err?.code !== 'P2002') throw err;
      }
    },
    /** Pending → a verdict. True for the one caller that made the change. */
    async settle(storageKey, state, at) {
      const db = await getDb();
      const { count } = await db.fileScan.updateMany({
        where: { storageKey, state: SCAN.PENDING },
        data: { state, scannedAt: at },
      });
      return count === 1;
    },
    async remove(storageKey) {
      await (await getDb()).fileScan.deleteMany({ where: { storageKey } });
    },
    async pending(limit) {
      return (await getDb()).fileScan.findMany({
        where: { state: SCAN.PENDING },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
    },
    /** The leads of every active support team: who hears about an infected file. */
    async leadIds() {
      if (!supportTeams) return [];
      const rows = await (
        await getDb()
      ).supportTeamMember.findMany({
        where: { role: 'Lead', team: { isActive: true } },
        select: { userId: true },
      });
      return rows.map((r) => r.userId);
    },
  };
}

/**
 * The same over arrays, for tests and development without SQL Server.
 * @param {{ helpdesk?: { member: object[], team: object[] } }} [repo]  the in-memory user repo
 */
export function createMemoryScanStore(repo) {
  /** @type {Map<string, object>} */
  const rows = new Map();
  return {
    rows,
    async get(storageKey) {
      return rows.get(storageKey) ?? null;
    },
    async getMany(storageKeys) {
      return storageKeys.map((k) => rows.get(k)).filter(Boolean);
    },
    async start(row) {
      rows.set(row.storageKey, { ...row, state: SCAN.PENDING, scannedAt: null });
    },
    async settle(storageKey, state, at) {
      const row = rows.get(storageKey);
      if (!row || row.state !== SCAN.PENDING) return false;
      Object.assign(row, { state, scannedAt: at });
      return true;
    },
    async remove(storageKey) {
      rows.delete(storageKey);
    },
    async pending(limit) {
      return [...rows.values()].filter((r) => r.state === SCAN.PENDING).slice(0, limit);
    },
    async leadIds() {
      const active = new Set(
        (repo?.helpdesk?.team ?? []).filter((t) => t.isActive).map((t) => t.id)
      );
      return (repo?.helpdesk?.member ?? [])
        .filter((m) => m.role === 'Lead' && active.has(m.teamId))
        .map((m) => m.userId);
    },
  };
}

/* ------------------------------------------------------ scanned storage */

const notReady = (state) =>
  state === SCAN.INFECTED
    ? new HttpError(410, 'file_blocked', 'This file was blocked: it failed the malware scan.')
    : new HttpError(
        409,
        'file_scan_pending',
        'This file is still being checked. Try again soon.'
      );

/**
 * Wraps a storage adapter (lib/storage.js) so that nothing is read back
 * before it is clean. Same `put / get / remove`, plus:
 *
 *   put(key, buffer, { uploadedById, fileName, link })   who to tell if it is blocked
 *   states(keys) → Map<key, state>                       for lists that show a file's state
 *   sweep()                                              settle what is still pending
 *
 * @param {object} deps
 * @param {object} deps.storage  the adapter underneath
 * @param {object} deps.scans    a scan store (above)
 * @param {object} deps.scanner  a scanner (above)
 * @param {Function} [deps.notify]  lib/notify.js
 * @param {() => Date} [deps.now]
 * @param {{ warn: Function, info: Function }} [deps.log]
 */
export function createScannedStorage({
  storage,
  scans,
  scanner,
  notify,
  now = () => new Date(),
  log = logger,
}) {
  /** Records a verdict; on "infected" deletes the bytes and tells people, once. */
  async function settle(row, state) {
    if (state === SCAN.PENDING) return SCAN.PENDING;
    if (!(await scans.settle(row.storageKey, state, now()))) {
      // Someone else settled it first (the other instance, the sweep).
      return (await scans.get(row.storageKey))?.state ?? SCAN.PENDING;
    }
    if (state === SCAN.INFECTED) {
      log.warn(
        { storageKey: row.storageKey, uploadedById: row.uploadedById, scanner: scanner.name },
        'infected upload blocked'
      );
      await storage.remove(row.storageKey).catch((err) => {
        log.warn({ err, storageKey: row.storageKey }, 'infected file could not be deleted');
      });
      if (notify) {
        const to = [row.uploadedById, ...(await scans.leadIds().catch(() => []))];
        await notify(to, 'file.infected', {
          link: row.link ?? null,
          // One notice per file, whoever settles it and however often.
          dedupeKey: `file-infected:${row.storageKey}`,
          fileName: row.fileName ?? row.storageKey,
        });
      }
    }
    return state;
  }

  /** The file's state now, asking the scanner again when it is still pending. */
  async function resolve(key) {
    let row = await scans.get(key);
    if (row && row.state !== SCAN.PENDING) return row.state;
    if (!row) {
      // No verdict on record: never a reason to serve. Start one.
      row = {
        storageKey: key,
        uploadedById: null,
        fileName: null,
        link: null,
        createdAt: now(),
      };
      await scans.start(row);
    }
    return settle(row, await scanner.check(key, storage));
  }

  return {
    async put(key, buffer, meta = {}) {
      const row = {
        storageKey: key,
        uploadedById: meta.uploadedById ?? null,
        fileName: meta.fileName ? String(meta.fileName).slice(0, 200) : null,
        link: meta.link ? String(meta.link).slice(0, 200) : null,
        createdAt: now(),
      };
      // The row first: bytes without a verdict row would still be refused,
      // but a row without bytes is the cheaper thing to leave behind.
      await scans.start(row);
      await storage.put(key, buffer);
      return settle(row, await scanner.scan(key, buffer));
    },

    async get(key) {
      const state = await resolve(key);
      if (state !== SCAN.CLEAN) throw notReady(state);
      return storage.get(key);
    },

    async remove(key) {
      await storage.remove(key);
      await scans.remove(key);
    },

    /** @param {string[]} keys @returns {Promise<Map<string, string>>} */
    async states(keys) {
      const found = new Map((await scans.getMany(keys)).map((r) => [r.storageKey, r.state]));
      return new Map(keys.map((k) => [k, found.get(k) ?? SCAN.PENDING]));
    },

    /** Asks the scanner about everything still pending. For the timer. */
    async sweep() {
      const result = { clean: 0, infected: 0, pending: 0 };
      for (const row of await scans.pending(SWEEP_BATCH)) {
        try {
          const state = await settle(row, await scanner.check(row.storageKey, storage));
          result[state] += 1;
          if (state === SCAN.PENDING && now() - new Date(row.createdAt) > STUCK_AFTER_MS) {
            log.warn({ storageKey: row.storageKey }, 'file still unscanned after 30 minutes');
          }
        } catch (err) {
          result.pending += 1;
          log.warn({ err, storageKey: row.storageKey }, 'scan check failed');
        }
      }
      return result;
    },

    check: () => storage.check?.() ?? Promise.resolve(),
  };
}
