/**
 * pages/admin/rooms.js — the meeting rooms: the list, and the form that adds
 * or changes one. Holding admins only (the routes say the same).
 *
 *   #admin/rooms          every room, inactive ones too
 *   #admin/rooms/new      add a room from an Exchange room mailbox
 *   #admin/rooms/<id>     change it, its photo, or take it out of use
 *
 * A room is an Exchange resource mailbox the portal describes: two names, a
 * floor, seats, what is in it and which companies may book it. Nothing here
 * deletes a room; one that is no longer used is made inactive, so its past
 * bookings keep their room.
 */

import { ApiError, api } from '../../api.js';
import {
  clearFieldErrors,
  describedBy,
  field,
  focusFirstError,
  setBusy,
  setFieldError,
} from '../../components/form.js';
import { icon } from '../../components/icons.js';
import { showToast } from '../../components/toast.js';
import { formatNumber } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import { errorText, isStale, namePair, statusBadge, toastKeys } from './shared.js';

const EQUIPMENT = ['screen', 'videoConference', 'whiteboard', 'phone', 'other'];
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const PHOTO_MAX = 2 * 1024 * 1024;

/**
 * @param {HTMLElement} root
 * @param {{ scope: object, params: string[] }} ctx
 */
export async function render(root, ctx) {
  const [id] = ctx.params;
  if (id === 'new') return renderForm(root, ctx, null);
  if (id) return renderEdit(root, ctx, id);
  return renderList(root, ctx);
}

/* -------------------------------------------------------------------- list */

async function renderList(root, { scope }) {
  const { items } = await api('/api/admin/rooms');
  const codeOf = (companyId) => scope.companies.find((c) => c.id === companyId)?.code ?? '';

  const row = (room) => `<tr role="row" ${room.isActive ? '' : 'class="table__muted"'}>
    <td role="cell" data-label="${esc(t('room.name'))}">
      <a class="admin-names" href="#admin/rooms/${esc(room.id)}"
        aria-label="${esc(t('admin.rooms.editNamed', { name: localized(room) }))}">${namePair(room)}</a>
    </td>
    <td role="cell" data-label="${esc(t('admin.rooms.mailbox'))}">
      <span dir="ltr" class="admin-mail">${esc(room.mailboxEmail)}</span></td>
    <td role="cell" data-label="${esc(t('room.floor'))}">${esc(room.floor ?? t('audit.emptyValue'))}</td>
    <td role="cell" class="table__num" data-label="${esc(t('room.capacity'))}">${esc(
      formatNumber(room.capacity)
    )}</td>
    <td role="cell" data-label="${esc(t('rooms.find.equipment'))}">${esc(
      room.equipment.map((key) => t(`rooms.equipment.${key}`)).join(t('rooms.listJoin')) ||
        t('audit.emptyValue')
    )}</td>
    <td role="cell" data-label="${esc(t('admin.rooms.companies'))}">${esc(
      room.companyIds.length
        ? room.companyIds.map(codeOf).filter(Boolean).join(t('rooms.listJoin'))
        : t('rooms.detail.everyone')
    )}</td>
    <td role="cell" data-label="${esc(t('status.label'))}">${statusBadge(room.isActive)}</td>
  </tr>`;

  root.innerHTML = `
    <div class="admin__bar">
      <p class="admin-lead">${esc(t('admin.rooms.lead'))}</p>
      <a class="btn btn--primary" href="#admin/rooms/new">
        ${icon('plus', 'btn__icon')}
        <span class="btn__label">${esc(t('admin.rooms.add'))}</span>
      </a>
    </div>
    ${
      items.length === 0
        ? `<div class="empty empty--inline"><p class="empty__title">${esc(
            t('admin.rooms.empty')
          )}</p></div>`
        : `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
             aria-label="${esc(t('admin.rooms.caption'))}">
            <table class="table" role="table">
              <caption class="u-visually-hidden">${esc(t('admin.rooms.caption'))}</caption>
              <thead role="rowgroup"><tr role="row">
                <th role="columnheader" scope="col">${esc(t('room.name'))}</th>
                <th role="columnheader" scope="col">${esc(t('admin.rooms.mailbox'))}</th>
                <th role="columnheader" scope="col">${esc(t('room.floor'))}</th>
                <th role="columnheader" scope="col" class="table__num">${esc(t('room.capacity'))}</th>
                <th role="columnheader" scope="col">${esc(t('rooms.find.equipment'))}</th>
                <th role="columnheader" scope="col">${esc(t('admin.rooms.companies'))}</th>
                <th role="columnheader" scope="col">${esc(t('status.label'))}</th>
              </tr></thead>
              <tbody role="rowgroup">${items.map(row).join('')}</tbody>
            </table>
          </div>`
    }`;
  return undefined;
}

/* -------------------------------------------------------------------- form */

async function renderEdit(root, ctx, id) {
  const { items } = await api('/api/admin/rooms');
  const room = items.find((r) => r.id === id);
  if (!room) {
    root.innerHTML = `<div class="empty empty--inline"><p class="empty__title">${esc(
      t('error.notFound.title')
    )}</p></div>
      <p><a class="link-quiet" href="#admin/rooms">${esc(t('admin.rooms.back'))}</a></p>`;
    return undefined;
  }
  return renderForm(root, ctx, room);
}

async function renderForm(root, { scope }, existing) {
  let room = existing;
  const creating = !room;
  const companies = scope.companies.filter(
    (c) => c.isActive || room?.companyIds.includes(c.id)
  );

  // A new room is made from a mailbox Exchange has and the portal does not.
  let mailboxes = [];
  if (creating) {
    const all = (await api('/api/admin/rooms/mailboxes')).items;
    mailboxes = all.filter((m) => !m.roomId);
  }

  const checks = (name, options, chosen) =>
    options
      .map(
        ({ value, label }) => `<label class="choice choice--inline">
          <input class="choice__control" type="checkbox" name="${name}" value="${esc(value)}"
            ${chosen.includes(value) ? 'checked' : ''} />
          <span class="choice__text"><span class="choice__label">${esc(label)}</span></span>
        </label>`
      )
      .join('');

  root.innerHTML = `
    <p><a class="link-quiet" href="#admin/rooms">${esc(t('admin.rooms.back'))}</a></p>
    <form class="admin-form admin-form--single" id="roomForm" novalidate>
      <div class="stack">
        <fieldset class="card admin-fieldset">
          <legend class="card__title">${esc(
            creating ? t('admin.rooms.add') : t('admin.rooms.editTitle')
          )}</legend>
          <div class="stack">
            ${
              creating
                ? field({
                    id: 'r-mailbox',
                    label: t('admin.rooms.mailbox'),
                    required: true,
                    help: t('admin.rooms.mailboxHelp'),
                    control: `<select class="select" id="r-mailbox" name="mailboxEmail"
                      aria-describedby="${describedBy('r-mailbox')}">
                        <option value="">${esc(t('field.selectPlaceholder'))}</option>
                        ${mailboxes
                          .map(
                            (m) =>
                              `<option value="${esc(m.emailAddress)}">${esc(
                                `${m.displayName} · ${m.emailAddress}`
                              )}</option>`
                          )
                          .join('')}
                      </select>`,
                  })
                : `<dl class="labelstrip labelstrip--open">
                     <div class="labelstrip__pair">
                       <dt class="labelstrip__key">${esc(t('admin.rooms.mailbox'))}</dt>
                       <dd class="labelstrip__value"><span dir="ltr">${esc(room.mailboxEmail)}</span></dd>
                     </div>
                     <div class="labelstrip__pair">
                       <dt class="labelstrip__key">${esc(t('status.label'))}</dt>
                       <dd class="labelstrip__value">${statusBadge(room.isActive)}</dd>
                     </div>
                   </dl>`
            }
            <div class="field-row">
              ${field({
                id: 'r-nameEn',
                label: t('admin.field.nameEn'),
                required: true,
                control: `<input class="input" id="r-nameEn" name="nameEn" type="text" lang="en" dir="ltr"
                  maxlength="200" value="${esc(room?.nameEn ?? '')}"
                  aria-describedby="${describedBy('r-nameEn', false)}" />`,
              })}
              ${field({
                id: 'r-nameAr',
                label: t('admin.field.nameAr'),
                required: true,
                control: `<input class="input" id="r-nameAr" name="nameAr" type="text" lang="ar" dir="rtl"
                  maxlength="200" value="${esc(room?.nameAr ?? '')}"
                  aria-describedby="${describedBy('r-nameAr', false)}" />`,
              })}
            </div>
            <div class="field-row">
              ${field({
                id: 'r-floor',
                label: t('room.floor'),
                control: `<input class="input" id="r-floor" name="floor" type="text" maxlength="50"
                  value="${esc(room?.floor ?? '')}" aria-describedby="${describedBy('r-floor', false)}" />`,
              })}
              ${field({
                id: 'r-capacity',
                label: t('room.capacity'),
                required: true,
                control: `<input class="input" id="r-capacity" name="capacity" type="number"
                  inputmode="numeric" min="1" max="500" value="${esc(room?.capacity ?? '')}"
                  aria-describedby="${describedBy('r-capacity', false)}" />`,
              })}
            </div>
            ${field({
              id: 'r-notes',
              label: t('rooms.detail.notes'),
              help: t('admin.rooms.notesHelp'),
              control: `<textarea class="textarea" id="r-notes" name="notes" maxlength="1000" rows="3"
                aria-describedby="${describedBy('r-notes')}">${esc(room?.notes ?? '')}</textarea>`,
            })}
          </div>
        </fieldset>

        <fieldset class="card admin-fieldset">
          <legend class="card__title">${esc(t('rooms.find.equipment'))}</legend>
          <div class="admin-checks">${checks(
            'equipment',
            EQUIPMENT.map((key) => ({ value: key, label: t(`rooms.equipment.${key}`) })),
            room?.equipment ?? []
          )}</div>
        </fieldset>

        <fieldset class="card admin-fieldset">
          <legend class="card__title">${esc(t('admin.rooms.companies'))}</legend>
          <p class="field__help">${esc(t('admin.rooms.companiesHelp'))}</p>
          <div class="admin-checks">${checks(
            'companyIds',
            companies.map((c) => ({ value: c.id, label: `${c.code} · ${localized(c)}` })),
            room?.companyIds ?? []
          )}</div>
        </fieldset>

        ${
          creating
            ? ''
            : `<fieldset class="card admin-fieldset">
                <legend class="card__title">${esc(t('admin.rooms.photoTitle'))}</legend>
                <div class="admin-photo">
                  <div id="photoTile" class="admin-photo__tile"></div>
                  <div class="stack stack--tight">
                    ${field({
                      id: 'r-photo',
                      label: t('admin.rooms.photo'),
                      help: t('admin.rooms.photoHelp'),
                      control: `<input class="input" id="r-photo" type="file"
                        accept="${PHOTO_TYPES.join(',')}" aria-describedby="${describedBy('r-photo')}" />`,
                    })}
                    <div><button type="button" class="btn btn--ghost btn--sm" id="photoRemove">
                      <span class="btn__label">${esc(t('admin.rooms.photoRemove'))}</span>
                    </button></div>
                  </div>
                </div>
              </fieldset>
              <fieldset class="card admin-fieldset">
                <legend class="card__title">${esc(t('admin.rooms.useTitle'))}</legend>
                <label class="choice">
                  <input class="choice__control" type="checkbox" name="isActive"
                    ${room.isActive ? 'checked' : ''} />
                  <span class="choice__text">
                    <span class="choice__label">${esc(t('admin.rooms.active'))}</span>
                    <span class="choice__help">${esc(t('admin.rooms.activeHelp'))}</span>
                  </span>
                </label>
              </fieldset>`
        }

        <p class="field__error" id="roomError" role="alert" hidden></p>
        <div class="btn-row admin-form__actions">
          <button type="submit" class="btn btn--primary" id="roomSave">
            <span class="btn__label">${esc(t(creating ? 'admin.rooms.create' : 'action.saveChanges'))}</span>
          </button>
          <a class="btn btn--ghost" href="#admin/rooms">
            <span class="btn__label">${esc(t('action.cancel'))}</span>
          </a>
        </div>
      </div>
    </form>`;

  const form = root.querySelector('#roomForm');
  const save = root.querySelector('#roomSave');
  const errorLine = root.querySelector('#roomError');
  const checked = (name) =>
    [...form.querySelectorAll(`[name="${name}"]:checked`)].map((box) => box.value);

  function say(message) {
    errorLine.innerHTML = message ? `${icon('statusOverdue')}<span>${esc(message)}</span>` : '';
    errorLine.hidden = !message;
  }

  function failed(err) {
    if (isStale(err)) {
      showToast({
        tone: 'warning',
        titleKey: 'admin.error.staleTitle',
        textKey: 'admin.error.stale',
      });
      return;
    }
    if (err instanceof ApiError && err.code === 'mailbox_taken') {
      setFieldError(form, 'r-mailbox', errorText(err));
      focusFirstError(form);
      return;
    }
    if (err instanceof ApiError && err.status === 400) {
      say(errorText(err));
      return;
    }
    showToast({ tone: 'danger', ...toastKeys(err) });
  }

  // A field put right stops saying it is wrong, without waiting for Save.
  form.addEventListener('input', (event) => {
    if (event.target.id) setFieldError(form, event.target.id, '');
  });

  /* ---- a chosen mailbox fills in what Exchange already knows */
  form.elements.mailboxEmail?.addEventListener('change', (event) => {
    const mailbox = mailboxes.find((m) => m.emailAddress === event.target.value);
    if (!mailbox) return;
    clearFieldErrors(form);
    if (!form.elements.nameEn.value) form.elements.nameEn.value = mailbox.displayName ?? '';
    if (!form.elements.capacity.value && mailbox.capacity) {
      form.elements.capacity.value = String(mailbox.capacity);
    }
    if (!form.elements.floor.value && mailbox.floorLabel) {
      form.elements.floor.value = mailbox.floorLabel;
    }
  });

  /* ---- photo: saved as soon as it is chosen, like a company's logo */
  function drawPhoto() {
    const tile = root.querySelector('#photoTile');
    if (!tile) return;
    tile.innerHTML = room.photoUrl
      ? `<img class="admin-photo__img" src="${esc(room.photoUrl)}" alt="" loading="lazy" decoding="async" />`
      : `<span class="admin-photo__none">${esc(t('rooms.detail.noPhoto'))}</span>`;
    root.querySelector('#photoRemove').hidden = !room.photoUrl;
  }

  const photoInput = root.querySelector('#r-photo');
  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files[0];
    setFieldError(form, 'r-photo', '');
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setFieldError(form, 'r-photo', t('admin.rooms.photoType'));
      photoInput.value = '';
      return;
    }
    if (file.size > PHOTO_MAX) {
      setFieldError(form, 'r-photo', t('admin.rooms.photoTooLarge'));
      photoInput.value = '';
      return;
    }
    try {
      room = await api(
        `/api/admin/rooms/${room.id}/photo?updatedAt=${encodeURIComponent(room.updatedAt)}`,
        { method: 'PUT', body: file, quiet: true }
      );
      showToast({ tone: 'success', titleKey: 'admin.rooms.photoSaved' });
      drawPhoto();
    } catch (err) {
      setFieldError(form, 'r-photo', errorText(err));
    }
    photoInput.value = '';
  });

  root.querySelector('#photoRemove')?.addEventListener('click', async () => {
    try {
      room = await api(
        `/api/admin/rooms/${room.id}/photo?updatedAt=${encodeURIComponent(room.updatedAt)}`,
        { method: 'DELETE', quiet: true }
      );
      showToast({ tone: 'success', titleKey: 'admin.rooms.photoRemoved' });
      drawPhoto();
      photoInput.focus();
    } catch (err) {
      failed(err);
    }
  });

  /* ---- save */
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    say('');

    const values = {
      nameEn: form.elements.nameEn.value.trim(),
      nameAr: form.elements.nameAr.value.trim(),
      floor: form.elements.floor.value.trim() || null,
      capacity: Number(form.elements.capacity.value),
      notes: form.elements.notes.value.trim(),
      equipment: checked('equipment'),
      companyIds: checked('companyIds'),
    };
    if (creating && !form.elements.mailboxEmail.value) {
      setFieldError(form, 'r-mailbox', t('admin.rooms.mailboxRequired'));
    }
    if (!values.nameEn) setFieldError(form, 'r-nameEn', t('admin.error.nameRequired'));
    if (!values.nameAr) setFieldError(form, 'r-nameAr', t('admin.error.nameRequired'));
    if (!Number.isInteger(values.capacity) || values.capacity < 1 || values.capacity > 500) {
      setFieldError(form, 'r-capacity', t('admin.rooms.capacityError'));
    }
    if (form.querySelector('[aria-invalid="true"]')) {
      focusFirstError(form);
      return;
    }

    setBusy(save, true, t('action.saving'));
    try {
      if (creating) {
        await api('/api/admin/rooms', {
          method: 'POST',
          quiet: true,
          body: { mailboxEmail: form.elements.mailboxEmail.value, ...values },
        });
        showToast({ tone: 'success', titleKey: 'admin.rooms.created' });
      } else {
        await api(`/api/admin/rooms/${room.id}`, {
          method: 'PATCH',
          quiet: true,
          body: {
            updatedAt: room.updatedAt,
            ...values,
            isActive: form.elements.isActive.checked,
          },
        });
        showToast({ tone: 'success', titleKey: 'admin.toast.saved' });
      }
      location.hash = '#admin/rooms';
    } catch (err) {
      setBusy(save, false, t(creating ? 'admin.rooms.create' : 'action.saveChanges'));
      failed(err);
    }
  });

  drawPhoto();
  return undefined;
}
