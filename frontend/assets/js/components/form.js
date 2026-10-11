/**
 * components/form.js — the small pieces every admin form shares: a labelled
 * field with its help and error text, putting an error on a field, and a save
 * button that is disabled while it saves.
 *
 * A field's error element is always in the markup (empty, hidden) so that
 * aria-describedby has a stable target and the message is announced when it
 * fills in.
 */

import { esc } from '../html.js';
import { t } from '../i18n.js';
import { icon } from './icons.js';

/**
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.label  translated
 * @param {string} options.control  the input's markup, which carries id and aria-describedby
 * @param {string} [options.help]  translated
 * @param {boolean} [options.required]
 */
export function field({ id, label, control, help = '', required = false }) {
  return `<div class="field" data-field="${esc(id)}">
    <label class="field__label" for="${esc(id)}">
      <span>${esc(label)}</span>
      ${required ? `<span class="field__required">(${esc(t('field.required'))})</span>` : ''}
    </label>
    ${control}
    ${help ? `<p class="field__help" id="${esc(id)}-help">${esc(help)}</p>` : ''}
    <p class="field__error" id="${esc(id)}-error" role="alert" hidden></p>
  </div>`;
}

/** The ids an input should list in aria-describedby for `field()`. */
export function describedBy(id, hasHelp = true) {
  return hasHelp ? `${id}-help ${id}-error` : `${id}-error`;
}

/** Shows `message` under the field with this id, or clears it when empty. */
export function setFieldError(form, id, message) {
  const input = form.querySelector(`#${CSS.escape(id)}`);
  const error = form.querySelector(`#${CSS.escape(id)}-error`);
  if (!error) return;

  if (message) {
    error.innerHTML = `${icon('statusOverdue')}<span>${esc(message)}</span>`;
    error.hidden = false;
    input?.setAttribute('aria-invalid', 'true');
  } else {
    error.replaceChildren();
    error.hidden = true;
    input?.removeAttribute('aria-invalid');
  }
}

export function clearFieldErrors(form) {
  for (const error of form.querySelectorAll('.field__error')) {
    error.replaceChildren();
    error.hidden = true;
  }
  for (const input of form.querySelectorAll('[aria-invalid]'))
    input.removeAttribute('aria-invalid');
}

/** Moves focus to the first field that has an error, for a keyboard user. */
export function focusFirstError(form) {
  const bad = form.querySelector('[aria-invalid="true"]');
  bad?.focus();
}

/**
 * Puts a button in its saving state, and back. A disabled-by-attribute button
 * would drop out of the tab order mid-save; aria-busy keeps its place.
 */
export function setBusy(button, busy, label) {
  if (!button) return;
  button.setAttribute('aria-busy', String(busy));
  button.disabled = busy;
  const text = button.querySelector('.btn__label');
  if (text && label) text.textContent = label;
}
