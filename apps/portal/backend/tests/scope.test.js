import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ROLES } from '@mg/shared/server/lib/roles.js';
import {
  adminCompanyIdsFor,
  assertCompanyAccess,
  assertCompanyAdmin,
  assertHoldingAdmin,
  assertRecordAccess,
  canAccessCompany,
  canAdminCompany,
  companyIdsFor,
  isHoldingAdmin,
  requireUser,
  resolveCompanyId,
  scopeWhere,
} from '@mg/shared/server/lib/scope.js';

const HLD = 'company-hld';
const GEN = 'company-gen';
const MSR = 'company-msr';

const asReq = (companyId, roles) => ({
  user: { id: `user-of-${companyId}`, companyId, roles },
});

const holdingAdmin = asReq(HLD, [{ role: ROLES.HOLDING_ADMIN, scopeCompanyId: null }]);
const genAdmin = asReq(GEN, [{ role: ROLES.COMPANY_ADMIN, scopeCompanyId: GEN }]);
const genUser = asReq(GEN, [{ role: ROLES.USER, scopeCompanyId: GEN }]);
const msrUser = asReq(MSR, [{ role: ROLES.USER, scopeCompanyId: MSR }]);

const status = (code) => (err) => err.status === code;

/**
 * Applies a Prisma-style where to rows in memory: enough of the grammar
 * (equality, { in }, AND, OR) to show what a scoped query would return.
 */
function matches(row, where) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return cond.every((w) => matches(row, w));
    if (key === 'OR') return cond.some((w) => matches(row, w));
    if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(row[key]);
    return row[key] === cond;
  });
}

const ROWS = [
  { id: 1, companyId: HLD, status: 'open' },
  { id: 2, companyId: GEN, status: 'open' },
  { id: 3, companyId: GEN, status: 'closed' },
  { id: 4, companyId: MSR, status: 'open' },
];
const find = (where) => ROWS.filter((row) => matches(row, where)).map((row) => row.id);

describe('requireUser', () => {
  test('rejects a request with no signed-in user', () => {
    assert.throws(() => requireUser({}), status(401));
    assert.throws(() => scopeWhere({}), status(401));
    assert.throws(() => canAccessCompany({ user: { id: 'u' } }, GEN), status(401));
  });
});

describe('scopeWhere', () => {
  test('a user of one company reads only that company', () => {
    assert.deepEqual(scopeWhere(genUser), { companyId: GEN });
    assert.deepEqual(find(scopeWhere(genUser)), [2, 3]);
    assert.deepEqual(find(scopeWhere(msrUser)), [4]);
  });

  test("the caller's conditions narrow the scope", () => {
    assert.deepEqual(find(scopeWhere(genUser, { status: 'open' })), [2]);
  });

  test('a companyId in the conditions cannot reach another company', () => {
    assert.deepEqual(find(scopeWhere(genUser, { companyId: MSR })), []);
    assert.deepEqual(find(scopeWhere(genUser, { companyId: { in: [GEN, MSR] } })), [2, 3]);
  });

  test('an OR in the conditions cannot widen the scope', () => {
    const where = scopeWhere(genUser, { OR: [{ companyId: MSR }, { status: 'open' }] });
    assert.deepEqual(find(where), [2]);
  });

  test('a HoldingAdmin reads every company', () => {
    assert.deepEqual(scopeWhere(holdingAdmin), {});
    assert.deepEqual(find(scopeWhere(holdingAdmin)), [1, 2, 3, 4]);
    assert.deepEqual(find(scopeWhere(holdingAdmin, { companyId: MSR })), [4]);
  });

  test('an admin of a second company reads both', () => {
    const req = asReq(GEN, [{ role: ROLES.COMPANY_ADMIN, scopeCompanyId: MSR }]);
    assert.deepEqual(find(scopeWhere(req)), [2, 3, 4]);
  });

  test('the scoping column can be named', () => {
    assert.deepEqual(scopeWhere(genUser, {}, { field: 'id' }), { id: GEN });
  });
});

describe('roles', () => {
  test('HoldingAdmin counts only when holding-wide', () => {
    assert.equal(isHoldingAdmin(holdingAdmin), true);
    assert.equal(companyIdsFor(holdingAdmin), null);

    const scoped = asReq(GEN, [{ role: ROLES.HOLDING_ADMIN, scopeCompanyId: GEN }]);
    assert.equal(isHoldingAdmin(scoped), false);
    assert.deepEqual(companyIdsFor(scoped), [GEN]);
  });

  test('a User role scoped to another company grants nothing there', () => {
    const req = asReq(GEN, [{ role: ROLES.USER, scopeCompanyId: MSR }]);
    assert.deepEqual(companyIdsFor(req), [GEN]);
  });

  test('a user with no roles still has their own company and administers nothing', () => {
    const req = asReq(GEN, undefined);
    assert.deepEqual(companyIdsFor(req), [GEN]);
    assert.deepEqual(adminCompanyIdsFor(req), []);
  });
});

describe('company access', () => {
  test('a user cannot read or write another company', () => {
    assert.equal(canAccessCompany(genUser, GEN), true);
    assert.equal(canAccessCompany(genUser, MSR), false);
    assert.doesNotThrow(() => assertCompanyAccess(genUser, GEN));
    assert.throws(() => assertCompanyAccess(genUser, MSR), status(404));
    assert.throws(() => assertCompanyAccess(genAdmin, HLD), status(404));
  });

  test('a missing or malformed companyId is never in scope', () => {
    for (const bad of [undefined, null, '', 7, { in: [GEN] }, [GEN]]) {
      assert.equal(canAccessCompany(genUser, bad), false);
      assert.equal(canAdminCompany(genAdmin, bad), false);
    }
    assert.equal(canAccessCompany(holdingAdmin, undefined), false);
  });

  test('resolveCompanyId defaults to the own company and checks a requested one', () => {
    assert.equal(resolveCompanyId(genUser), GEN);
    assert.equal(resolveCompanyId(genUser, GEN), GEN);
    assert.throws(() => resolveCompanyId(genUser, MSR), status(404));
    assert.equal(resolveCompanyId(holdingAdmin, MSR), MSR);
    assert.equal(resolveCompanyId(holdingAdmin), HLD);
  });

  test('assertRecordAccess hides a foreign record as if it were missing', () => {
    const own = { id: 2, companyId: GEN };
    assert.equal(assertRecordAccess(genUser, own), own);
    assert.throws(() => assertRecordAccess(genUser, { id: 4, companyId: MSR }), status(404));
    assert.throws(() => assertRecordAccess(genUser, null), status(404));
    assert.throws(() => assertRecordAccess(genUser, { id: 9 }), status(404));
    assert.equal(assertRecordAccess(holdingAdmin, own), own);
  });
});

describe('admin access', () => {
  test('a CompanyAdmin administers only their company', () => {
    assert.equal(canAdminCompany(genAdmin, GEN), true);
    assert.equal(canAdminCompany(genAdmin, MSR), false);
    assert.doesNotThrow(() => assertCompanyAdmin(genAdmin, GEN));
    assert.throws(() => assertCompanyAdmin(genAdmin, MSR), status(404));
  });

  test('a plain User administers nothing, including their own company', () => {
    assert.equal(canAdminCompany(genUser, GEN), false);
    assert.throws(() => assertCompanyAdmin(genUser, GEN), status(403));
    assert.throws(() => assertCompanyAdmin(genUser, MSR), status(404));
  });

  test('a HoldingAdmin administers every company', () => {
    assert.equal(adminCompanyIdsFor(holdingAdmin), null);
    for (const id of [HLD, GEN, MSR])
      assert.doesNotThrow(() => assertCompanyAdmin(holdingAdmin, id));
    assert.doesNotThrow(() => assertHoldingAdmin(holdingAdmin));
    assert.throws(() => assertHoldingAdmin(genAdmin), status(403));
  });
});
