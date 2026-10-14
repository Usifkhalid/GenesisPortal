import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';

import { env } from '../src/config/env.js';
import { writeAudit } from '../src/lib/audit.js';
import { disconnectPrisma, getPrisma } from '../src/lib/prisma.js';
import { ROLES } from '../src/lib/roles.js';
import { createPrismaUserRepo } from '../src/modules/auth/repo.js';

/**
 * The sign-in repo's writes over real tables: the profile made at a first
 * Entra sign-in and the bootstrap HoldingAdmin role (provision.js), which
 * auth.test.js shows in memory. It makes a company of its own; the test
 * database is emptied before every run.
 */

async function findDatabase() {
  if (!env.hasDatabase) return { reason: 'DATABASE_URL is not configured' };
  try {
    const prisma = await getPrisma();
    await prisma.companyDomain.count();
    return { prisma };
  } catch {
    await disconnectPrisma();
    return { reason: 'the database is unreachable or not migrated' };
  }
}

describe('sign-in provisioning against SQL Server', async () => {
  const { prisma, reason } = await findDatabase();
  const tag = randomUUID().slice(0, 8);
  const repo = createPrismaUserRepo();

  test(
    'places by either domain, creates a profile and a HoldingAdmin role, audited',
    {
      skip: reason,
    },
    async () => {
      const company = await prisma.company.create({
        data: {
          code: `T${tag.slice(0, 6)}`.toUpperCase(),
          nameEn: `Provision ${tag}`,
          nameAr: `Provision ${tag}`,
          domain: `${tag}.provision.example`,
          accentColor: '#336699',
          domains: { create: { domain: `${tag}-alt.provision.example` } },
        },
      });

      assert.equal((await repo.findCompanyByDomain(`${tag}.provision.example`)).id, company.id);
      assert.equal(
        (await repo.findCompanyByDomain(`${tag}-alt.provision.example`)).id,
        company.id
      );
      assert.equal(await repo.findCompanyByDomain(`${tag}-none.provision.example`), null);

      const oid = randomUUID();
      const email = `new.person@${tag}.provision.example`;
      const audit = (action, entity, options) => (tx, row) =>
        writeAudit({ user: { id: row.userId ?? row.id } }, action, entity, null, row, {
          tx,
          ...options,
        });

      const person = await repo.createEntraProfile(
        {
          entraObjectId: oid,
          email,
          companyId: company.id,
          displayNameEn: 'New Person',
          displayNameAr: 'New Person',
        },
        audit('user.jit_create', 'UserProfile')
      );
      const row = await prisma.userProfile.findUnique({
        where: { id: person.id },
        include: { roleAssignments: true },
      });
      assert.equal(row.entraObjectId, oid);
      assert.match(row.searchKey, /new person/);
      assert.deepEqual(
        row.roleAssignments.map((r) => [r.role, r.scopeCompanyId]),
        [[ROLES.USER, company.id]]
      );
      assert.equal(await repo.findByEntraObjectId(oid).then((p) => p.id), person.id);

      assert.equal(
        await repo.grantHoldingAdmin(
          person.id,
          audit('role.bootstrap', 'RoleAssignment', { companyId: null })
        ),
        true
      );
      // Granted once only.
      assert.equal(
        await repo.grantHoldingAdmin(
          person.id,
          audit('role.bootstrap', 'RoleAssignment', { companyId: null })
        ),
        false
      );
      // This person has a real object id, so a real HoldingAdmin now exists.
      assert.equal(await repo.hasRealHoldingAdmin('00000000-0000-4000-'), true);

      const audits = await prisma.auditLog.findMany({
        where: { actorId: person.id },
        orderBy: { at: 'asc' },
      });
      assert.deepEqual(
        audits.map((a) => a.action),
        ['user.jit_create', 'role.bootstrap']
      );
      assert.equal(audits[0].companyId, company.id);
      assert.equal(audits[1].companyId, null);
    }
  );

  test('disconnects', { skip: reason }, async () => {
    await disconnectPrisma();
  });
});
