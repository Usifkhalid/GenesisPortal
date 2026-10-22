/**
 * components/dialog.js — modal dialogs and the side drawer, built on the
 * native <dialog>, which gives the focus trap, Escape and the backdrop.
 *
 * openModal returns the element and a promise that settles when it closes with
 * the value given to close(). confirmDialog is the common case: a question, a
 * Cancel and a confirm button, resolving true or false.
 *
 * Every string passed in is already translated.
 */

import { esc } from '../html.js';
import { t } from '../i18n.js';
import { icon } from './icons.js';

let counter = 0;

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.bodyHtml  trusted markup: escape data before it gets here
 * @param {string} [options.footerHtml]
 * @param {'dialog'|'drawer'} [options.kind]  a drawer sits against the inline end
 * @param {string} [options.lead]  small label above the title (the drawer's id line)
 * @returns {{ dialog: HTMLDialogElement, close: (value?: unknown) => void, closed: Promise<unknown> }}
 */
export function openModal({ title, bodyHtml, footerHtml = '', kind = 'dialog', lead = '' }) {
  counter += 1;
  const titleId = `modal-title-${counter}`;

  const dialog = document.createElement('dialog');
  dialog.className = kind === 'drawer' ? 'dialog dialog--drawer' : 'dialog';
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `<div class="dialog__form">
    <div class="dialog__header">
      <div class="dialog__titles">
        ${lead ? `<p class="u-microlabel">${esc(lead)}</p>` : ''}
        <h2 class="dialog__title" id="${titleId}">${esc(title)}</h2>
      </div>
      <button type="button" class="btn btn--ghost btn--sm btn--icon dialog__close"
        data-modal-close aria-label="${esc(t('a11y.closeDialog'))}">
        ${icon('x', 'btn__icon')}
      </button>
    </div>
    <div class="dialog__body stack">${bodyHtml}</div>
    ${footerHtml ? `<div class="dialog__footer">${footerHtml}</div>` : ''}
  </div>`;

  let result;
  const closed = new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
  });

  const close = (value) => {
    result = value;
    dialog.close();
  };

  dialog.addEventListener('click', (event) => {
    // The backdrop is the dialog element itself; the panel's own clicks are not.
    if (event.target === dialog) close(undefined);
    if (event.target.closest('[data-modal-close]')) close(undefined);
  });

  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close, closed };
}

/**
 * Asks before something that is hard to undo.
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.body
 * @param {string} options.confirmLabel
 * @param {'danger'|'primary'} [options.tone]
 * @returns {Promise<boolean>}
 */
export async function confirmDialog({ title, body, confirmLabel, tone = 'danger' }) {
  const { dialog, close, closed } = openModal({
    title,
    bodyHtml: `<p>${esc(body)}</p>`,
    footerHtml: `<button type="button" class="btn btn--ghost" data-modal-close>
        <span class="btn__label">${esc(t('action.cancel'))}</span>
      </button>
      <button type="button" class="btn btn--${tone}" data-confirm>
        <span class="btn__label">${esc(confirmLabel)}</span>
      </button>`,
  });
  dialog.querySelector('[data-confirm]').addEventListener('click', () => close(true));
  return (await closed) === true;
}
