/**
 * fake-prisma.js — an in-memory stand-in for the few Prisma calls the seed and
 * the audit writer make, so their logic is tested without SQL Server. It
 * enforces the schema's unique keys, which is what makes a re-run meaningful.
 */

import { randomUUID } from 'node:crypto';

const UNIQUES = {
  company: [['code'], ['domain']],
  companyDomain: [['domain']],
  department: [['companyId', 'nameEn']],
  userProfile: [['email'], ['entraObjectId']],
  roleAssignment: [['userId', 'role', 'scopeCompanyId']],
  auditLog: [],
  room: [['mailboxEmail']],
  supportTeam: [['code']],
  supportTeamMember: [['teamId', 'userId']],
  supportTeamCompany: [['teamId', 'companyId']],
  businessCalendar: [['teamId']],
  slaPolicy: [['teamId', 'priority']],
  ticketCategory: [['teamId', 'nameEn']],
  cannedReply: [],
  ticketLocation: [['nameEn']],
  holiday: [['date']],
};

function table(name) {
  /** @type {Record<string, any>[]} */
  const rows = [];

  // { email } or { companyId_nameEn: { companyId, nameEn } } → flat conditions.
  const flatten = (where) =>
    Object.entries(where).flatMap(([key, value]) =>
      value && typeof value === 'object' ? Object.entries(value) : [[key, value]]
    );
  const findRow = (where) => rows.find((row) => flatten(where).every(([k, v]) => row[k] === v));

  function assertUnique(candidate) {
    for (const keys of UNIQUES[name]) {
      const clash = rows.find(
        (row) => row !== candidate && keys.every((k) => row[k] === candidate[k])
      );
      if (clash) throw new Error(`Unique constraint failed on ${name}(${keys.join(', ')})`);
    }
  }

  const create = async ({ data }) => {
    const row = { id: randomUUID(), ...data };
    assertUnique(row);
    rows.push(row);
    return row;
  };

  const update = async ({ where, data }) => {
    const row = findRow(where);
    if (!row) throw new Error(`${name}: record to update not found`);
    Object.assign(row, data);
    assertUnique(row);
    return row;
  };

  return {
    rows,
    create,
    update,
    findFirst: async ({ where }) => findRow(where) ?? null,
    findMany: async ({ where = {} } = {}) =>
      rows.filter((row) => flatten(where).every(([k, v]) => row[k] === v)),
    count: async ({ where = {} } = {}) =>
      rows.filter((row) => flatten(where).every(([k, v]) => row[k] === v)).length,
    upsert: async ({ where, update: changes, create: data }) =>
      findRow(where) ? update({ where, data: changes }) : create({ data }),
  };
}

export function createFakePrisma() {
  return Object.fromEntries(Object.keys(UNIQUES).map((name) => [name, table(name)]));
}
