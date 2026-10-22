/**
 * Where the mocked Graph puts the mail it "sends". Two homes with one shape:
 * files under the app's backend/mock/outbox/ (development, so a person can open the
 * dev-only page and read what the portal would have sent) and an array (tests
 * and the in-memory portal, so a run leaves nothing on disk).
 *
 *   add(mail)  keeps one message, returns the stored copy (with id and sentAt)
 *   list()     newest first
 *   clear()
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

import { runtime } from '../../config/runtime.js';

/** The dev page shows the latest of these; older files are tidied away. */
const KEEP = 200;

/** @param {object[]} [rows] */
export function createMemoryOutbox(rows = []) {
  return {
    async add(mail) {
      const stored = { id: randomUUID(), sentAt: new Date().toISOString(), ...mail };
      rows.unshift(stored);
      return stored;
    },
    async list() {
      return rows.map((row) => ({ ...row }));
    },
    async clear() {
      rows.length = 0;
    },
  };
}

/** @param {URL} [dir] */
export function createFileOutbox(dir = runtime().outboxDir) {
  const names = async () => {
    try {
      return (await readdir(dir))
        .filter((n) => n.endsWith('.json'))
        .sort()
        .reverse();
    } catch (err) {
      if (err?.code === 'ENOENT') return [];
      throw err;
    }
  };

  return {
    async add(mail) {
      await mkdir(dir, { recursive: true });
      const stored = { id: randomUUID(), sentAt: new Date().toISOString(), ...mail };
      // Time first, so the file names sort in the order mail was sent.
      const name = `${stored.sentAt.replace(/[:.]/g, '-')}_${stored.id}.json`;
      await writeFile(new URL(name, dir), JSON.stringify(stored, null, 2), 'utf8');
      for (const old of (await names()).slice(KEEP)) {
        await rm(new URL(old, dir), { force: true });
      }
      return stored;
    },

    async list() {
      const out = [];
      for (const name of (await names()).slice(0, KEEP)) {
        try {
          out.push(JSON.parse(await readFile(new URL(name, dir), 'utf8')));
        } catch {
          // A half-written or hand-edited file is skipped, not fatal.
        }
      }
      return out;
    },

    async clear() {
      for (const name of await names()) await rm(new URL(name, dir), { force: true });
    },
  };
}
