/**
 * seed.js — development data: the companies in CLAUDE.md (HLD, GEN, MSR) and a
 * fake user per company and role for AUTH_MODE=mock to list.
 *
 * Nothing to seed yet: the schema has no models. Run with `npm run db:seed`.
 */

import { disconnectPrisma } from '../src/lib/prisma.js';

async function seed() {
  console.log('Nothing to seed: the schema has no models yet.');
}

try {
  await seed();
} finally {
  await disconnectPrisma();
}
