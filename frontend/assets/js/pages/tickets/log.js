/**
 * pages/tickets/log.js — "Log a ticket for someone": an agent writes up a
 * request that came in by phone or at the desk. The requester is chosen from
 * the directory, the source is recorded, and the ticket is theirs: they find
 * it in their own list and are the one who is answered.
 */

import { api } from '../../api.js';
import { openModal } from '../../components/dialog.js';
import { describedBy, field, setBusy, setFieldError } from '../../components/form.js';
import { createPeoplePicker } from '../../components/people-picker.js';
import { showToast } from '../../components/toast.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import { PRIORITIES, errorText, loadOptions, priorityLabel } from './shared.js';

const SOURCES = ['phone', 'walkIn'];

/**
 * @param {{ ctx: object }} options
 * @returns {Promise<object | null>} the ticket that was made, or null
 */
export async function openLogDialog() {
  let options;
  try {
    options = await loadOptions();
  } catch {
    showToast({
      tone: 'danger',
      titleKey: 'error.network.title',
      textKey: 'error.network.text',
    });
    return null;
  }

  const bodyHtml = `<form id="tkLogForm" class="stack" novalidate>
    <div id="tkLogWho"></div>
    <p class="field__error" id="tkLogWho-error" role="alert" hidden></p>

    <fieldset class="stack stack--tight admin-fieldset--plain">
      <legend class="field__label"><span>${esc(t('tk.log.source'))}</span>
        <span class="field__required">(${esc(t('field.required'))})</span></legend>
      <div class="tk-sources">
        ${SOURCES.map(
          (s, i) => `<label class="choice">
            <input class="choice__control" type="radio" name="source" value="${s}" ${i === 0 ? 'checked' : ''} />
            <span class="choice__text"><span class="choice__label">${esc(
              t(`tk.source.${s}`)
            )}</span></span>
          </label>`
        ).join('')}
      </div>
    </fieldset>

    <div class="field-row">
      <div class="field">
        <label class="field__label" for="tkLogCategory"><span>${esc(t('tk.field.category'))}</span>
          <span class="field__required">(${esc(t('field.required'))})</span></label>
        <select class="select" id="tkLogCategory" name="category" aria-describedby="tkLogCategory-error">
          <option value="">${esc(t('field.selectPlaceholder'))}</option>
          ${options.categories
            .map(
              (c) =>
                `<option value="${esc(c.id)}" data-priority="${esc(c.defaultPriority)}">${esc(
                  localized(c)
                )}</option>`
            )
            .join('')}
        </select>
        <p class="field__error" id="tkLogCategory-error" role="alert" hidden></p>
      </div>
      <div class="field">
        <label class="field__label" for="tkLogPriority">${esc(t('field.priority'))}</label>
        <select class="select" id="tkLogPriority" name="priority">
          ${PRIORITIES.map(
            (p) =>
              `<option value="${p}" ${p === 'P3' ? 'selected' : ''}>${esc(priorityLabel(p, true))}</option>`
          ).join('')}
        </select>
      </div>
    </div>

    ${field({
      id: 'tkLogSubject',
      label: t('field.subject'),
      required: true,
      control: `<input class="input" id="tkLogSubject" name="subject" type="text" maxlength="200"
        autocomplete="off" aria-describedby="${describedBy('tkLogSubject', false)}" />`,
    })}
    ${field({
      id: 'tkLogDescription',
      label: t('field.description'),
      required: true,
      control: `<textarea class="textarea" id="tkLogDescription" name="description" rows="4"
        maxlength="10000" aria-describedby="${describedBy('tkLogDescription', false)}"></textarea>`,
    })}

    <div class="field-row">
      <div class="field">
        <label class="field__label" for="tkLogLocation"><span>${esc(t('tk.field.location'))}</span>
          <span class="field__optional">(${esc(t('field.optional'))})</span></label>
        <select class="select" id="tkLogLocation" name="location">
          <option value="">${esc(t('tk.log.locationDefault'))}</option>
          ${options.locations.map((l) => `<option value="${esc(l.id)}">${esc(localized(l))}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="tkLogAsset"><span>${esc(t('tk.field.assetTag'))}</span>
          <span class="field__optional">(${esc(t('field.optional'))})</span></label>
        <input class="input" id="tkLogAsset" name="assetTag" type="text" maxlength="100"
          autocomplete="off" dir="ltr" />
      </div>
    </div>
  </form>`;

  const { dialog, close, closed } = openModal({
    title: t('tk.log.title'),
    bodyHtml,
    footerHtml: `<button type="button" class="btn btn--ghost" data-modal-close>
        <span class="btn__label">${esc(t('action.cancel'))}</span></button>
      <button type="submit" class="btn btn--primary" form="tkLogForm" id="tkLogSubmit">
        <span class="btn__label">${esc(t('tk.log.submit'))}</span></button>`,
  });

  const form = dialog.querySelector('#tkLogForm');
  const picker = createPeoplePicker({
    host: form.querySelector('#tkLogWho'),
    id: 'tkLogWhoInput',
    label: t('tk.log.who'),
    help: t('tk.log.whoHelp'),
    max: 1,
    required: true,
  });
  picker.onChange = () => {
    const error = form.querySelector('#tkLogWho-error');
    error.hidden = true;
    error.textContent = '';
  };

  // The category's default is the priority's starting value, as on the requester's form.
  form.elements.category.addEventListener('change', (event) => {
    const chosen = event.target.selectedOptions[0];
    if (chosen?.dataset.priority) form.elements.priority.value = chosen.dataset.priority;
    setFieldError(form, 'tkLogCategory', '');
  });
  form.elements.subject.addEventListener('input', () =>
    setFieldError(form, 'tkLogSubject', '')
  );
  form.elements.description.addEventListener('input', () =>
    setFieldError(form, 'tkLogDescription', '')
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = form.elements;
    const requesterId = picker.ids[0];
    const subject = f.subject.value.trim();
    const description = f.description.value.trim();
    const problems = [];

    const whoError = form.querySelector('#tkLogWho-error');
    whoError.hidden = Boolean(requesterId);
    whoError.textContent = requesterId ? '' : t('tk.log.whoError');
    if (!requesterId) problems.push(picker.input);

    setFieldError(form, 'tkLogCategory', f.category.value ? '' : t('tk.new.categoryError'));
    if (!f.category.value) problems.push(f.category);
    setFieldError(form, 'tkLogSubject', subject ? '' : t('field.subjectError'));
    if (!subject) problems.push(f.subject);
    setFieldError(form, 'tkLogDescription', description ? '' : t('tk.new.descriptionError'));
    if (!description) problems.push(f.description);
    if (problems.length) {
      problems[0].focus();
      return;
    }

    const button = dialog.querySelector('#tkLogSubmit');
    setBusy(button, true, t('action.saving'));
    try {
      const { ticket } = await api('/api/tickets', {
        method: 'POST',
        quiet: true,
        body: {
          requesterId,
          source: f.source.value,
          categoryId: f.category.value,
          priority: f.priority.value,
          subject,
          description,
          ...(f.location.value ? { locationId: f.location.value } : {}),
          ...(f.assetTag.value.trim() ? { assetTag: f.assetTag.value.trim() } : {}),
        },
      });
      showToast({
        tone: 'success',
        titleKey: 'tk.log.done',
        text: t('tk.log.doneText', { number: ticket.number }),
      });
      close(ticket);
    } catch (err) {
      setBusy(button, false, t('tk.log.submit'));
      showToast({ tone: 'danger', titleKey: 'tk.log.failed', text: errorText(err) });
    }
  });

  picker.input.focus();
  return (await closed) ?? null;
}
