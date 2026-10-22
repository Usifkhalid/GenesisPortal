/**
 * refresh.js — at each Entra sign-in, the person's own profile is brought up
 * to date from Microsoft Graph with the token from that sign-in (User.Read),
 * so job title, department, office, phones and manager are right from day one
 * instead of waiting for the nightly sync (D138).
 *
 * The same rules as the nightly sync (jobs/syncUsers.js): company from Graph's
 * companyName when it names a portal company, otherwise from the email domain,
 * otherwise unchanged; department matched by name within that company; the
 * Arabic display name, language and roles are never touched. Nor are the
 * fields HR's staff list set (lib/hr-fields.js, D140): an HR company wins over
 * the email domain, and Graph only fills what HR left empty.
 *
 * /me/manager needs more than User.Read in most tenants. A refusal leaves the
 * manager as it is and is logged once per process, not at every sign-in.
 *
 * Nothing here may stop a sign-in: any failure is logged and the person signs
 * in with the profile they had. Only a real change is written and audited.
 */

import { writeAudit } from '../../lib/audit.js';
import { hrOwned, keepHrFields } from '../../lib/hr-fields.js';
import { normalizeText, searchKeyOf } from '../../lib/text-search.js';
import { domainOf } from './provision.js';

/** The fields Graph owns here, as UserProfile names them. */
export const REFRESHED_FIELDS = [
  'displayNameEn',
  'jobTitle',
  'officeLocation',
  'phone',
  'mobilePhone',
  'companyId',
  'departmentId',
  'graphDepartment',
  'graphCompanyName',
  'managerId',
];

const clean = (value, max = 200) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text.slice(0, max);
};

/**
 * Pure: what the person's row should become.
 * @param {object} input
 * @param {object} input.person  the UserProfile row (REFRESHED_FIELDS, email, displayNameAr)
 * @param {object} input.me  Graph's /me
 * @param {string | null | undefined} input.managerId  the manager's profile id;
 *   null for none, undefined when not known (left as it is)
 * @param {{ id: string, code: string, nameEn: string, nameAr: string, domains: string[] }[]} input.companies
 * @param {{ id: string, companyId: string, nameEn: string, nameAr: string }[]} input.departments
 * @returns {{ data: object, changed: string[] }}
 */
export function planProfileRefresh({ person, me, managerId, companies, departments }) {
  const graphCompanyName = clean(me.companyName);
  const domain = domainOf(person.email);
  const byName = graphCompanyName
    ? companies.find((c) =>
        [c.nameEn, c.nameAr, c.code].some(
          (n) => n && normalizeText(n) === normalizeText(graphCompanyName)
        )
      )
    : null;
  const byDomain = domain ? companies.find((c) => c.domains.includes(domain)) : null;
  const companyId = hrOwned(person).has('companyId')
    ? person.companyId
    : ((byName ?? byDomain)?.id ?? person.companyId);

  const graphDepartment = clean(me.department);
  const department = graphDepartment
    ? departments.find(
        (d) =>
          d.companyId === companyId &&
          [d.nameEn, d.nameAr].some(
            (n) => n && normalizeText(n) === normalizeText(graphDepartment)
          )
      )
    : null;

  const data = keepHrFields(person, {
    displayNameEn: clean(me.displayName) ?? person.displayNameEn,
    jobTitle: clean(me.jobTitle),
    officeLocation: clean(me.officeLocation),
    phone: clean(Array.isArray(me.businessPhones) ? me.businessPhones[0] : null, 50),
    mobilePhone: clean(me.mobilePhone, 50),
    companyId,
    departmentId: department?.id ?? null,
    graphDepartment,
    graphCompanyName,
    // Never oneself; unknown keeps what is there.
    managerId:
      managerId === undefined || managerId === person.id ? person.managerId : managerId,
  });
  const changed = REFRESHED_FIELDS.filter((k) => (person[k] ?? null) !== data[k]);
  if (changed.length === 0) return { data: {}, changed };

  const update = Object.fromEntries(changed.map((k) => [k, data[k]]));
  if (changed.includes('displayNameEn') || changed.includes('jobTitle')) {
    update.searchKey = searchKeyOf({ ...person, ...update });
  }
  return { data: update, changed };
}

/**
 * @param {object} deps
 * @param {object} deps.repo  loadProfileRefresh, findByEntraObjectId, updateProfileFromGraph
 * @param {ReturnType<import('../../integrations/graph/delegated.js').createDelegatedGraph>} deps.graph
 */
export function createProfileRefresher({ repo, graph }) {
  let managerRefusalLogged = false;

  /** Graph's manager as a profile id: null for none, undefined when not known. */
  async function managerOf(req, token) {
    try {
      const manager = await graph.getMyManager(token);
      if (!manager) return null;
      const found = await repo.findByEntraObjectId(manager.id.toLowerCase());
      return found?.id ?? null;
    } catch (err) {
      if (err?.code === 'forbidden') {
        if (!managerRefusalLogged) {
          managerRefusalLogged = true;
          req.log?.info(
            'sign-in profile refresh: /me/manager refused (needs more than User.Read); manager left to directory sync'
          );
        }
      } else {
        req.log?.warn(
          { cause: err?.code ?? err?.name },
          'sign-in profile refresh: manager lookup failed'
        );
      }
      return undefined;
    }
  }

  /**
   * Refreshes the person's profile; never throws.
   * @returns {Promise<string[]>} the fields that changed
   */
  return async function refresh(req, personId, token) {
    if (!token) return [];
    try {
      const me = await graph.getMe(token);
      if (!me) return [];
      const managerId = await managerOf(req, token);
      const { person, companies, departments } = await repo.loadProfileRefresh(personId);
      if (!person) return [];

      const { data, changed } = planProfileRefresh({
        person,
        me,
        managerId,
        companies,
        departments,
      });
      if (changed.length === 0) return [];

      const before = Object.fromEntries(changed.map((k) => [k, person[k] ?? null]));
      const after = Object.fromEntries(changed.map((k) => [k, data[k]]));
      await repo.updateProfileFromGraph(personId, data, (tx) =>
        writeAudit(
          { user: { id: personId }, ip: req.ip },
          'user.graph_refresh',
          'UserProfile',
          { id: personId, companyId: person.companyId, ...before },
          { id: personId, companyId: data.companyId ?? person.companyId, ...after },
          { tx }
        )
      );
      req.log?.info(
        { userId: personId, fields: changed },
        'profile refreshed from Graph at sign-in'
      );
      return changed;
    } catch (err) {
      req.log?.warn(
        { userId: personId, cause: err?.code ?? err?.name },
        'sign-in profile refresh failed; signing in with the profile as it was'
      );
      return [];
    }
  };
}
