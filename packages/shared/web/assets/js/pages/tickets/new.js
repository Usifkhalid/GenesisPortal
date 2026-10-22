/**
 * pages/tickets/new.js — raise a ticket. Short, and made for a phone:
 * what is it about (tiles), a subject, what happened, a file or a pasted
 * screenshot, where. There is no urgency question: the category's default
 * priority applies (D142).
 *
 * The ticket is created first, then each file is sent to it with its own
 * progress: the API has no ticket to attach a file to before that. A file
 * that fails does not undo the ticket; the confirmation says so.
 */

import {
  describedBy,
  field,
  focusFirstError,
  setBusy,
  setFieldError,
} from '../../components/form.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice, notice } from '../../components/notice.js';
import { showToast } from '../../components/toast.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import {
  announceChange,
  categoryIcon,
  createFileQueue,
  errorText,
  expectedBy,
  loadOptions,
  numberHtml,
  pair,
  pastedFiles,
  priorityLabel,
} from './shared.js';
import { api } from '../../api.js';

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 */
export async function render(root, ctx) {
  let options;
  try {
    options = await loadOptions();
  } catch {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  if (options.categories.length === 0) {
    root.innerHTML = notice({
      tone: 'info',
      mark: 'info',
      titleKey: 'tk.new.noCategoriesTitle',
      textKey: 'tk.new.noCategoriesText',
    });
    return undefined;
  }

  const { attachments: rules } = options;
  let submitting = false;

  const tiles = options.categories
    .map(
      (c) => `<li><label class="tk-tile">
        <input class="tk-tile__input" type="radio" name="category" value="${esc(c.id)}" />
        <span class="tk-tile__face">
          ${icon(categoryIcon(c), 'tk-tile__icon')}
          <span class="tk-tile__name">${esc(localized(c))}</span>
        </span>
      </label></li>`
    )
    .join('');

  const accept = rules.extensions.map((e) => `.${e}`).join(',');

  root.innerHTML = `<form class="card tk-form" id="tkNew" novalidate aria-labelledby="tkNewTitle">
    <div class="card__header">
      <div class="card__titles">
        <h2 class="card__title" id="tkNewTitle">${esc(t('tk.new.title'))}</h2>
        <p class="tk-form__lead">${esc(t('tk.new.lead'))}</p>
      </div>
    </div>

    <fieldset class="tk-fieldset" aria-describedby="tkCategory-error">
      <legend class="field__label">
        <span>${esc(t('tk.new.category'))}</span>
        <span class="field__required">(${esc(t('field.required'))})</span>
      </legend>
      <ul class="tk-tiles">${tiles}</ul>
      <p class="field__error" id="tkCategory-error" role="alert" hidden></p>
    </fieldset>

    ${field({
      id: 'tkSubject',
      label: t('field.subject'),
      required: true,
      help: t('tk.new.subjectHelp'),
      control: `<input class="input" id="tkSubject" name="subject" type="text" maxlength="200"
        autocomplete="off" aria-describedby="${describedBy('tkSubject')}" />`,
    })}

    ${field({
      id: 'tkDescription',
      label: t('field.description'),
      required: true,
      help: t('tk.new.descriptionHelp'),
      control: `<textarea class="textarea" id="tkDescription" name="description" rows="5"
        maxlength="10000" aria-describedby="${describedBy('tkDescription')}"></textarea>`,
    })}

    <div class="field tk-files">
      <span class="field__label"><span>${esc(t('field.attachments'))}</span>
        <span class="field__optional">(${esc(t('field.optional'))})</span></span>
      <div class="tk-files__bar">
        <input type="file" id="tkFile" multiple hidden accept="${esc(accept)}" />
        <button type="button" class="btn btn--secondary btn--sm" id="tkFileButton"
          aria-describedby="tkFile-help">
          ${icon('paperclip', 'btn__icon')}
          <span class="btn__label">${esc(t('tk.new.addFile'))}</span>
        </button>
        <p class="field__help" id="tkFile-help">${esc(
          t('tk.new.filesHelp', { count: rules.maxPerComment })
        )}</p>
      </div>
      <ul class="tk-filelist" id="tkFiles" hidden></ul>
      <p class="field__error" id="tkFile-error" role="alert" hidden></p>
    </div>

    <div class="field">
      <label class="field__label" for="tkLocation"><span>${esc(t('tk.new.location'))}</span>
        <span class="field__optional">(${esc(t('field.optional'))})</span></label>
      <select class="select" id="tkLocation" name="location">
        <option value="">${esc(t('tk.new.noLocation'))}</option>
        ${options.locations
          .map(
            (l) =>
              `<option value="${esc(l.id)}" ${
                l.id === options.defaultLocationId ? 'selected' : ''
              }>${esc(localized(l))}</option>`
          )
          .join('')}
      </select>
    </div>

    <div class="btn-row tk-form__actions">
      <button type="submit" class="btn btn--primary btn--lg" id="tkSubmit">
        ${icon('send', 'btn__icon', { directional: true })}
        <span class="btn__label">${esc(t('tk.new.submit'))}</span>
      </button>
    </div>
  </form>`;

  const form = root.querySelector('#tkNew');
  const submit = root.querySelector('#tkSubmit');
  const subject = form.elements.subject;
  const description = form.elements.description;

  form.addEventListener('change', (event) => {
    if (event.target.name === 'category') setFieldError(form, 'tkCategory', '');
  });
  subject.addEventListener('input', () => setFieldError(form, 'tkSubject', ''));
  description.addEventListener('input', () => setFieldError(form, 'tkDescription', ''));

  /* ------------------------------------------------------------------ files */
  const fileError = (message) => {
    const el = form.querySelector('#tkFile-error');
    el.hidden = !message;
    el.textContent = message ?? '';
  };
  const queue = createFileQueue({
    host: form.querySelector('#tkFiles'),
    rules,
    onProblem: fileError,
    onChange: () => {},
  });

  const fileInput = form.querySelector('#tkFile');
  fileInput.addEventListener('change', () => {
    fileError('');
    queue.add([...fileInput.files]);
    fileInput.value = '';
  });
  form.querySelector('#tkFileButton').addEventListener('click', () => fileInput.click());
  // Ctrl+V of a screenshot anywhere in the form. Text pastes are left alone.
  form.addEventListener('paste', (event) => {
    const images = pastedFiles(event);
    if (images.length === 0) return;
    event.preventDefault();
    fileError('');
    queue.add(images, { pasted: true });
    showToast({ tone: 'success', titleKey: 'tk.new.pasted' });
  });
  // A file dropped on the form on a desktop.
  form.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  });
  form.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    fileError('');
    queue.add([...event.dataTransfer.files]);
  });

  /* ----------------------------------------------------------------- submit */
  function confirmation(ticket, failed) {
    const expected = expectedBy(ticket);
    root.innerHTML = `<section class="card tk-done" id="tkDone" tabindex="-1" aria-labelledby="tkDoneTitle">
      <dl class="labelstrip">
        ${pair(t('ticket.number'), numberHtml(ticket.number))}
        ${pair(t('tk.field.category'), esc(localized(ticket.category)))}
        ${pair(t('tk.field.urgency'), esc(priorityLabel(ticket.priority)))}
        ${pair(expected.label, esc(expected.value))}
      </dl>
      <div class="tk-done__body">
        <div class="tk-done__title">
          ${icon('statusResolved', 'tk-done__icon')}
          <h2 class="card__title" id="tkDoneTitle">${esc(t('tk.done.title'))}</h2>
        </div>
        <p>${esc(t('tk.done.text'))}</p>
        ${
          failed.length
            ? `<div class="notice notice--warning" role="alert">
                ${icon('statusOverdue', 'notice__icon')}
                <div class="notice__content stack"><div>
                  <p class="notice__title">${esc(t('tk.done.filesFailedTitle', { count: failed.length }))}</p>
                  <p>${esc(t('tk.done.filesFailedText'))}</p>
                </div></div>
              </div>`
            : ''
        }
        <div class="btn-row">
          <a class="btn btn--primary" href="#tickets/${esc(ticket.id)}">
            <span class="btn__label">${esc(t('tk.done.view'))}</span>
          </a>
          <a class="btn btn--secondary" href="#tickets">
            <span class="btn__label">${esc(t('tk.done.mine'))}</span>
          </a>
          <button type="button" class="btn btn--ghost" data-another>
            <span class="btn__label">${esc(t('tk.done.another'))}</span>
          </button>
        </div>
      </div>
    </section>`;
    root.querySelector('[data-another]').addEventListener('click', () => render(root, ctx));
    root.querySelector('#tkDone').focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;

    const category = form.elements.category.value;
    const subjectText = subject.value.trim();
    const descriptionText = description.value.trim();
    setFieldError(form, 'tkCategory', category ? '' : t('tk.new.categoryError'));
    setFieldError(form, 'tkSubject', subjectText ? '' : t('field.subjectError'));
    setFieldError(form, 'tkDescription', descriptionText ? '' : t('tk.new.descriptionError'));
    if (!category || !subjectText || !descriptionText) {
      if (!category) form.querySelector('.tk-tile__input').focus();
      else focusFirstError(form);
      return;
    }

    submitting = true;
    setBusy(submit, true, t('action.saving'));
    let ticket;
    try {
      const location = form.elements.location.value;
      ({ ticket } = await api('/api/tickets', {
        method: 'POST',
        quiet: true,
        body: {
          subject: subjectText,
          description: descriptionText,
          categoryId: category,
          locationId: location || null,
        },
      }));
    } catch (err) {
      submitting = false;
      setBusy(submit, false, t('tk.new.submit'));
      showToast({ tone: 'danger', titleKey: 'tk.new.failed', text: errorText(err) });
      return;
    }
    announceChange();

    let failed = [];
    if (queue.size > 0) {
      for (const control of form.elements) control.disabled = true;
      ({ failed } = await queue.sendTo(ticket.id));
    }
    submitting = false;
    confirmation(ticket, failed);
  });

  return undefined;
}
