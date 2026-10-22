/**
 * components/star-rating.js — a 1 to 5 star rating that is really a group of
 * radio buttons.
 *
 *   starRatingField({ id, legend, help, required })   the input: five labelled
 *     radios drawn as stars, with a visible number under each, a word for the
 *     chosen one, an error line, all of it reachable and operable by keyboard
 *     (Tab into the group, arrow keys move and choose, as any radio group)
 *   bindStarRating(root)                              fills the stars as the
 *     choice changes; call it once on the element that holds the field
 *   starsReadout(stars)                               the finished rating, as
 *     read-only stars with the text "4 of 5 stars" for a screen reader
 *
 * Nothing here is directional by itself: the row follows the page direction,
 * so in Arabic 1 sits at the start (the right) like the first item of any list.
 * Every string is translated at call time (tk.rating.*).
 */

import { esc } from '../html.js';
import { formatNumber } from '../format.js';
import { t } from '../i18n.js';
import { icon } from './icons.js';

const STARS = [1, 2, 3, 4, 5];

/**
 * @param {object} options
 * @param {string} options.id  prefix of the ids the group needs
 * @param {string} options.legend  translated
 * @param {string} [options.help]  translated
 * @param {boolean} [options.required]
 * @param {number} [options.value]  the star already chosen, 0 for none
 */
export function starRatingField({ id, legend, help = '', required = false, value = 0 }) {
  const describedBy = `${help ? `${id}-help ` : ''}${id}-word ${id}-error`;
  return `<fieldset class="star-rating" data-star-rating="${esc(id)}" aria-describedby="${esc(describedBy)}">
    <legend class="field__label">
      <span>${esc(legend)}</span>
      ${required ? `<span class="field__required">(${esc(t('field.required'))})</span>` : ''}
    </legend>
    <div class="star-rating__options">
      ${STARS.map(
        (n) => `<label class="star-rating__option${n <= value ? ' is-on' : ''}">
          <input class="star-rating__input" type="radio" name="${esc(id)}" value="${n}"
            ${n === value ? 'checked' : ''} ${required ? 'required' : ''} />
          <span class="star-rating__face">
            ${icon('star', 'star-rating__icon')}
            <span class="star-rating__number" aria-hidden="true">${esc(formatNumber(n))}</span>
          </span>
          <span class="u-visually-hidden">${esc(t('tk.rating.option', { n: formatNumber(n) }))}</span>
        </label>`
      ).join('')}
    </div>
    <p class="star-rating__word" id="${esc(id)}-word" aria-live="polite">${esc(
      value ? t(`tk.rating.word.${value}`) : ''
    )}</p>
    ${help ? `<p class="field__help" id="${esc(id)}-help">${esc(help)}</p>` : ''}
    <p class="field__error" id="${esc(id)}-error" role="alert" hidden></p>
  </fieldset>`;
}

/** The star chosen in a group, 0 when none. */
export function starValue(root, id) {
  const chosen = root.querySelector(`input[name="${CSS.escape(id)}"]:checked`);
  return chosen ? Number(chosen.value) : 0;
}

/** Shows or clears the error under a group. */
export function setStarError(root, id, message) {
  const error = root.querySelector(`#${CSS.escape(id)}-error`);
  if (!error) return;
  error.hidden = !message;
  error.textContent = message ?? '';
}

/**
 * Keeps the stars up to date: stars up to the chosen one are filled, the word
 * names the choice, and a standing error goes away once a star is chosen.
 * @param {HTMLElement} root  holds one or more rating groups
 */
export function bindStarRating(root) {
  root.addEventListener('change', (event) => {
    const input = event.target.closest?.('.star-rating__input');
    if (!input) return;
    const group = input.closest('.star-rating');
    const chosen = Number(input.value);
    group.querySelectorAll('.star-rating__option').forEach((option, i) => {
      option.classList.toggle('is-on', i + 1 <= chosen);
    });
    group.querySelector('.star-rating__word').textContent = t(`tk.rating.word.${chosen}`);
    setStarError(root, group.dataset.starRating, '');
  });
}

/** A finished rating: filled stars and the words "4 of 5 stars" for assistive technology. */
export function starsReadout(stars) {
  const label = t('tk.rating.value', { n: formatNumber(stars) });
  return `<span class="star-rating star-rating--static" role="img" aria-label="${esc(label)}">
    ${STARS.map(
      (n) =>
        `<span class="star-rating__face${n <= stars ? ' is-on' : ''}">${icon('star', 'star-rating__icon')}</span>`
    ).join('')}
  </span>`;
}
