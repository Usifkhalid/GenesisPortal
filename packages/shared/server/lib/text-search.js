/**
 * text-search.js — the one normalisation that directory search and the stored
 * search key share, so a query and the text it is matched against always meet
 * in the same form.
 *
 * Latin: lower case, accents removed, hyphens and dots read as spaces
 * ("El-Sayed" finds "El Sayed"). Arabic: diacritics and tatweel removed, the
 * alef forms أ إ آ ٱ read as ا, ى as ي, ة as ه. Arabic-Indic digits become
 * Latin ones.
 */

const MARKS = /[̀-ًͯ-ٰٟـ]/g;

/** @param {unknown} value */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/[-_.'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words of a normalised query. */
export function searchTokens(query) {
  return normalizeText(query).split(' ').filter(Boolean).slice(0, 6);
}

/**
 * What UserProfile.searchKey holds: the fields a search may match, normalised.
 * @param {{ displayNameEn?: string, displayNameAr?: string, email?: string, jobTitle?: string | null }} user
 */
export function searchKeyOf(user) {
  return normalizeText(
    [user.displayNameEn, user.displayNameAr, user.email, user.jobTitle]
      .filter(Boolean)
      .join(' ')
  ).slice(0, 1000);
}
