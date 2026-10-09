/**
 * components/company-mark.js — a company's mark, and its name with the mark.
 *
 * The mark is the Company record's logo. A logo file is a finished tile: it
 * carries its own ground, so it reads the same on any surface and in either
 * theme, and it may be wider than it is tall. Without a logo the mark falls
 * back to the company's code on the current accent, so it is only correct for
 * the company the session is working in.
 *
 * A company here is the record the API returns:
 * { code, nameEn, nameAr, accentColor, logoUrl }.
 */

import { localized } from '../i18n.js';

/**
 * @param {{ code: string, logoUrl: string|null }} company
 * @param {{ small?: boolean }} [options] small sits inline beside running text.
 * @returns {HTMLSpanElement}
 */
export function companyMark(company, { small = false } = {}) {
  const mark = document.createElement('span');
  mark.setAttribute('aria-hidden', 'true');
  fillCompanyMark(mark, company, { small });
  return mark;
}

/** Redraws a mark element that is already in the page. */
export function fillCompanyMark(mark, company, { small = false } = {}) {
  mark.className = 'company-mark';
  mark.classList.toggle('company-mark--sm', small);
  mark.classList.toggle('company-mark--logo', Boolean(company.logoUrl));
  mark.replaceChildren();

  if (company.logoUrl) {
    // The name is always beside the mark or on its control, so the image
    // itself says nothing to a screen reader.
    const img = document.createElement('img');
    img.src = company.logoUrl;
    img.alt = '';
    img.decoding = 'async';
    mark.append(img);
  } else {
    mark.textContent = company.code;
  }
}

/**
 * The company's name with its mark before it, for running text.
 *
 * @param {{ code: string, nameEn: string, nameAr: string, logoUrl: string|null }} company
 * @returns {HTMLSpanElement}
 */
export function companyName(company) {
  const wrap = document.createElement('span');
  wrap.className = 'company-name';
  const name = document.createElement('span');
  name.textContent = localized(company);
  wrap.append(companyMark(company, { small: true }), name);
  return wrap;
}
