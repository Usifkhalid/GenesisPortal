/**
 * pages/admin/departments.js — the departments of one company: add and edit
 * in place, deactivate instead of delete.
 *
 * A holding admin picks any company; a company admin gets only the ones they
 * administer (usually one), straight from GET /api/admin/scope.
 */

import { ApiError, api } from '../../api.js';
import { confirmDialog } from '../../components/dialog.js';
import { setBusy } from '../../components/form.js';
import { icon } from '../../components/icons.js';
import { showToast } from '../../components/toast.js';
import { formatNumber } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import { errorText, isStale, statusBadge, toastKeys } from './shared.js';

/**
 * @param {HTMLElement} root
 * @param {{ scope: object, params: string[], ctx: object }} ctx
 */
export async function render(root, { scope, params, ctx }) {
  // Inactive companies are for the companies list; there is no one to put in them.
  const companies = scope.companies.filter((c) => c.isActive || c.id === params[0]);
  if (companies.length === 0) {
    root.innerHTML = `<div class="empty empty--inline"><p class="empty__title">${esc(
      t('admin.departments.noCompany')
    )}</p></div>`;
    return;
  }

  const asked = companies.find((c) => c.id === params[0]);
  const fallback = companies.find((c) => c.id === ctx.company?.id) ?? companies[0];
  let company = asked ?? fallback;
  /** The department being edited, or null. */
  let editing = null;
  let items = [];

  const state = { loading: true };

  async function load() {
    state.loading = true;
    const res = await api(`/api/admin/departments?companyId=${encodeURIComponent(company.id)}`);
    items = res.items;
    state.loading = false;
  }

  function picker() {
    if (companies.length < 2) {
      return `<p class="admin__company">${esc(localized(company))}</p>`;
    }
    return `<div class="field admin__picker">
      <label class="field__label" for="companyPick">${esc(t('admin.departments.company'))}</label>
      <select class="select" id="companyPick">
        ${companies
          .map(
            (c) =>
              `<option value="${esc(c.id)}" ${c.id === company.id ? 'selected' : ''}>${esc(
                `${c.code} · ${localized(c)}`
              )}</option>`
          )
          .join('')}
      </select>
    </div>`;
  }

  function rowHtml(d) {
    if (editing === d.id) {
      return `<tr role="row" class="table__editing" data-id="${esc(d.id)}">
        <td role="cell" data-label="${esc(t('admin.field.nameEn'))}">
          <input class="input" id="edit-nameEn" type="text" lang="en" dir="ltr" maxlength="200"
            value="${esc(d.nameEn)}" aria-label="${esc(t('admin.field.nameEn'))}" />
        </td>
        <td role="cell" data-label="${esc(t('admin.field.nameAr'))}">
          <input class="input" id="edit-nameAr" type="text" lang="ar" dir="rtl" maxlength="200"
            value="${esc(d.nameAr)}" aria-label="${esc(t('admin.field.nameAr'))}" />
          <p class="field__error" id="edit-error" role="alert" hidden></p>
        </td>
        <td role="cell" class="table__num" data-label="${esc(t('admin.field.users'))}">${esc(
          formatNumber(d.userCount)
        )}</td>
        <td role="cell" data-label="${esc(t('status.label'))}">${statusBadge(d.isActive)}</td>
        <td role="cell" class="admin-actions">
          <button type="button" class="btn btn--primary btn--sm" data-save="${esc(d.id)}">
            <span class="btn__label">${esc(t('action.save'))}</span>
          </button>
          <button type="button" class="btn btn--ghost btn--sm" data-cancel>
            <span class="btn__label">${esc(t('action.cancel'))}</span>
          </button>
        </td>
      </tr>`;
    }

    const name = localized(d);
    return `<tr role="row" ${d.isActive ? '' : 'class="table__muted"'}>
      <td role="cell" data-label="${esc(t('admin.field.nameEn'))}"><span class="admin-lang" lang="en" dir="ltr">${esc(d.nameEn)}</span></td>
      <td role="cell" data-label="${esc(t('admin.field.nameAr'))}"><span class="admin-lang" lang="ar" dir="rtl">${esc(d.nameAr)}</span></td>
      <td role="cell" class="table__num" data-label="${esc(t('admin.field.users'))}">${esc(
        formatNumber(d.userCount)
      )}</td>
      <td role="cell" data-label="${esc(t('status.label'))}">${statusBadge(d.isActive)}</td>
      <td role="cell" class="admin-actions">
        <button type="button" class="btn btn--secondary btn--sm" data-edit="${esc(d.id)}"
          aria-label="${esc(t('admin.departments.editNamed', { name }))}">
          <span class="btn__label">${esc(t('action.edit'))}</span>
        </button>
        <button type="button" class="btn btn--ghost btn--sm" data-toggle="${esc(d.id)}"
          aria-label="${esc(
            t(
              d.isActive
                ? 'admin.departments.deactivateNamed'
                : 'admin.departments.reactivateNamed',
              {
                name,
              }
            )
          )}">
          <span class="btn__label">${esc(
            t(d.isActive ? 'admin.departments.deactivate' : 'admin.departments.reactivate')
          )}</span>
        </button>
      </td>
    </tr>`;
  }

  function draw({ focus } = {}) {
    root.innerHTML = `
      <div class="admin__bar">${picker()}</div>

      <form class="card admin-add" id="addForm" novalidate data-density="compact">
        <h2 class="card__title">${esc(t('admin.departments.add'))}</h2>
        <div class="admin-add__fields">
          <div class="field">
            <label class="field__label" for="add-nameEn">${esc(t('admin.field.nameEn'))}</label>
            <input class="input" id="add-nameEn" type="text" lang="en" dir="ltr" maxlength="200"
              aria-describedby="add-error" />
          </div>
          <div class="field">
            <label class="field__label" for="add-nameAr">${esc(t('admin.field.nameAr'))}</label>
            <input class="input" id="add-nameAr" type="text" lang="ar" dir="rtl" maxlength="200"
              aria-describedby="add-error" />
          </div>
          <div class="admin-add__submit">
            <button type="submit" class="btn btn--primary" id="addBtn">
              ${icon('plus', 'btn__icon')}
              <span class="btn__label">${esc(t('admin.departments.addButton'))}</span>
            </button>
          </div>
        </div>
        <p class="field__error" id="add-error" role="alert" hidden></p>
      </form>

      ${
        items.length === 0
          ? `<div class="empty empty--inline"><p class="empty__title">${esc(
              t('admin.departments.empty')
            )}</p></div>`
          : `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
               aria-label="${esc(t('admin.departments.caption'))}">
              <table class="table" role="table">
                <caption class="u-visually-hidden">${esc(t('admin.departments.caption'))}</caption>
                <thead role="rowgroup"><tr role="row">
                  <th role="columnheader" scope="col">${esc(t('admin.field.nameEn'))}</th>
                  <th role="columnheader" scope="col">${esc(t('admin.field.nameAr'))}</th>
                  <th role="columnheader" scope="col" class="table__num">${esc(
                    t('admin.field.users')
                  )}</th>
                  <th role="columnheader" scope="col">${esc(t('status.label'))}</th>
                  <th role="columnheader" scope="col"><span class="u-visually-hidden">${esc(
                    t('admin.field.actions')
                  )}</span></th>
                </tr></thead>
                <tbody role="rowgroup">${items.map(rowHtml).join('')}</tbody>
              </table>
            </div>`
      }`;

    wire();
    if (focus) root.querySelector(focus)?.focus();
  }

  function showInline(id, message) {
    const el = root.querySelector(`#${id}`);
    if (!el) return;
    el.innerHTML = message ? `${icon('statusOverdue')}<span>${esc(message)}</span>` : '';
    el.hidden = !message;
  }

  /** Fails in place where a field can say what is wrong; a toast otherwise. */
  async function reloadAfterStale() {
    await load();
    editing = null;
    draw();
  }

  function onError(err, errorId) {
    if (isStale(err)) {
      showToast({
        tone: 'warning',
        titleKey: 'admin.error.staleTitle',
        textKey: 'admin.error.stale',
      });
      reloadAfterStale();
      return;
    }
    if (err instanceof ApiError && err.code === 'department_name_taken') {
      showInline(errorId, errorText(err));
      return;
    }
    if (err instanceof ApiError && err.code === 'validation_failed') {
      showInline(errorId, t('admin.error.nameRequired'));
      return;
    }
    showToast({ tone: 'danger', ...toastKeys(err) });
  }

  function wire() {
    root.querySelector('#companyPick')?.addEventListener('change', async (event) => {
      company = companies.find((c) => c.id === event.target.value);
      editing = null;
      history.replaceState(null, '', `#admin/departments/${company.id}`);
      await load();
      draw({ focus: '#companyPick' });
    });

    const add = root.querySelector('#addForm');
    add.addEventListener('submit', async (event) => {
      event.preventDefault();
      showInline('add-error', '');
      const nameEn = add.querySelector('#add-nameEn').value.trim();
      const nameAr = add.querySelector('#add-nameAr').value.trim();
      if (!nameEn || !nameAr) {
        showInline('add-error', t('admin.error.nameRequired'));
        add.querySelector(nameEn ? '#add-nameAr' : '#add-nameEn').focus();
        return;
      }

      const button = add.querySelector('#addBtn');
      setBusy(button, true, t('action.saving'));
      try {
        await api('/api/admin/departments', {
          method: 'POST',
          quiet: true,
          body: { companyId: company.id, nameEn, nameAr },
        });
        showToast({ tone: 'success', titleKey: 'admin.toast.departmentAdded' });
        await load();
        draw({ focus: '#add-nameEn' });
      } catch (err) {
        setBusy(button, false, t('admin.departments.addButton'));
        onError(err, 'add-error');
      }
    });

    for (const button of root.querySelectorAll('[data-edit]')) {
      button.addEventListener('click', () => {
        editing = button.dataset.edit;
        draw({ focus: '#edit-nameEn' });
      });
    }

    root.querySelector('[data-cancel]')?.addEventListener('click', () => {
      const id = editing;
      editing = null;
      draw({ focus: `[data-edit="${id}"]` });
    });

    root.querySelector('[data-save]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const department = items.find((d) => d.id === button.dataset.save);
      const nameEn = root.querySelector('#edit-nameEn').value.trim();
      const nameAr = root.querySelector('#edit-nameAr').value.trim();
      showInline('edit-error', '');
      if (!nameEn || !nameAr) {
        showInline('edit-error', t('admin.error.nameRequired'));
        return;
      }

      const changes = {};
      if (nameEn !== department.nameEn) changes.nameEn = nameEn;
      if (nameAr !== department.nameAr) changes.nameAr = nameAr;
      if (Object.keys(changes).length === 0) {
        editing = null;
        draw({ focus: `[data-edit="${department.id}"]` });
        return;
      }

      setBusy(button, true, t('action.saving'));
      try {
        await api(`/api/admin/departments/${department.id}`, {
          method: 'PATCH',
          quiet: true,
          body: { updatedAt: department.updatedAt, ...changes },
        });
        showToast({ tone: 'success', titleKey: 'admin.toast.saved' });
        editing = null;
        await load();
        draw({ focus: `[data-edit="${department.id}"]` });
      } catch (err) {
        setBusy(button, false, t('action.save'));
        onError(err, 'edit-error');
      }
    });

    for (const button of root.querySelectorAll('[data-toggle]')) {
      button.addEventListener('click', async () => {
        const department = items.find((d) => d.id === button.dataset.toggle);
        const turningOff = department.isActive;
        if (turningOff) {
          const ok = await confirmDialog({
            title: t('admin.departments.deactivateTitle', { name: localized(department) }),
            body:
              department.userCount > 0
                ? t('admin.departments.deactivateBodyUsers', {
                    count: formatNumber(department.userCount),
                  })
                : t('admin.departments.deactivateBody'),
            confirmLabel: t('admin.departments.deactivate'),
          });
          if (!ok) return;
        }
        try {
          await api(
            `/api/admin/departments/${department.id}/${turningOff ? 'deactivate' : 'reactivate'}`,
            { method: 'POST', quiet: true, body: { updatedAt: department.updatedAt } }
          );
          showToast({ tone: 'success', titleKey: 'admin.toast.saved' });
          await load();
          draw({ focus: `[data-toggle="${department.id}"]` });
        } catch (err) {
          onError(err, '');
        }
      });
    }
  }

  await load();
  draw();
  return undefined;
}
