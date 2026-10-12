/**
 * pages/admin/shared.js — what the admin sections have in common: saying what
 * a failed request meant, the status badge, and the tag for a company.
 */

import { errorKey } from '../../api.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';

/** Server error codes a form can say something specific about. */
const CODE_KEYS = {
  stale_record: 'admin.error.stale',
  code_taken: 'admin.error.codeTaken',
  domain_taken: 'admin.error.domainTaken',
  department_name_taken: 'admin.error.departmentNameTaken',
  accent_not_accessible: 'admin.error.accent',
  already_assigned: 'admin.error.alreadyAssigned',
  cannot_remove_own_role: 'admin.error.cannotRemoveOwn',
  last_holding_admin: 'admin.error.lastHoldingAdmin',
  unsupported_image: 'admin.error.unsupportedImage',
  logo_too_large: 'admin.error.logoTooLarge',
  empty_upload: 'admin.error.emptyUpload',
  nothing_to_change: 'admin.error.nothingToChange',
  mailbox_taken: 'admin.error.mailboxTaken',
  photo_too_large: 'admin.error.photoTooLarge',
  unknown_company: 'admin.error.unknownCompany',
  reason_required: 'admin.error.reasonRequired',
};

export const isStale = (err) => err?.code === 'stale_record';

/**
 * A sentence for a failed request, in the language in use.
 * @param {unknown} err  an ApiError
 */
export function errorText(err) {
  const key = CODE_KEYS[err?.code];
  if (key) return t(key, { domain: err.details?.domain ?? '' });
  const stem = errorKey(err);
  return `${t(`${stem}.title`)}. ${t(`${stem}.text`)}`;
}

/** The toast keys for a failure: its own sentence where there is one. */
export function toastKeys(err) {
  const specific = CODE_KEYS[err?.code];
  if (specific) return { titleKey: 'admin.error.title', textKey: specific };
  const stem = errorKey(err);
  return { titleKey: `${stem}.title`, textKey: `${stem}.text` };
}

/** Active or inactive, as a badge. Colour is never the only signal: it has words. */
export function statusBadge(isActive) {
  return isActive
    ? `<span class="badge badge--success">${esc(t('admin.status.active'))}</span>`
    : `<span class="badge">${esc(t('admin.status.inactive'))}</span>`;
}

/** A stacked name pair: the language in use first, the other under it. */
export function namePair(record) {
  const arabicFirst = document.documentElement.lang === 'ar';
  const en = `<span class="admin-name" lang="en" dir="ltr">${esc(record.nameEn)}</span>`;
  const ar = `<span class="admin-name" lang="ar" dir="rtl">${esc(record.nameAr)}</span>`;
  return arabicFirst ? ar + en : en + ar;
}

/** A person's name in the language in use. */
export function personName(person) {
  const own =
    document.documentElement.lang === 'ar' ? person.displayNameAr : person.displayNameEn;
  return own || person.displayNameEn;
}
