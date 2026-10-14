/**
 * repo.js — the reads sign-in needs, over Prisma, and its two writes: a
 * profile made at first Entra sign-in and the bootstrap HoldingAdmin role
 * (provision.js).
 *
 * This is the one place that reads UserProfile and Company without going
 * through lib/scope.js, because it runs before there is a req.user to scope
 * by: it is what builds req.user. Nothing here takes input from a client
 * except an id or email that sign-in has already established.
 *
 * repo-memory.js implements the same interface over the seed data, for tests
 * and for development without SQL Server.
 */

import { getPrisma } from '../../lib/prisma.js';
import { ROLES as ROLE, itRoleOf } from '../../lib/roles.js';
import { searchKeyOf } from '../../lib/text-search.js';

const COMPANY = {
  id: true,
  code: true,
  nameEn: true,
  nameAr: true,
  accentColor: true,
  logoUrl: true,
  isActive: true,
};

const ROLES = { select: { role: true, scopeCompanyId: true } };

/** Memberships of active support teams: what makes someone IT staff (D135). */
const IT_MEMBERSHIPS = { where: { team: { isActive: true } }, select: { role: true } };

/** @param {() => Promise<import('@prisma/client').PrismaClient>} [getDb] */
export function createPrismaUserRepo(getDb = getPrisma) {
  return {
    /** Active companies, each with its active users and their roles. */
    async listCompaniesWithUsers() {
      const db = await getDb();
      const companies = await db.company.findMany({
        where: { isActive: true },
        select: {
          ...COMPANY,
          users: {
            where: { isActive: true },
            select: {
              id: true,
              displayNameEn: true,
              displayNameAr: true,
              jobTitle: true,
              roleAssignments: ROLES,
            },
          },
        },
      });
      return companies.map(({ users, ...company }) => ({
        ...company,
        users: users.map(({ roleAssignments, ...user }) => ({
          ...user,
          roles: roleAssignments,
        })),
      }));
    },

    /**
     * The signed-in person with their company, department and roles, and
     * `itRole` ('Lead' | 'Agent' | null) from their support-team memberships.
     */
    async getSessionUser(id) {
      const db = await getDb();
      const row = await db.userProfile.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          companyId: true,
          displayNameEn: true,
          displayNameAr: true,
          jobTitle: true,
          language: true,
          isActive: true,
          company: { select: COMPANY },
          department: { select: { nameEn: true, nameAr: true } },
          roleAssignments: ROLES,
          teamMemberships: IT_MEMBERSHIPS,
        },
      });
      if (!row) return null;
      const { roleAssignments, teamMemberships, ...user } = row;
      return { ...user, roles: roleAssignments, itRole: itRoleOf(teamMemberships) };
    },

    async findByEntraObjectId(entraObjectId) {
      const db = await getDb();
      return db.userProfile.findUnique({
        where: { entraObjectId },
        select: { id: true, isActive: true },
      });
    },

    async findByEmail(email) {
      const db = await getDb();
      return db.userProfile.findUnique({
        where: { email },
        select: { id: true, isActive: true },
      });
    },

    /** Records the real Entra object id on a profile first matched by email. */
    async linkEntraObjectId(id, entraObjectId) {
      const db = await getDb();
      await db.userProfile.update({ where: { id }, data: { entraObjectId } });
    },

    /** The company owning an email domain, by its main domain or another one. */
    async findCompanyByDomain(domain) {
      const db = await getDb();
      return db.company.findFirst({
        where: { OR: [{ domain }, { domains: { some: { domain } } }] },
        select: { id: true, isActive: true },
      });
    },

    /**
     * A new profile with the User role in its company; `audit(tx, created)`
     * writes in the same transaction (modules/auth/provision.js).
     */
    async createEntraProfile(profile, audit) {
      const db = await getDb();
      return db.$transaction(async (tx) => {
        const created = await tx.userProfile.create({
          data: {
            ...profile,
            searchKey: searchKeyOf(profile),
            roleAssignments: {
              create: { role: ROLE.USER, scopeCompanyId: profile.companyId },
            },
          },
          select: {
            id: true,
            isActive: true,
            entraObjectId: true,
            email: true,
            companyId: true,
            displayNameEn: true,
          },
        });
        await audit(tx, created);
        return created;
      });
    },

    /** Whether an active HoldingAdmin exists whose object id is not a stand-in. */
    async hasRealHoldingAdmin(standInPrefix) {
      const db = await getDb();
      const found = await db.roleAssignment.findFirst({
        where: {
          role: ROLE.HOLDING_ADMIN,
          scopeCompanyId: null,
          user: { isActive: true, NOT: { entraObjectId: { startsWith: standInPrefix } } },
        },
        select: { id: true },
      });
      return Boolean(found);
    },

    /** Adds the holding-wide HoldingAdmin role; false if they already had it. */
    async grantHoldingAdmin(userId, audit) {
      const db = await getDb();
      return db.$transaction(async (tx) => {
        const where = { userId, role: ROLE.HOLDING_ADMIN, scopeCompanyId: null };
        if (await tx.roleAssignment.findFirst({ where, select: { id: true } })) return false;
        const assignment = await tx.roleAssignment.create({ data: where });
        await audit(tx, assignment);
        return true;
      });
    },

    /**
     * Active companies by id; `null` for all of them. The ids come from
     * scopesOf(req.user), never from the client.
     * @param {string[] | null} ids
     */
    async listCompanies(ids) {
      const db = await getDb();
      return db.company.findMany({
        where: { isActive: true, ...(ids ? { id: { in: ids } } : {}) },
        select: COMPANY,
      });
    },
  };
}
