/**
 * repo.js — the reads sign-in needs, over Prisma.
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
import { itRoleOf } from '../../lib/roles.js';

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
