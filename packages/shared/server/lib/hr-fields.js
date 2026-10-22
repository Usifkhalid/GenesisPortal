/**
 * hr-fields.js — which profile fields HR owns (D140).
 *
 * `npm run import:hr` sets company, department, job title and office from
 * HR's staff list and records which of them it set in UserProfile.hrFields.
 * From then on the nightly directory sync (jobs/syncUsers.js) and the sign-in
 * profile refresh (modules/auth/refresh.js) keep those values: Microsoft 365
 * only fills the fields HR left empty. A company set by HR also wins over the
 * mail domain.
 */

/** The UserProfile fields an HR import may own. */
export const HR_OWNED_FIELDS = ['companyId', 'departmentId', 'jobTitle', 'officeLocation'];

/**
 * The fields HR owns on this person.
 * @param {{ hrFields?: string | null }} person
 * @returns {Set<string>}
 */
export function hrOwned(person) {
  const listed = String(person?.hrFields ?? '')
    .split(',')
    .map((f) => f.trim());
  return new Set(listed.filter((f) => HR_OWNED_FIELDS.includes(f)));
}

/** The value hrFields stores for a set of owned fields, in a fixed order. */
export function hrFieldsValue(owned) {
  const list = HR_OWNED_FIELDS.filter((f) => owned.has(f));
  return list.length > 0 ? list.join(',') : null;
}

/**
 * `data` (what Microsoft 365 says) with every HR-owned field put back to the
 * person's current value. Returns a new object.
 * @template {object} T
 * @param {object} person  the row as it is, with hrFields
 * @param {T} data
 * @returns {T}
 */
export function keepHrFields(person, data) {
  const owned = hrOwned(person);
  if (owned.size === 0) return data;
  const kept = { ...data };
  for (const field of owned) {
    if (field in kept) kept[field] = person[field] ?? null;
  }
  return kept;
}
