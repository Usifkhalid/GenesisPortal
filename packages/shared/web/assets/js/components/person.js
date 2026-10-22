/**
 * components/person.js — how a person from the directory API is named and
 * drawn, shared by the directory, its detail panel and the top-bar search.
 *
 * A person has an English and an Arabic name, and the Arabic one may be empty
 * (sync never invents it). The name in the language in use comes first; the
 * other sits under it when there is one. A name that fell back to the other
 * language says so in its own lang and dir, so it reads and aligns correctly.
 */

import { esc } from '../html.js';
import { getLocale, localized } from '../i18n.js';
import { initials } from './initials.js';

export const dirOf = (lang) => (lang === 'ar' ? 'rtl' : 'ltr');

/**
 * @param {{ displayNameEn: string, displayNameAr?: string }} person
 * @returns {{ primary: { text: string, lang: string }, other: { text: string, lang: string } | null }}
 */
export function namesOf(person) {
  const own = getLocale() === 'ar' ? 'ar' : 'en';
  const textIn = (lang) => (lang === 'ar' ? person.displayNameAr : person.displayNameEn) || '';

  const primary = textIn(own)
    ? { text: textIn(own), lang: own }
    : { text: person.displayNameEn, lang: 'en' };
  const otherLang = own === 'ar' ? 'en' : 'ar';
  const otherText = textIn(otherLang);
  const other =
    otherText && otherText !== primary.text ? { text: otherText, lang: otherLang } : null;
  return { primary, other };
}

/** The person's name in the language in use, as plain text. */
export const displayName = (person) => namesOf(person).primary.text;

/** `lang` and `dir` attributes for a piece of text in a given language. */
export const langAttrs = (lang) => `lang="${lang}" dir="${dirOf(lang)}"`;

/** The Teams deep link that opens a one-to-one chat. */
export const teamsUrl = (email) =>
  `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email).replace('%40', '@')}`;

/** A number as a tel: link: digits and a leading plus only. */
export const telUrl = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;

export const avatarHtml = (person, size = '') =>
  `<span class="avatar${size ? ` avatar--${size}` : ''}" aria-hidden="true">${esc(
    initials(displayName(person))
  )}</span>`;

/**
 * A person as a card in the directory grid. The name is the link: it stretches
 * over the card, so the whole card is one target, and it has a real address
 * (#directory/<id>) for a new tab or a bookmark.
 */
export function personCardHtml(person) {
  const { primary, other } = namesOf(person);
  const department = person.department ? localized(person.department) : '';
  return `<li class="dir-card">
    ${avatarHtml(person, 'lg')}
    <div class="dir-card__text">
      <h2 class="dir-card__name">
        <a class="dir-card__link" href="#directory/${esc(person.id)}" data-person="${esc(person.id)}"
          ${langAttrs(primary.lang)}>${esc(primary.text)}</a>
      </h2>
      ${
        other
          ? `<p class="dir-card__other"><span ${langAttrs(other.lang)}>${esc(other.text)}</span></p>`
          : ''
      }
      ${person.jobTitle ? `<p class="dir-card__title">${esc(person.jobTitle)}</p>` : ''}
      ${department ? `<p class="dir-card__department">${esc(department)}</p>` : ''}
    </div>
    <span class="tag dir-card__company">${esc(localized(person.company))}</span>
  </li>`;
}
