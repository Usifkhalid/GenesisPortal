/**
 * pages/admin/companies.js — the companies list, and the create and edit form.
 *
 * Adding a company is configuration, never code: a code, two names, a mail
 * domain, a logo and one accent colour. The accent is judged here, live, by
 * the same rule the server applies on save (accent.js); the preview beside the
 * form re-derives every brand value from it in CSS, in light and in dark.
 */

import { checkAccent } from '../../accent.js';
import { ApiError, api } from '../../api.js';
import { confirmDialog } from '../../components/dialog.js';
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

const CODE = /^[A-Z]{2,5}$/;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX = 512 * 1024;
const DEFAULT_ACCENT = '#1c7a4a';

/**
 * @param {HTMLElement} root
 * @param {{ params: string[], reload: () => void }} ctx
 */
export async function render(root, ctx) {
  const [id] = ctx.params;
  if (id === 'new') return renderForm(root, ctx, null);
  if (id) return renderEdit(root, ctx, id);
  return renderList(root);
}

/* -------------------------------------------------------------------- list */

async function renderList(root) {
  let filter = 'active';
  const { items } = await api('/api/admin/companies?status=all');

  const draw = () => {
    const shown = items.filter((c) => filter === 'all' || (filter === 'active') === c.isActive);
    root.innerHTML = `
      <div class="admin__bar">
        <div class="segmented" role="group" aria-label="${esc(t('admin.companies.filter'))}">
          ${['all', 'active', 'inactive']
            .map(
              (key) => `<button type="button" class="segmented__option" data-filter="${key}"
                aria-pressed="${key === filter}">${esc(t(`admin.filter.${key}`))}</button>`
            )
            .join('')}
        </div>
        <a class="btn btn--primary" href="#admin/companies/new">
          ${icon('plus', 'btn__icon')}
          <span class="btn__label">${esc(t('admin.companies.new'))}</span>
        </a>
      </div>
      ${
        shown.length === 0
          ? `<div class="empty empty--inline"><p class="empty__title">${esc(
              t('admin.companies.empty')
            )}</p></div>`
          : `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
               aria-label="${esc(t('admin.companies.caption'))}">
              <table class="table" role="table">
                <caption class="u-visually-hidden">${esc(t('admin.companies.caption'))}</caption>
                <thead role="rowgroup"><tr role="row">
                  <th role="columnheader" scope="col">${esc(t('admin.field.code'))}</th>
                  <th role="columnheader" scope="col">${esc(t('admin.field.names'))}</th>
                  <th role="columnheader" scope="col">${esc(t('admin.field.domain'))}</th>
                  <th role="columnheader" scope="col">${esc(t('admin.field.accent'))}</th>
                  <th role="columnheader" scope="col">${esc(t('status.label'))}</th>
                  <th role="columnheader" scope="col" class="table__num">${esc(
                    t('admin.field.users')
                  )}</th>
                  <th role="columnheader" scope="col"><span class="u-visually-hidden">${esc(
                    t('admin.field.actions')
                  )}</span></th>
                </tr></thead>
                <tbody role="rowgroup">${shown.map(rowHtml).join('')}</tbody>
              </table>
            </div>`
      }`;

    for (const button of root.querySelectorAll('[data-filter]')) {
      button.addEventListener('click', () => {
        filter = button.dataset.filter;
        draw();
        root.querySelector(`[data-filter="${filter}"]`).focus();
      });
    }
  };

  draw();
}

function rowHtml(company) {
  const name = localized(company);
  return `<tr role="row">
    <th role="rowheader" scope="row" data-label="${esc(t('admin.field.code'))}">
      <span class="admin-code">${esc(company.code)}</span>
    </th>
    <td role="cell" data-label="${esc(t('admin.field.names'))}">
      <span class="admin-names">${namePair(company)}</span>
    </td>
    <td role="cell" data-label="${esc(t('admin.field.domain'))}">
      <span class="admin-domains" dir="ltr">${company.domains.map(esc).join('<br />')}</span>
    </td>
    <td role="cell" data-label="${esc(t('admin.field.accent'))}">
      <span class="swatch-label">
        <span class="swatch" style="--swatch: ${esc(company.accentColor)}" aria-hidden="true"></span>
        <span dir="ltr">${esc(company.accentColor)}</span>
      </span>
    </td>
    <td role="cell" data-label="${esc(t('status.label'))}">${statusBadge(company.isActive)}</td>
    <td role="cell" class="table__num" data-label="${esc(t('admin.field.users'))}">${esc(
      formatNumber(company.userCount)
    )}</td>
    <td role="cell" class="admin-actions">
      <a class="btn btn--secondary btn--sm" href="#admin/companies/${esc(company.id)}"
        aria-label="${esc(t('admin.companies.editNamed', { name }))}">
        <span class="btn__label">${esc(t('action.edit'))}</span>
      </a>
    </td>
  </tr>`;
}

/* -------------------------------------------------------------------- edit */

async function renderEdit(root, ctx, id) {
  let company;
  try {
    company = await api(`/api/admin/companies/${encodeURIComponent(id)}`, { quiet: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      root.innerHTML = `<div class="empty empty--inline"><p class="empty__title">${esc(
        t('admin.companies.notFound')
      )}</p><a class="btn btn--secondary" href="#admin/companies">${esc(
        t('admin.companies.back')
      )}</a></div>`;
      return;
    }
    throw err;
  }
  return renderForm(root, ctx, company);
}

/* -------------------------------------------------------------------- form */

function renderForm(root, ctx, company) {
  const isNew = company === null;
  const initial = {
    code: company?.code ?? '',
    nameEn: company?.nameEn ?? '',
    nameAr: company?.nameAr ?? '',
    domains: (company?.domains ?? []).join('\n'),
    accentColor: company?.accentColor ?? DEFAULT_ACCENT,
    showMobile: company?.showMobileInDirectory === true,
  };
  /** The logo a person picked and has not saved yet. */
  let pendingLogo = null;
  let previewUrl = null;

  const title = isNew ? t('admin.companies.new') : localized(company);

  root.innerHTML = `
    <nav class="breadcrumb" aria-label="${esc(t('breadcrumb.label'))}">
      <ol class="breadcrumb__list">
        <li class="breadcrumb__item"><a class="breadcrumb__link" href="#admin/companies">${esc(
          t('admin.nav.companies')
        )}</a><span class="breadcrumb__sep" aria-hidden="true">/</span></li>
        <li class="breadcrumb__item" aria-current="page">${esc(title)}</li>
      </ol>
    </nav>
    <div id="formNotice"></div>
    <form class="admin-form" id="companyForm" novalidate>
      <div class="admin-form__main stack">
        <fieldset class="card admin-fieldset">
          <legend class="card__title">${esc(t('admin.companies.identity'))}</legend>
          ${field({
            id: 'f-code',
            label: t('admin.field.code'),
            required: true,
            help: t(isNew ? 'admin.help.code' : 'admin.help.codeLocked'),
            control: `<input class="input admin-code-input" id="f-code" type="text" dir="ltr"
              maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false"
              value="${esc(initial.code)}" ${isNew ? '' : 'readonly'}
              aria-describedby="${describedBy('f-code')}" />`,
          })}
          <div class="field-row admin-names-row">
            ${field({
              id: 'f-nameEn',
              label: t('admin.field.nameEn'),
              required: true,
              control: `<input class="input" id="f-nameEn" type="text" lang="en" dir="ltr"
                maxlength="200" value="${esc(initial.nameEn)}"
                aria-describedby="${describedBy('f-nameEn', false)}" />`,
            })}
            ${field({
              id: 'f-nameAr',
              label: t('admin.field.nameAr'),
              required: true,
              control: `<input class="input" id="f-nameAr" type="text" lang="ar" dir="rtl"
                maxlength="200" value="${esc(initial.nameAr)}"
                aria-describedby="${describedBy('f-nameAr', false)}" />`,
            })}
          </div>
          ${field({
            id: 'f-domains',
            label: t('admin.field.domains'),
            required: true,
            help: t('admin.help.domains'),
            control: `<textarea class="textarea" id="f-domains" rows="2" dir="ltr"
              autocapitalize="none" spellcheck="false"
              aria-describedby="${describedBy('f-domains')}">${esc(initial.domains)}</textarea>`,
          })}
        </fieldset>

        <fieldset class="card admin-fieldset">
          <legend class="card__title">${esc(t('admin.companies.logoTitle'))}</legend>
          <div class="admin-logo">
            <span class="admin-logo__tile" id="logoTile"></span>
            <div class="stack stack--tight admin-logo__controls">
              ${field({
                id: 'f-logo',
                label: t('admin.field.logo'),
                help: t('admin.help.logo'),
                control: `<input class="input" id="f-logo" type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-describedby="${describedBy('f-logo')}" />`,
              })}
              ${
                company?.logoUrl
                  ? `<div><button type="button" class="btn btn--ghost btn--sm" id="removeLogo">
                       <span class="btn__label">${esc(t('admin.companies.removeLogo'))}</span>
                     </button></div>`
                  : ''
              }
            </div>
          </div>
        </fieldset>

        <fieldset class="card admin-fieldset">
          <legend class="card__title">${esc(t('admin.companies.accentTitle'))}</legend>
          <div class="admin-accent">
            ${field({
              id: 'f-accent',
              label: t('admin.field.accentPick'),
              control: `<input class="admin-accent__picker" id="f-accent" type="color"
                value="${esc(initial.accentColor)}" />`,
            })}
            ${field({
              id: 'f-accentHex',
              label: t('admin.field.accentHex'),
              required: true,
              control: `<input class="input" id="f-accentHex" type="text" dir="ltr"
                maxlength="7" autocomplete="off" spellcheck="false"
                value="${esc(initial.accentColor)}"
                aria-describedby="${describedBy('f-accentHex', false)}" />`,
            })}
          </div>
          <div class="verdict" id="verdict" aria-live="polite"></div>
        </fieldset>

        ${
          isNew
            ? ''
            : `<fieldset class="card admin-fieldset">
                <legend class="card__title">${esc(t('admin.companies.directoryTitle'))}</legend>
                <label class="switch">
                  <input class="switch__input" type="checkbox" id="f-showMobile"
                    aria-describedby="f-showMobile-help" ${initial.showMobile ? 'checked' : ''} />
                  <span class="switch__track"><span class="switch__knob"></span></span>
                  <span class="switch__text">${esc(t('admin.companies.showMobile'))}</span>
                </label>
                <p class="field__help" id="f-showMobile-help">${esc(
                  t('admin.companies.showMobileHelp')
                )}</p>
              </fieldset>

              <fieldset class="card admin-fieldset">
                <legend class="card__title">${esc(t('status.label'))}</legend>
                <div class="cluster cluster--between">
                  <p>${statusBadge(company.isActive)}
                    <span class="admin-status-note">${esc(
                      t(
                        company.isActive
                          ? 'admin.companies.activeNote'
                          : 'admin.companies.inactiveNote'
                      )
                    )}</span></p>
                  <button type="button" class="btn ${
                    company.isActive ? 'btn--danger' : 'btn--secondary'
                  }" id="toggleActive">
                    <span class="btn__label">${esc(
                      t(
                        company.isActive
                          ? 'admin.companies.deactivate'
                          : 'admin.companies.reactivate'
                      )
                    )}</span>
                  </button>
                </div>
              </fieldset>`
        }

        <div class="btn-row admin-form__actions">
          <button type="submit" class="btn btn--primary" id="saveBtn">
            <span class="btn__label">${esc(t(isNew ? 'admin.companies.create' : 'action.saveChanges'))}</span>
          </button>
          <a class="btn btn--ghost" href="#admin/companies">
            <span class="btn__label">${esc(t('action.cancel'))}</span>
          </a>
        </div>
      </div>

      <aside class="admin-form__side" aria-labelledby="previewTitle">
        <h2 class="card__title" id="previewTitle">${esc(t('admin.preview.title'))}</h2>
        <p class="field__help">${esc(t('admin.preview.help'))}</p>
        ${['light', 'dark']
          .map(
            (theme) => `<section class="preview" data-theme="${theme}" data-preview>
              <p class="preview__label u-microlabel">${esc(t(`admin.preview.${theme}`))}</p>
              <div inert>
                <div class="preview__bar">
                  <span class="preview__mark" data-preview-mark></span>
                  <span class="preview__name" data-preview-name></span>
                </div>
                <div class="preview__body">
                  <span class="preview__nav" aria-current="page">${esc(t('nav.home'))}</span>
                  <span class="preview__nav">${esc(t('nav.tickets'))}</span>
                  <span class="btn btn--primary preview__button"><span class="btn__label">${esc(
                    t('action.bookRoom')
                  )}</span></span>
                  <span class="preview__link">${esc(t('admin.preview.link'))}</span>
                </div>
              </div>
            </section>`
          )
          .join('')}
      </aside>
    </form>`;

  const form = root.querySelector('#companyForm');
  const $ = (id) => form.querySelector(`#${id}`);

  /* ---- live preview and verdict */
  const verdictEl = $('verdict');

  function currentNames() {
    return {
      code: ($('f-code').value || initial.code).toUpperCase(),
      nameEn: $('f-nameEn').value.trim(),
      nameAr: $('f-nameAr').value.trim(),
    };
  }

  function drawLogoTile() {
    const tile = $('logoTile');
    const src = previewUrl ?? company?.logoUrl ?? null;
    tile.className = src
      ? 'company-mark company-mark--logo admin-logo__tile'
      : 'company-mark admin-logo__tile';
    tile.replaceChildren();
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      tile.append(img);
    } else {
      tile.textContent = currentNames().code || '··';
    }
    return src;
  }

  function drawPreview() {
    const hex = $('f-accentHex').value.trim();
    const verdict = checkAccent(hex);
    const colour = verdict.normalized ?? initial.accentColor;
    const names = currentNames();
    const language =
      document.documentElement.lang === 'ar'
        ? names.nameAr || names.nameEn
        : names.nameEn || names.nameAr;
    const src = drawLogoTile();

    for (const panel of form.querySelectorAll('[data-preview]')) {
      panel.style.setProperty('--brand-accent', colour);
      panel.querySelector('[data-preview-name]').textContent =
        language || t('admin.preview.unnamed');
      const mark = panel.querySelector('[data-preview-mark]');
      mark.className = src
        ? 'company-mark company-mark--logo company-mark--sm'
        : 'company-mark company-mark--sm';
      mark.replaceChildren();
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        mark.append(img);
      } else {
        mark.textContent = names.code || '··';
      }
    }

    drawVerdict(verdict);
    return verdict;
  }

  function drawVerdict(verdict) {
    if (!verdict.normalized) {
      verdictEl.innerHTML = `<p class="verdict__summary verdict__summary--bad">${icon(
        'statusOverdue'
      )}<span>${esc(t('admin.verdict.format'))}</span></p>`;
      return;
    }
    const rows = verdict.checks
      .map(
        (c) => `<li class="verdict__row ${c.pass ? '' : 'verdict__row--bad'}">
          ${icon(c.pass ? 'check' : 'statusOverdue', 'verdict__icon')}
          <span class="verdict__what">${esc(t(`admin.verdict.${c.id}`))}</span>
          <span class="verdict__ratio" dir="ltr">${esc(c.ratio.toFixed(1))} : 1
            <span class="verdict__min">(${esc(t('admin.verdict.needs', { min: c.min }))})</span></span>
        </li>`
      )
      .join('');
    verdictEl.innerHTML = `<p class="verdict__summary ${verdict.ok ? 'verdict__summary--good' : 'verdict__summary--bad'}">
        ${icon(verdict.ok ? 'check' : 'statusOverdue')}
        <span>${esc(t(verdict.ok ? 'admin.verdict.ok' : 'admin.verdict.notOk'))}</span>
      </p>
      <ul class="verdict__list">${rows}</ul>`;
  }

  // The picker and the hex box are one value in two controls.
  $('f-accent').addEventListener('input', () => {
    $('f-accentHex').value = $('f-accent').value;
    drawPreview();
  });
  $('f-accentHex').addEventListener('input', () => {
    const value = $('f-accentHex').value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) $('f-accent').value = value.toLowerCase();
    drawPreview();
  });
  for (const id of ['f-code', 'f-nameEn', 'f-nameAr'])
    $(id).addEventListener('input', drawPreview);

  $('f-code').addEventListener('input', () => {
    $('f-code').value = $('f-code').value.toUpperCase();
  });

  /* ---- logo */
  $('f-logo').addEventListener('change', () => {
    const file = $('f-logo').files[0];
    setFieldError(form, 'f-logo', '');
    pendingLogo = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;

    if (file) {
      if (!LOGO_TYPES.includes(file.type)) {
        setFieldError(form, 'f-logo', t('admin.error.unsupportedImage'));
        $('f-logo').value = '';
      } else if (file.size > LOGO_MAX) {
        setFieldError(form, 'f-logo', t('admin.error.logoTooLarge'));
        $('f-logo').value = '';
      } else {
        pendingLogo = file;
        previewUrl = URL.createObjectURL(file);
      }
    }
    drawPreview();
  });

  $('removeLogo')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: t('admin.companies.removeLogoTitle'),
      body: t('admin.companies.removeLogoBody'),
      confirmLabel: t('admin.companies.removeLogo'),
    });
    if (!ok) return;
    try {
      await api(
        `/api/admin/companies/${company.id}/logo?updatedAt=${encodeURIComponent(company.updatedAt)}`,
        { method: 'DELETE', quiet: true }
      );
      showToast({ tone: 'success', titleKey: 'admin.toast.saved' });
      ctx.reload();
    } catch (err) {
      failed(err);
    }
  });

  /* ---- status */
  $('toggleActive')?.addEventListener('click', async () => {
    const turningOff = company.isActive;
    const ok = await confirmDialog({
      title: t(
        turningOff ? 'admin.companies.deactivateTitle' : 'admin.companies.reactivateTitle',
        {
          name: localized(company),
        }
      ),
      body: t(turningOff ? 'admin.companies.deactivateBody' : 'admin.companies.reactivateBody'),
      confirmLabel: t(turningOff ? 'admin.companies.deactivate' : 'admin.companies.reactivate'),
      tone: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;

    try {
      await api(
        `/api/admin/companies/${company.id}/${turningOff ? 'deactivate' : 'reactivate'}`,
        { method: 'POST', body: { updatedAt: company.updatedAt }, quiet: true }
      );
      showToast({ tone: 'success', titleKey: 'admin.toast.saved' });
      ctx.reload();
    } catch (err) {
      failed(err);
    }
  });

  /* ---- errors */
  function failed(err) {
    if (isStale(err)) {
      showStale();
      return;
    }
    showToast({ tone: 'danger', ...toastKeys(err) });
  }

  function showStale() {
    const slot = root.querySelector('#formNotice');
    slot.innerHTML = `<div class="notice notice--warning" role="alert">
      ${icon('statusOverdue', 'notice__icon')}
      <div class="notice__content stack">
        <div>
          <p class="notice__title">${esc(t('admin.error.staleTitle'))}</p>
          <p>${esc(t('admin.error.stale'))}</p>
        </div>
        <div><button type="button" class="btn btn--secondary" data-reload>
          <span class="btn__label">${esc(t('admin.error.reload'))}</span>
        </button></div>
      </div>
    </div>`;
    slot.querySelector('[data-reload]').addEventListener('click', () => ctx.reload());
    slot.scrollIntoView({ block: 'nearest' });
  }

  /* ---- validate and save */
  function parseDomains() {
    return $('f-domains')
      .value.split(/[\n,;]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }

  function validate() {
    const errors = {};
    const names = currentNames();
    if (isNew && !CODE.test($('f-code').value.trim())) errors['f-code'] = t('admin.error.code');
    if (!names.nameEn) errors['f-nameEn'] = t('admin.error.nameRequired');
    if (!names.nameAr) errors['f-nameAr'] = t('admin.error.nameRequired');

    const domains = parseDomains();
    if (domains.length === 0) errors['f-domains'] = t('admin.error.domainRequired');
    else if (domains.length > 5) errors['f-domains'] = t('admin.error.domainsMax');
    else if (new Set(domains).size !== domains.length)
      errors['f-domains'] = t('admin.error.domainsDuplicate');
    else {
      const bad = domains.find((d) => !DOMAIN.test(d));
      if (bad) errors['f-domains'] = t('admin.error.domainFormat', { domain: bad });
    }

    if (!checkAccent($('f-accentHex').value.trim()).ok) {
      errors['f-accentHex'] = t('admin.error.accent');
    }
    return { errors, domains };
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    root.querySelector('#formNotice').replaceChildren();

    const { errors, domains } = validate();
    for (const [id, message] of Object.entries(errors)) setFieldError(form, id, message);
    if (Object.keys(errors).length) {
      focusFirstError(form);
      return;
    }

    const names = currentNames();
    const accentColor = checkAccent($('f-accentHex').value.trim()).normalized;
    const saveBtn = $('saveBtn');
    setBusy(saveBtn, true, t('action.saving'));

    let saved = company;
    try {
      if (isNew) {
        saved = await api('/api/admin/companies', {
          method: 'POST',
          quiet: true,
          body: {
            code: $('f-code').value.trim(),
            nameEn: names.nameEn,
            nameAr: names.nameAr,
            domains,
            accentColor,
          },
        });
      } else {
        const changes = {};
        if (names.nameEn !== company.nameEn) changes.nameEn = names.nameEn;
        if (names.nameAr !== company.nameAr) changes.nameAr = names.nameAr;
        if (accentColor !== company.accentColor) changes.accentColor = accentColor;
        if (JSON.stringify(domains) !== JSON.stringify(company.domains))
          changes.domains = domains;
        const showMobile = $('f-showMobile').checked;
        if (showMobile !== (company.showMobileInDirectory === true)) {
          changes.showMobileInDirectory = showMobile;
        }

        if (Object.keys(changes).length) {
          saved = await api(`/api/admin/companies/${company.id}`, {
            method: 'PATCH',
            quiet: true,
            body: { updatedAt: company.updatedAt, ...changes },
          });
        }
      }
    } catch (err) {
      setBusy(saveBtn, false, t(isNew ? 'admin.companies.create' : 'action.saveChanges'));
      handleSaveError(err);
      return;
    }

    if (pendingLogo) {
      try {
        await api(
          `/api/admin/companies/${saved.id}/logo?updatedAt=${encodeURIComponent(saved.updatedAt)}`,
          { method: 'PUT', body: pendingLogo, quiet: true }
        );
      } catch (err) {
        // The company is saved; only its logo is not. Say so, and open it.
        showToast({
          tone: 'warning',
          titleKey: 'admin.toast.logoFailed',
          textKey: toastKeys(err).textKey,
        });
        location.hash = `#admin/companies/${saved.id}`;
        return;
      }
    }

    showToast({
      tone: 'success',
      titleKey: isNew ? 'admin.toast.created' : 'admin.toast.saved',
    });
    location.hash = '#admin/companies';
  });

  function handleSaveError(err) {
    if (isStale(err)) {
      showStale();
      return;
    }
    if (err instanceof ApiError && err.code === 'code_taken') {
      setFieldError(form, 'f-code', t('admin.error.codeTaken'));
    } else if (err instanceof ApiError && err.code === 'domain_taken') {
      setFieldError(form, 'f-domains', errorText(err));
    } else if (err instanceof ApiError && err.code === 'accent_not_accessible') {
      setFieldError(form, 'f-accentHex', t('admin.error.accent'));
    } else if (err instanceof ApiError && err.code === 'validation_failed') {
      const notice = root.querySelector('#formNotice');
      notice.innerHTML = `<div class="notice notice--danger" role="alert">
        ${icon('statusOverdue', 'notice__icon')}
        <div class="notice__content"><p class="notice__title">${esc(t('error.invalid.title'))}</p>
        <p>${esc(t('error.invalid.text'))}</p></div></div>`;
    } else {
      showToast({ tone: 'danger', ...toastKeys(err) });
    }
    focusFirstError(form);
  }

  drawPreview();
  return () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  };
}
