/**
 * Graph, mocked. Canned data lives in backend/mock/graph-users.json so that
 * every feature can be built and tested with no tenant: about forty people
 * across GEN, MSR and HLD, the twelve seeded users among them with the same ids
 * and emails, plus deliberate gaps for the data-quality report to find.
 *
 * `{ users, managers }`: managers maps a user id to their manager's id.
 */

import { readFileSync } from 'node:fs';

const FILE = new URL('../../../mock/graph-users.json', import.meta.url);

/**
 * @param {{ users?: object[], managers?: Record<string, string> }} [data]  a
 *   replacement data set, for tests
 * @returns {import('./index.js').GraphClient}
 */
export function createClient(data) {
  const { users, managers } = data ?? JSON.parse(readFileSync(FILE, 'utf8'));
  const byId = new Map(users.map((u) => [u.id, u]));

  return {
    mode: 'mock',

    async listUsers() {
      return users.map((u) => structuredClone(u));
    },

    async getManager(userId) {
      const manager = byId.get(managers[userId]);
      return manager
        ? { id: manager.id, displayName: manager.displayName, mail: manager.mail }
        : null;
    },
  };
}
