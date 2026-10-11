/**
 * pages/admin/admins.js — who administers what: the holding admins, then the
 * company admins of each company. Adding picks an existing person from the
 * directory (English or Arabic name, or email); removing asks first.
 *
 * Two rules live on the server and are only explained here: you cannot remove
 * your own holding admin role, and the last active holding admin stays.
 */

import { ApiError, api } from '../../api.js';
import { confirmDialog, openModal } from '../../components/dialog.js';
import { icon } from '../../components/icons.js';
import { initials } from '../../components/initials.js';
import { showToast } from '../../components/toast.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import { personName, toastKeys } from './shared.js';

const SEARCH_DELAY_MS = 250;

/**
 * @param {HTMLElement} root
 */
export async function render(root) {
  let data = await api('/api/admin/admins');

  async function reload(focus) {
    data = await api('/api/admin/admins');
    draw(focus);
  }

  function personRow(assignment, groupLabel) {
    const { user } = assignment;
    const name = personName(user);
    return `<li class="admin-person">
      <span class="avatar avatar--sm" aria-hidden="true">${esc(initials(name))}</span>
      <span class="admin-person__text">
        <span class="admin-person__name">${esc(name)}</span>
        <span class="admin-person__meta" dir="ltr">${esc(user.email)}</span>
      </span>
      <span class="tag admin-person__home">${esc(user.companyCode)}</span>
      <button type="button" class="btn btn--ghost btn--sm" data-remove="${esc(assignment.id)}"
        aria-label="${esc(t('admin.admins.removeNamed', { name, group: groupLabel }))}">
        <span class="btn__label">${esc(t('admin.admins.remove'))}</span>
      </button>
    </li>`;
  }

  function group({ key, title, admins, label, addKey }) {
    return `<section class="card admin-group" aria-labelledby="g-${esc(key)}">
      <div class="card__header">
        <h2 class="card__title" id="g-${esc(key)}">${title}</h2>
        <button type="button" class="btn btn--secondary btn--sm" data-add="${esc(addKey)}"
          aria-label="${esc(t('admin.admins.addTo', { group: label }))}">
          ${icon('plus', 'btn__icon')}
          <span class="btn__label">${esc(t('admin.admins.add'))}</span>
        </button>
      </div>
      ${
        admins.length === 0
          ? `<p class="admin-group__empty">${esc(t('admin.admins.none'))}</p>`
          : `<ul class="admin-people">${admins.map((a) => personRow(a, label)).join('')}</ul>`
      }
    </section>`;
  }

  function draw(focus) {
    const holdingLabel = t('admin.admins.holding');
    root.innerHTML = `<div class="stack">
      <p class="field__help">${esc(t('admin.admins.lead'))}</p>
      ${group({
        key: 'holding',
        title: esc(holdingLabel),
        admins: data.holding,
        label: holdingLabel,
        addKey: 'holding',
      })}
      ${data.companies
        .filter(({ company }) => company.isActive)
        .map(({ company, admins }) =>
          group({
            key: company.id,
            title: `<span class="admin-code">${esc(company.code)}</span> ${esc(localized(company))}`,
            admins,
            label: localized(company),
            addKey: company.id,
          })
        )
        .join('')}
    </div>`;

    for (const button of root.querySelectorAll('[data-add]')) {
      button.addEventListener('click', () => addDialog(button.dataset.add, button));
    }
    for (const button of root.querySelectorAll('[data-remove]')) {
      button.addEventListener('click', () => removeAssignment(button.dataset.remove));
    }
    if (focus) root.querySelector(focus)?.focus();
  }

  function findAssignment(id) {
    const all = [...data.holding, ...data.companies.flatMap((c) => c.admins)];
    return all.find((a) => a.id === id);
  }

  async function removeAssignment(id) {
    const assignment = findAssignment(id);
    const name = personName(assignment.user);
    const holding = assignment.role === 'HoldingAdmin';
    const company = data.companies.find((c) => c.admins.some((a) => a.id === id))?.company;

    const ok = await confirmDialog({
      title: t('admin.admins.removeTitle', { name }),
      body: holding
        ? t('admin.admins.removeBodyHolding')
        : t('admin.admins.removeBodyCompany', { company: localized(company) }),
      confirmLabel: t('admin.admins.remove'),
    });
    if (!ok) return;

    try {
      await api(`/api/admin/admins/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        quiet: true,
      });
      showToast({ tone: 'success', titleKey: 'admin.toast.adminRemoved' });
      await reload();
    } catch (err) {
      showToast({ tone: 'danger', ...toastKeys(err) });
    }
  }

  function addDialog(targetKey, opener) {
    const holding = targetKey === 'holding';
    const company = holding
      ? null
      : data.companies.find((c) => c.company.id === targetKey).company;
    const groupLabel = holding ? t('admin.admins.holding') : localized(company);

    const { dialog, close } = openModal({
      title: t('admin.admins.addTitle', { group: groupLabel }),
      bodyHtml: `<div class="field">
          <label class="field__label" for="peopleQuery">${esc(t('admin.admins.search'))}</label>
          <div class="input-group">
            ${icon('search', 'input-group__icon')}
            <input class="input" id="peopleQuery" type="search" autocomplete="off"
              aria-describedby="peopleHelp" />
          </div>
          <p class="field__help" id="peopleHelp">${esc(t('admin.admins.searchHelp'))}</p>
        </div>
        <ul class="admin-results" id="peopleResults" aria-label="${esc(
          t('admin.admins.results')
        )}"></ul>
        <p class="field__error" id="addError" role="alert" hidden></p>`,
      footerHtml: `<button type="button" class="btn btn--ghost" data-modal-close>
          <span class="btn__label">${esc(t('action.cancel'))}</span>
        </button>
        <button type="button" class="btn btn--primary" id="confirmAdd" disabled>
          <span class="btn__label">${esc(t('admin.admins.addConfirm'))}</span>
        </button>`,
    });

    const query = dialog.querySelector('#peopleQuery');
    const results = dialog.querySelector('#peopleResults');
    const confirm = dialog.querySelector('#confirmAdd');
    const error = dialog.querySelector('#addError');
    let chosen = null;
    let timer = null;
    let turn = 0;

    const heldHere = (person) =>
      holding
        ? data.holding.some((a) => a.user.id === person.id)
        : data.companies
            .find((c) => c.company.id === targetKey)
            .admins.some((a) => a.user.id === person.id);

    function paint(people) {
      if (people === null) {
        results.innerHTML = '';
        return;
      }
      if (people.length === 0) {
        results.innerHTML = `<li class="admin-results__empty">${esc(t('admin.admins.noResults'))}</li>`;
        return;
      }
      results.innerHTML = people
        .map((p) => {
          const held = heldHere(p);
          const name = personName(p);
          return `<li><button type="button" class="admin-result" data-person="${esc(p.id)}"
              aria-pressed="${chosen?.id === p.id}" ${held ? 'disabled' : ''}>
            <span class="avatar avatar--sm" aria-hidden="true">${esc(initials(name))}</span>
            <span class="admin-person__text">
              <span class="admin-person__name">${esc(name)}</span>
              <span class="admin-person__meta" dir="ltr">${esc(p.email)}</span>
            </span>
            <span class="tag">${esc(p.companyCode)}</span>
            ${held ? `<span class="badge">${esc(t('admin.admins.alreadyHolds'))}</span>` : ''}
          </button></li>`;
        })
        .join('');

      for (const button of results.querySelectorAll('[data-person]')) {
        button.addEventListener('click', () => {
          chosen = people.find((p) => p.id === button.dataset.person);
          confirm.disabled = false;
          for (const other of results.querySelectorAll('[data-person]')) {
            other.setAttribute('aria-pressed', String(other === button));
          }
        });
      }
    }

    async function search() {
      const q = query.value.trim();
      chosen = null;
      confirm.disabled = true;
      if (q.length < 2) {
        paint(null);
        return;
      }
      const mine = ++turn;
      try {
        const { items } = await api(`/api/admin/people?q=${encodeURIComponent(q)}`, {
          quiet: true,
        });
        if (mine === turn) paint(items);
      } catch (err) {
        if (mine === turn) {
          results.innerHTML = '';
          showToast({ tone: 'danger', ...toastKeys(err) });
        }
      }
    }

    query.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(search, SEARCH_DELAY_MS);
    });

    confirm.addEventListener('click', async () => {
      if (!chosen) return;
      confirm.disabled = true;
      error.hidden = true;
      try {
        await api('/api/admin/admins', {
          method: 'POST',
          quiet: true,
          body: holding
            ? { userId: chosen.id, role: 'HoldingAdmin' }
            : { userId: chosen.id, role: 'CompanyAdmin', companyId: targetKey },
        });
        close(true);
        showToast({ tone: 'success', titleKey: 'admin.toast.adminAdded' });
        await reload(`[data-add="${targetKey}"]`);
      } catch (err) {
        confirm.disabled = false;
        if (err instanceof ApiError && err.code === 'already_assigned') {
          error.innerHTML = `${icon('statusOverdue')}<span>${esc(t('admin.error.alreadyAssigned'))}</span>`;
          error.hidden = false;
        } else {
          showToast({ tone: 'danger', ...toastKeys(err) });
        }
      }
    });

    dialog.addEventListener('close', () => opener?.focus(), { once: true });
    query.focus();
  }

  draw();
  return undefined;
}
