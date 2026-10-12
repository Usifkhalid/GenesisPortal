/**
 * pages/tickets/config.js — the helpdesk's own configuration screens, shared
 * by two addresses:
 *
 *   #admin/helpdesk      HoldingAdmin: everything
 *   #tickets/settings    a team's Lead: categories and canned replies of their team
 *
 * Team members and their roles, categories, locations, SLA targets and
 * working hours, holidays, and canned replies in both languages. Every write
 * is audited by the API (helpdesk.* actions); nothing here is cached beyond
 * the page. Leads and HoldingAdmins see the same screens for the sections
 * they are allowed; the API refuses the rest.
 */

import { api } from '../../api.js';
import { confirmDialog, openModal } from '../../components/dialog.js';
import { describedBy, field, setBusy, setFieldError } from '../../components/form.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { createPeoplePicker } from '../../components/people-picker.js';
import { displayName } from '../../components/person.js';
import { showToast } from '../../components/toast.js';
import { clockOf, formatDay } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import { PRIORITIES, errorText, priorityLabel } from './shared.js';

const BASE = '/api/admin/helpdesk';

const SECTIONS_ALL = ['members', 'categories', 'locations', 'targets', 'holidays', 'replies'];
const SECTIONS_LEAD = ['categories', 'replies'];

const call = (path, options = {}) => api(`${BASE}${path}`, { quiet: true, ...options });

/** A name pair, the language in use first. */
function namePair(record, stem = 'name') {
  const arabicFirst = document.documentElement.lang === 'ar';
  const en = `<span lang="en" dir="ltr">${esc(record[`${stem}En`] ?? '')}</span>`;
  const ar = `<span lang="ar" dir="rtl">${esc(record[`${stem}Ar`] ?? '')}</span>`;
  return `<span class="tk-names">${arabicFirst ? ar + en : en + ar}</span>`;
}

const activeBadge = (isActive) =>
  isActive
    ? `<span class="badge badge--success">${esc(t('admin.status.active'))}</span>`
    : `<span class="badge">${esc(t('admin.status.inactive'))}</span>`;

/* ------------------------------------------------------- a record in a dialog */

/**
 * One form in a dialog for adding or changing a record.
 *
 * @param {object} spec
 * @param {string} spec.title
 * @param {{ key: string, label: string, kind?: string, required?: boolean, options?: {value: string, label: string}[], dir?: string, help?: string, rows?: number, maxlength?: number }[]} spec.fields
 * @param {Record<string, any>} [spec.values]
 * @param {(values: Record<string, any>) => Promise<unknown>} spec.save
 * @returns {Promise<boolean>} true when something was saved
 */
async function editRecord({ title, fields, values = {}, save, extraHtml = '' }) {
  const control = (f) => {
    const id = `cfg-${f.key}`;
    const described = describedBy(id, Boolean(f.help));
    const value = values[f.key] ?? '';
    if (f.kind === 'textarea') {
      return `<textarea class="textarea" id="${id}" name="${f.key}" rows="${f.rows ?? 4}"
        maxlength="${f.maxlength ?? 10000}" ${f.dir ? `dir="${f.dir}" lang="${f.dir === 'rtl' ? 'ar' : 'en'}"` : ''}
        aria-describedby="${described}">${esc(value)}</textarea>`;
    }
    if (f.kind === 'select') {
      return `<select class="select" id="${id}" name="${f.key}" aria-describedby="${described}">
        ${f.options
          .map(
            (o) =>
              `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(
                o.label
              )}</option>`
          )
          .join('')}</select>`;
    }
    if (f.kind === 'checkbox') {
      return `<label class="choice"><input class="choice__control" type="checkbox" id="${id}"
        name="${f.key}" ${value ? 'checked' : ''} />
        <span class="choice__text"><span class="choice__label">${esc(f.label)}</span></span></label>`;
    }
    return `<input class="input" id="${id}" name="${f.key}" type="${f.kind ?? 'text'}"
      maxlength="${f.maxlength ?? 200}" value="${esc(value)}" autocomplete="off"
      ${f.dir ? `dir="${f.dir}" lang="${f.dir === 'rtl' ? 'ar' : 'en'}"` : ''}
      aria-describedby="${described}" />`;
  };

  const bodyHtml = `<form id="cfgForm" class="stack" novalidate>
    ${fields
      .map((f) =>
        f.kind === 'checkbox'
          ? `<div class="field" data-field="cfg-${f.key}">${control(f)}</div>`
          : field({
              id: `cfg-${f.key}`,
              label: f.label,
              required: f.required,
              help: f.help ?? '',
              control: control(f),
            })
      )
      .join('')}
    ${extraHtml}
  </form>`;

  const { dialog, close, closed } = openModal({
    title,
    bodyHtml,
    footerHtml: `<button type="button" class="btn btn--ghost" data-modal-close>
        <span class="btn__label">${esc(t('action.cancel'))}</span></button>
      <button type="submit" class="btn btn--primary" form="cfgForm" id="cfgSave">
        <span class="btn__label">${esc(t('action.save'))}</span></button>`,
  });
  const form = dialog.querySelector('#cfgForm');
  form.querySelector('input, textarea, select')?.focus();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const out = {};
    let firstBad = null;
    for (const f of fields) {
      const el = form.elements[f.key];
      let value = f.kind === 'checkbox' ? el.checked : el.value.trim();
      if (f.required && !value) {
        setFieldError(form, `cfg-${f.key}`, t('tk.cfg.required'));
        firstBad ??= el;
      } else {
        setFieldError(form, `cfg-${f.key}`, '');
      }
      if (f.number) value = value === '' ? null : Number(value);
      out[f.key] = value;
    }
    if (firstBad) {
      firstBad.focus();
      return;
    }
    const button = dialog.querySelector('#cfgSave');
    setBusy(button, true, t('action.saving'));
    try {
      await save(out);
      close(true);
    } catch (err) {
      setBusy(button, false, t('action.save'));
      showToast({ tone: 'danger', titleKey: 'tk.cfg.failed', text: errorText(err) });
    }
  });
  return (await closed) === true;
}

/* ---------------------------------------------------------------- the module */

/**
 * @param {HTMLElement} root
 * @param {{ holding: boolean }} options
 */
export async function renderConfig(root, { holding }) {
  let teams;
  try {
    teams = (await call('/teams')).items;
  } catch {
    root.innerHTML = loadFailedNotice();
    root
      .querySelector('[data-retry]')
      .addEventListener('click', () => renderConfig(root, { holding }));
    return undefined;
  }
  teams = teams.filter((team) => team.isActive);
  if (teams.length === 0) {
    root.innerHTML = `<div class="empty empty--inline">${icon('tickets', 'empty__mark')}
      <div class="empty__copy"><p class="empty__title">${esc(t('tk.cfg.noTeams'))}</p></div></div>`;
    return undefined;
  }

  const sections = holding ? SECTIONS_ALL : SECTIONS_LEAD;
  const state = { teamId: teams[0].id, section: sections[0], year: new Date().getFullYear() };
  const team = () => teams.find((x) => x.id === state.teamId) ?? teams[0];

  root.innerHTML = `<div class="stack tk-config">
    ${
      teams.length > 1
        ? `<div class="field tk-config__team">
            <label class="field__label" for="cfgTeam">${esc(t('tk.cfg.team'))}</label>
            <select class="select" id="cfgTeam">
              ${teams.map((x) => `<option value="${esc(x.id)}">${esc(localized(x))}</option>`).join('')}
            </select>
          </div>`
        : ''
    }
    <nav class="subnav" aria-label="${esc(t('tk.cfg.sections'))}" id="cfgNav">
      ${sections
        .map(
          (s) =>
            `<button type="button" class="subnav__link" data-section="${s}">${esc(
              t(`tk.cfg.section.${s}`)
            )}</button>`
        )
        .join('')}
    </nav>
    <div id="cfgBody" class="stack" aria-live="polite"></div>
  </div>`;

  const body = root.querySelector('#cfgBody');

  const reloadTeams = async () => {
    const fresh = (await call('/teams')).items.filter((x) => x.isActive);
    teams = fresh;
  };

  function drawNav() {
    for (const b of root.querySelectorAll('[data-section]')) {
      if (b.dataset.section === state.section) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  const heading = (key, helpKey, actionHtml = '') => `<div class="tk-config__head">
    <div><h2 class="card__title">${esc(t(key))}</h2>
    ${helpKey ? `<p class="tk-config__help">${esc(t(helpKey))}</p>` : ''}</div>
    ${actionHtml}</div>`;

  const addButton = (key, label) =>
    `<button type="button" class="btn btn--primary btn--sm" data-add="${key}">
      ${icon('plus', 'btn__icon')}<span class="btn__label">${esc(label)}</span></button>`;

  const emptyRow = (key) =>
    `<div class="empty empty--inline">${icon('blankLabel', 'empty__mark')}
      <div class="empty__copy"><p class="empty__title">${esc(t(key))}</p></div></div>`;

  /* ---------------------------------------------------------------- members */
  async function drawMembers() {
    const current = team();
    body.innerHTML = `${heading('tk.cfg.section.members', 'tk.cfg.members.help')}
      <div class="table-wrap" data-density="compact" tabindex="0" role="region"
        aria-label="${esc(t('tk.cfg.section.members'))}">
        <table class="table"><thead><tr>
          <th scope="col">${esc(t('tk.cfg.members.person'))}</th>
          <th scope="col">${esc(t('tk.cfg.members.role'))}</th>
          <th scope="col"><span class="u-visually-hidden">${esc(t('admin.field.actions'))}</span></th>
        </tr></thead><tbody>
        ${current.members
          .map(
            (m) => `<tr>
              <td data-label="${esc(t('tk.cfg.members.person'))}">${esc(displayName(m))}
                <span class="tk-table__meta"><bdi dir="ltr">${esc(m.email ?? '')}</bdi></span></td>
              <td data-label="${esc(t('tk.cfg.members.role'))}">
                <label class="u-visually-hidden" for="role-${esc(m.id)}">${esc(
                  t('tk.cfg.members.roleOf', { name: displayName(m) })
                )}</label>
                <select class="select" id="role-${esc(m.id)}" data-role="${esc(m.id)}">
                  ${['Agent', 'Lead']
                    .map(
                      (r) =>
                        `<option value="${r}" ${m.role === r ? 'selected' : ''}>${esc(
                          t(`tk.cfg.role.${r}`)
                        )}</option>`
                    )
                    .join('')}
                </select>
              </td>
              <td class="admin-actions">
                <button type="button" class="btn btn--ghost btn--sm" data-remove-member="${esc(m.id)}"
                  aria-label="${esc(t('tk.cfg.members.remove', { name: displayName(m) }))}">
                  <span class="btn__label">${esc(t('tk.cfg.members.removeShort'))}</span></button>
              </td>
            </tr>`
          )
          .join('')}
        </tbody></table>
      </div>
      <form class="card tk-config__add" id="cfgAddMember" novalidate>
        <div id="cfgMemberWho"></div>
        <div class="field">
          <label class="field__label" for="cfgNewRole">${esc(t('tk.cfg.members.role'))}</label>
          <select class="select" id="cfgNewRole">
            <option value="Agent">${esc(t('tk.cfg.role.Agent'))}</option>
            <option value="Lead">${esc(t('tk.cfg.role.Lead'))}</option>
          </select>
        </div>
        <button type="submit" class="btn btn--primary btn--sm">
          ${icon('plus', 'btn__icon')}<span class="btn__label">${esc(t('tk.cfg.members.add'))}</span>
        </button>
      </form>`;
    const picker = createPeoplePicker({
      host: body.querySelector('#cfgMemberWho'),
      id: 'cfgMemberInput',
      label: t('tk.cfg.members.addLabel'),
      max: 1,
      required: true,
    });
    body.querySelector('#cfgAddMember').addEventListener('submit', async (event) => {
      event.preventDefault();
      const userId = picker.ids[0];
      if (!userId) {
        picker.input.focus();
        return;
      }
      try {
        await call(
          `/teams/${encodeURIComponent(current.id)}/members/${encodeURIComponent(userId)}`,
          {
            method: 'PUT',
            body: { role: body.querySelector('#cfgNewRole').value },
          }
        );
        await reloadTeams();
        showToast({ tone: 'success', titleKey: 'tk.cfg.saved' });
        draw();
      } catch (err) {
        showToast({ tone: 'danger', titleKey: 'tk.cfg.failed', text: errorText(err) });
      }
    });
  }

  /* ------------------------------------------------------------- categories */
  async function drawCategories() {
    const { items } = await call(`/categories?teamId=${encodeURIComponent(state.teamId)}`);
    const fields = [
      { key: 'nameEn', label: t('tk.cfg.nameEn'), required: true, dir: 'ltr' },
      { key: 'nameAr', label: t('tk.cfg.nameAr'), required: true, dir: 'rtl' },
      {
        key: 'defaultPriority',
        label: t('tk.cfg.defaultPriority'),
        help: t('tk.cfg.defaultPriorityHelp'),
        kind: 'select',
        options: PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p, true) })),
      },
      { key: 'sortOrder', label: t('tk.cfg.sortOrder'), kind: 'number', number: true },
    ];
    body.innerHTML = `${heading(
      'tk.cfg.section.categories',
      'tk.cfg.categories.help',
      addButton('category', t('tk.cfg.categories.add'))
    )}
      ${
        items.length
          ? `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
              aria-label="${esc(t('tk.cfg.section.categories'))}"><table class="table"><thead><tr>
              <th scope="col">${esc(t('tk.cfg.name'))}</th>
              <th scope="col">${esc(t('tk.cfg.defaultPriority'))}</th>
              <th scope="col">${esc(t('status.label'))}</th>
              <th scope="col"><span class="u-visually-hidden">${esc(t('admin.field.actions'))}</span></th>
            </tr></thead><tbody>
            ${items
              .map(
                (c) => `<tr><td data-label="${esc(t('tk.cfg.name'))}">${namePair(c)}</td>
                  <td data-label="${esc(t('tk.cfg.defaultPriority'))}">${esc(priorityLabel(c.defaultPriority, true))}</td>
                  <td data-label="${esc(t('status.label'))}">${activeBadge(c.isActive)}</td>
                  <td class="admin-actions"><button type="button" class="btn btn--secondary btn--sm"
                    data-edit-category="${esc(c.id)}"><span class="btn__label">${esc(t('action.edit'))}</span>
                    </button></td></tr>`
              )
              .join('')}
            </tbody></table></div>`
          : emptyRow('tk.cfg.categories.empty')
      }`;

    body.querySelector('[data-add="category"]')?.addEventListener('click', async () => {
      const saved = await editRecord({
        title: t('tk.cfg.categories.add'),
        fields,
        values: { defaultPriority: 'P3', sortOrder: items.length * 10 },
        save: (v) =>
          call('/categories', {
            method: 'POST',
            body: { teamId: state.teamId, ...v, sortOrder: v.sortOrder ?? 0 },
          }),
      });
      if (saved) draw();
    });
    for (const button of body.querySelectorAll('[data-edit-category]')) {
      button.addEventListener('click', async () => {
        const record = items.find((c) => c.id === button.dataset.editCategory);
        const saved = await editRecord({
          title: t('tk.cfg.categories.edit'),
          fields: [
            ...fields,
            { key: 'isActive', label: t('tk.cfg.activeLabel'), kind: 'checkbox' },
          ],
          values: record,
          save: (v) =>
            call(`/categories/${encodeURIComponent(record.id)}`, {
              method: 'PATCH',
              body: { ...v, sortOrder: v.sortOrder ?? 0 },
            }),
        });
        if (saved) draw();
      });
    }
  }

  /* -------------------------------------------------------------- locations */
  async function drawLocations() {
    const { items } = await call('/locations');
    const fields = [
      { key: 'nameEn', label: t('tk.cfg.nameEn'), required: true, dir: 'ltr' },
      { key: 'nameAr', label: t('tk.cfg.nameAr'), required: true, dir: 'rtl' },
    ];
    body.innerHTML = `${heading(
      'tk.cfg.section.locations',
      'tk.cfg.locations.help',
      addButton('location', t('tk.cfg.locations.add'))
    )}
      ${
        items.length
          ? `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
              aria-label="${esc(t('tk.cfg.section.locations'))}"><table class="table"><thead><tr>
              <th scope="col">${esc(t('tk.cfg.name'))}</th>
              <th scope="col">${esc(t('status.label'))}</th>
              <th scope="col"><span class="u-visually-hidden">${esc(t('admin.field.actions'))}</span></th>
            </tr></thead><tbody>
            ${items
              .map(
                (l) => `<tr><td data-label="${esc(t('tk.cfg.name'))}">${namePair(l)}</td>
                  <td data-label="${esc(t('status.label'))}">${activeBadge(l.isActive)}</td>
                  <td class="admin-actions"><button type="button" class="btn btn--secondary btn--sm"
                    data-edit-location="${esc(l.id)}"><span class="btn__label">${esc(t('action.edit'))}</span>
                    </button></td></tr>`
              )
              .join('')}
            </tbody></table></div>`
          : emptyRow('tk.cfg.locations.empty')
      }`;
    body.querySelector('[data-add="location"]')?.addEventListener('click', async () => {
      const saved = await editRecord({
        title: t('tk.cfg.locations.add'),
        fields,
        save: (v) => call('/locations', { method: 'POST', body: v }),
      });
      if (saved) draw();
    });
    for (const button of body.querySelectorAll('[data-edit-location]')) {
      button.addEventListener('click', async () => {
        const record = items.find((l) => l.id === button.dataset.editLocation);
        const saved = await editRecord({
          title: t('tk.cfg.locations.edit'),
          fields: [
            ...fields,
            { key: 'isActive', label: t('tk.cfg.activeLabel'), kind: 'checkbox' },
          ],
          values: record,
          save: (v) =>
            call(`/locations/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: v }),
        });
        if (saved) draw();
      });
    }
  }

  /* ----------------------------------------------------- targets and hours */
  function drawTargets() {
    const current = team();
    const hours = (minutes) => String(Math.round((minutes / 60) * 100) / 100);
    const cal = current.calendar;
    body.innerHTML = `${heading('tk.cfg.section.targets', 'tk.cfg.targets.help')}
      <form class="card stack" id="cfgSla" novalidate aria-labelledby="cfgSlaTitle">
        <h3 class="card__title" id="cfgSlaTitle">${esc(t('tk.cfg.targets.slaTitle'))}</h3>
        <p class="tk-config__help">${esc(t('tk.cfg.targets.slaHelp'))}</p>
        <div class="tk-sla">
          <span class="tk-sla__head">${esc(t('field.priority'))}</span>
          <span class="tk-sla__head">${esc(t('tk.cfg.targets.first'))}</span>
          <span class="tk-sla__head">${esc(t('tk.cfg.targets.resolve'))}</span>
          ${PRIORITIES.map((p) => {
            const row = current.sla.find((s) => s.priority === p);
            return `<span class="tk-sla__name">${esc(priorityLabel(p, true))}</span>
              <div class="field"><label class="u-visually-hidden" for="first-${p}">${esc(
                `${p} ${t('tk.cfg.targets.first')}`
              )}</label>
                <input class="input" id="first-${p}" name="first-${p}" type="number" min="0.25" step="0.25"
                  inputmode="decimal" value="${hours(row.firstResponseMinutes)}" /></div>
              <div class="field"><label class="u-visually-hidden" for="resolve-${p}">${esc(
                `${p} ${t('tk.cfg.targets.resolve')}`
              )}</label>
                <input class="input" id="resolve-${p}" name="resolve-${p}" type="number" min="0.25" step="0.25"
                  inputmode="decimal" value="${hours(row.resolveMinutes)}" /></div>`;
          }).join('')}
        </div>
        <p class="field__error" id="cfgSla-error" role="alert" hidden></p>
        <div class="btn-row"><button type="submit" class="btn btn--primary btn--sm">
          <span class="btn__label">${esc(t('action.save'))}</span></button></div>
      </form>

      <form class="card stack" id="cfgHours" novalidate aria-labelledby="cfgHoursTitle">
        <h3 class="card__title" id="cfgHoursTitle">${esc(t('tk.cfg.hours.title'))}</h3>
        <p class="tk-config__help">${esc(t('tk.cfg.hours.help'))}</p>
        <fieldset class="admin-fieldset--plain tk-days">
          <legend class="field__label">${esc(t('tk.cfg.hours.days'))}</legend>
          ${[0, 1, 2, 3, 4, 5, 6]
            .map(
              (
                d
              ) => `<label class="choice choice--inline"><input class="choice__control" type="checkbox"
                name="day" value="${d}" ${cal.workingDays.includes(d) ? 'checked' : ''} />
                <span class="choice__text"><span class="choice__label">${esc(
                  t(`rooms.weekday.${d}`)
                )}</span></span></label>`
            )
            .join('')}
        </fieldset>
        <div class="field-row">
          <div class="field"><label class="field__label" for="cfgStart">${esc(t('tk.cfg.hours.start'))}</label>
            <input class="input" id="cfgStart" name="start" type="time" value="${esc(clockOf(cal.startMin))}" /></div>
          <div class="field"><label class="field__label" for="cfgEnd">${esc(t('tk.cfg.hours.end'))}</label>
            <input class="input" id="cfgEnd" name="end" type="time" value="${esc(clockOf(cal.endMin))}" /></div>
          <div class="field"><label class="field__label" for="cfgZone">${esc(t('tk.cfg.hours.zone'))}</label>
            <input class="input" id="cfgZone" name="zone" type="text" dir="ltr" value="${esc(cal.timeZone)}" /></div>
        </div>
        <p class="field__error" id="cfgHours-error" role="alert" hidden></p>
        <div class="btn-row"><button type="submit" class="btn btn--primary btn--sm">
          <span class="btn__label">${esc(t('action.save'))}</span></button></div>
      </form>`;

    const say = (id, message) => {
      const el = body.querySelector(`#${id}-error`);
      el.hidden = !message;
      el.textContent = message ?? '';
    };

    body.querySelector('#cfgSla').addEventListener('submit', async (event) => {
      event.preventDefault();
      const f = event.target.elements;
      const policies = PRIORITIES.map((priority) => ({
        priority,
        firstResponseMinutes: Math.round(Number(f[`first-${priority}`].value) * 60),
        resolveMinutes: Math.round(Number(f[`resolve-${priority}`].value) * 60),
      }));
      if (policies.some((p) => !(p.firstResponseMinutes > 0) || !(p.resolveMinutes > 0))) {
        say('cfgSla', t('tk.cfg.targets.invalid'));
        return;
      }
      if (policies.some((p) => p.firstResponseMinutes > p.resolveMinutes)) {
        say('cfgSla', t('tk.cfg.targets.order'));
        return;
      }
      say('cfgSla', '');
      try {
        await call(`/teams/${encodeURIComponent(current.id)}/sla`, {
          method: 'PUT',
          body: { policies },
        });
        await reloadTeams();
        showToast({ tone: 'success', titleKey: 'tk.cfg.saved' });
      } catch (err) {
        showToast({ tone: 'danger', titleKey: 'tk.cfg.failed', text: errorText(err) });
      }
    });

    body.querySelector('#cfgHours').addEventListener('submit', async (event) => {
      event.preventDefault();
      const f = event.target.elements;
      const minutes = (value) => {
        const [h, m] = String(value).split(':').map(Number);
        return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
      };
      const days = [...event.target.querySelectorAll('[name="day"]:checked')].map((c) =>
        Number(c.value)
      );
      const startMin = minutes(f.start.value);
      const endMin = minutes(f.end.value);
      if (days.length === 0 || startMin == null || endMin == null || endMin <= startMin) {
        say('cfgHours', t('tk.cfg.hours.invalid'));
        return;
      }
      say('cfgHours', '');
      try {
        await call(`/teams/${encodeURIComponent(current.id)}/calendar`, {
          method: 'PUT',
          body: { timeZone: f.zone.value.trim(), workingDays: days, startMin, endMin },
        });
        await reloadTeams();
        showToast({ tone: 'success', titleKey: 'tk.cfg.saved' });
      } catch (err) {
        showToast({ tone: 'danger', titleKey: 'tk.cfg.failed', text: errorText(err) });
      }
    });
  }

  /* --------------------------------------------------------------- holidays */
  async function drawHolidays() {
    const { items } = await call(`/holidays?year=${state.year}`);
    const years = [state.year - 1, state.year, state.year + 1, state.year + 2];
    const fields = [
      { key: 'date', label: t('field.date'), kind: 'date', required: true },
      { key: 'nameEn', label: t('tk.cfg.nameEn'), required: true, dir: 'ltr' },
      { key: 'nameAr', label: t('tk.cfg.nameAr'), required: true, dir: 'rtl' },
    ];
    body.innerHTML = `${heading(
      'tk.cfg.section.holidays',
      'tk.cfg.holidays.help',
      addButton('holiday', t('tk.cfg.holidays.add'))
    )}
      <div class="field tk-config__year">
        <label class="field__label" for="cfgYear">${esc(t('tk.cfg.holidays.year'))}</label>
        <select class="select" id="cfgYear">${years
          .map(
            (y) => `<option value="${y}" ${y === state.year ? 'selected' : ''}>${y}</option>`
          )
          .join('')}</select>
      </div>
      ${
        items.length
          ? `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
              aria-label="${esc(t('tk.cfg.section.holidays'))}"><table class="table"><thead><tr>
              <th scope="col">${esc(t('field.date'))}</th>
              <th scope="col">${esc(t('tk.cfg.name'))}</th>
              <th scope="col"><span class="u-visually-hidden">${esc(t('admin.field.actions'))}</span></th>
            </tr></thead><tbody>
            ${items
              .map(
                (h) => `<tr><td class="table__num" data-label="${esc(t('field.date'))}">${esc(
                  formatDay(h.date, { weekday: 'short', year: true })
                )}</td>
                  <td data-label="${esc(t('tk.cfg.name'))}">${namePair(h)}</td>
                  <td class="admin-actions">
                    <button type="button" class="btn btn--secondary btn--sm" data-edit-holiday="${esc(h.id)}">
                      <span class="btn__label">${esc(t('action.edit'))}</span></button>
                    <button type="button" class="btn btn--ghost btn--sm" data-del-holiday="${esc(h.id)}">
                      <span class="btn__label">${esc(t('action.delete'))}</span></button>
                  </td></tr>`
              )
              .join('')}
            </tbody></table></div>`
          : emptyRow('tk.cfg.holidays.empty')
      }`;
    body.querySelector('#cfgYear').addEventListener('change', (event) => {
      state.year = Number(event.target.value);
      draw();
    });
    body.querySelector('[data-add="holiday"]')?.addEventListener('click', async () => {
      const saved = await editRecord({
        title: t('tk.cfg.holidays.add'),
        fields,
        values: { date: `${state.year}-01-01` },
        save: (v) => call('/holidays', { method: 'POST', body: v }),
      });
      if (saved) draw();
    });
    for (const button of body.querySelectorAll('[data-edit-holiday]')) {
      button.addEventListener('click', async () => {
        const record = items.find((h) => h.id === button.dataset.editHoliday);
        const saved = await editRecord({
          title: t('tk.cfg.holidays.edit'),
          fields,
          values: record,
          save: (v) =>
            call(`/holidays/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: v }),
        });
        if (saved) draw();
      });
    }
    for (const button of body.querySelectorAll('[data-del-holiday]')) {
      button.addEventListener('click', async () => {
        const record = items.find((h) => h.id === button.dataset.delHoliday);
        const yes = await confirmDialog({
          title: t('tk.cfg.holidays.deleteTitle'),
          body: t('tk.cfg.holidays.deleteBody', { name: localized(record) }),
          confirmLabel: t('action.delete'),
        });
        if (!yes) return;
        try {
          await call(`/holidays/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
          showToast({ tone: 'success', titleKey: 'tk.cfg.saved' });
          draw();
        } catch (err) {
          showToast({ tone: 'danger', titleKey: 'tk.cfg.failed', text: errorText(err) });
        }
      });
    }
  }

  /* ---------------------------------------------------------- canned replies */
  async function drawReplies() {
    const { items } = await call(`/canned-replies?teamId=${encodeURIComponent(state.teamId)}`);
    const fields = [
      { key: 'titleEn', label: t('tk.cfg.replies.titleEn'), required: true, dir: 'ltr' },
      { key: 'titleAr', label: t('tk.cfg.replies.titleAr'), required: true, dir: 'rtl' },
      {
        key: 'bodyEn',
        label: t('tk.cfg.replies.bodyEn'),
        kind: 'textarea',
        required: true,
        dir: 'ltr',
        rows: 5,
      },
      {
        key: 'bodyAr',
        label: t('tk.cfg.replies.bodyAr'),
        kind: 'textarea',
        required: true,
        dir: 'rtl',
        rows: 5,
      },
    ];
    body.innerHTML = `${heading(
      'tk.cfg.section.replies',
      'tk.cfg.replies.help',
      addButton('reply', t('tk.cfg.replies.add'))
    )}
      ${
        items.length
          ? `<ul class="record-list" data-density="compact">${items
              .map(
                (r) => `<li class="record">
                  <div class="record__head">
                    <h3 class="record__title">${namePair(r, 'title')}</h3>
                    <span class="record__aside">${activeBadge(r.isActive)}
                      <button type="button" class="btn btn--secondary btn--sm" data-edit-reply="${esc(r.id)}">
                        <span class="btn__label">${esc(t('action.edit'))}</span></button></span>
                  </div>
                  <p class="record__text tk-config__preview" lang="en" dir="ltr">${esc(r.bodyEn)}</p>
                  <p class="record__text tk-config__preview" lang="ar" dir="rtl">${esc(r.bodyAr)}</p>
                </li>`
              )
              .join('')}</ul>`
          : emptyRow('tk.cfg.replies.empty')
      }`;
    body.querySelector('[data-add="reply"]')?.addEventListener('click', async () => {
      const saved = await editRecord({
        title: t('tk.cfg.replies.add'),
        fields,
        save: (v) =>
          call('/canned-replies', {
            method: 'POST',
            body: { teamId: state.teamId, ...v, sortOrder: items.length * 10 },
          }),
      });
      if (saved) draw();
    });
    for (const button of body.querySelectorAll('[data-edit-reply]')) {
      button.addEventListener('click', async () => {
        const record = items.find((r) => r.id === button.dataset.editReply);
        const saved = await editRecord({
          title: t('tk.cfg.replies.edit'),
          fields: [
            ...fields,
            { key: 'isActive', label: t('tk.cfg.activeLabel'), kind: 'checkbox' },
          ],
          values: record,
          save: (v) =>
            call(`/canned-replies/${encodeURIComponent(record.id)}`, {
              method: 'PATCH',
              body: v,
            }),
        });
        if (saved) draw();
      });
    }
  }

  const DRAW = {
    members: drawMembers,
    categories: drawCategories,
    locations: drawLocations,
    targets: drawTargets,
    holidays: drawHolidays,
    replies: drawReplies,
  };

  async function draw() {
    drawNav();
    body.setAttribute('aria-busy', 'true');
    try {
      await DRAW[state.section]();
    } catch {
      body.innerHTML = loadFailedNotice();
      body.querySelector('[data-retry]').addEventListener('click', draw);
    }
    body.setAttribute('aria-busy', 'false');
  }

  root.querySelector('#cfgNav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-section]');
    if (!button) return;
    state.section = button.dataset.section;
    draw();
  });
  root.querySelector('#cfgTeam')?.addEventListener('change', (event) => {
    state.teamId = event.target.value;
    draw();
  });
  body.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-role]');
    if (!select) return;
    try {
      await call(
        `/teams/${encodeURIComponent(state.teamId)}/members/${encodeURIComponent(select.dataset.role)}`,
        { method: 'PUT', body: { role: select.value } }
      );
      await reloadTeams();
      showToast({ tone: 'success', titleKey: 'tk.cfg.saved' });
    } catch (err) {
      showToast({ tone: 'danger', titleKey: 'tk.cfg.failed', text: errorText(err) });
      draw();
    }
  });
  body.addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove-member]');
    if (!remove) return;
    const person = team().members.find((m) => m.id === remove.dataset.removeMember);
    const yes = await confirmDialog({
      title: t('tk.cfg.members.removeTitle'),
      body: t('tk.cfg.members.removeBody', { name: person ? displayName(person) : '' }),
      confirmLabel: t('tk.cfg.members.removeShort'),
    });
    if (!yes) return;
    try {
      await call(
        `/teams/${encodeURIComponent(state.teamId)}/members/${encodeURIComponent(remove.dataset.removeMember)}`,
        { method: 'DELETE' }
      );
      await reloadTeams();
      showToast({ tone: 'success', titleKey: 'tk.cfg.saved' });
      draw();
    } catch (err) {
      showToast({ tone: 'danger', titleKey: 'tk.cfg.failed', text: errorText(err) });
    }
  });

  await draw();
  return undefined;
}
