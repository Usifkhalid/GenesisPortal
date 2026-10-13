/**
 * pages/audit-log.js — the audit log: every admin change, newest first.
 *
 * Read-only by design (there is no write route behind it). Filters live in
 * the address (#audit-log?company=…&page=2), so a view can be bookmarked or
 * sent to a colleague. A holding admin sees every entry; a company admin only
 * those of the companies they administer. The CSV export is of exactly the
 * current filter, and is itself written to the log.
 */

import { api } from '../api.js';
import { openModal } from '../components/dialog.js';
import { icon } from '../components/icons.js';
import { loadFailedNotice } from '../components/notice.js';
import { formatDateTime, formatDateTimeSeconds, formatNumber } from '../format.js';
import { esc } from '../html.js';
import { localized, t } from '../i18n.js';
import { personName } from './admin/shared.js';

const PAGE_SIZE = 25;
const FILTER_KEYS = ['from', 'to', 'companyId', 'actorId', 'action', 'entity'];

/** A label from the strings where there is one, else the raw value. */
function label(key, raw) {
  const text = t(key);
  return text === key ? raw : text;
}

/**
 * An action that is also the stem of others ("directory.sync" beside
 * "directory.sync.failed") keeps its own words under "_".
 */
const actionLabel = (action) =>
  label(`audit.action.${action}`, label(`audit.action.${action}._`, action));
const entityLabel = (entity) => label(`audit.entity.${entity}`, entity);
const fieldLabel = (name) => label(`audit.field.${name}`, name);

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match }} ctx
 */
export async function render(root, ctx) {
  const query = ctx.route.query;
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, query.get(k) ?? '']));
  const page = Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1);

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);

  let facets;
  let results;
  try {
    [facets, results] = await Promise.all([
      api('/api/admin/audit/facets', { quiet: true }),
      api(
        `/api/admin/audit?${new URLSearchParams({ ...Object.fromEntries(params), page, pageSize: PAGE_SIZE })}`,
        {
          quiet: true,
        }
      ),
    ]);
  } catch {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  const options = (items, selected, allLabel) =>
    [{ value: '', text: allLabel }, ...items]
      .map(
        (item) =>
          `<option value="${esc(item.value)}" ${item.value === selected ? 'selected' : ''}>${esc(
            item.text
          )}</option>`
      )
      .join('');

  const companyOptions = [
    ...(facets.holdingAdmin ? [{ value: 'holding', text: t('audit.filter.holdingOnly') }] : []),
    ...facets.companies.map((c) => ({ value: c.id, text: `${c.code} · ${localized(c)}` })),
  ];

  const lastPage = Math.max(1, Math.ceil(results.total / PAGE_SIZE));
  const from = results.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(results.total, page * PAGE_SIZE);

  const pageLink = (n) => {
    const next = new URLSearchParams(params);
    if (n > 1) next.set('page', String(n));
    const qs = next.toString();
    return `#audit-log${qs ? `?${qs}` : ''}`;
  };

  const exportHref = `/api/admin/audit/export.csv${params.toString() ? `?${params}` : ''}`;

  root.innerHTML = `<div class="stack admin" data-density="compact">
    <header class="page__heading">
      <h1>${esc(t('nav.auditLog'))}</h1>
      <p class="page__lead">${esc(t('audit.lead'))}</p>
    </header>

    <form class="card audit-filters" id="auditFilters" novalidate>
      <h2 class="u-visually-hidden">${esc(t('audit.filter.title'))}</h2>
      <div class="audit-filters__grid">
        <div class="field">
          <label class="field__label" for="fl-from">${esc(t('audit.filter.from'))}</label>
          <input class="input" id="fl-from" type="date" value="${esc(filters.from)}" />
        </div>
        <div class="field">
          <label class="field__label" for="fl-to">${esc(t('audit.filter.to'))}</label>
          <input class="input" id="fl-to" type="date" value="${esc(filters.to)}" />
        </div>
        <div class="field">
          <label class="field__label" for="fl-company">${esc(t('audit.filter.company'))}</label>
          <select class="select" id="fl-company">
            ${options(companyOptions, filters.companyId, t('audit.filter.allCompanies'))}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="fl-actor">${esc(t('audit.filter.actor'))}</label>
          <select class="select" id="fl-actor">
            ${options(
              facets.actors.map((a) => ({ value: a.id, text: personName(a) })),
              filters.actorId,
              t('audit.filter.allActors')
            )}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="fl-action">${esc(t('audit.filter.action'))}</label>
          <select class="select" id="fl-action">
            ${options(
              facets.actions.map((a) => ({ value: a, text: actionLabel(a) })),
              filters.action,
              t('audit.filter.allActions')
            )}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="fl-entity">${esc(t('audit.filter.entity'))}</label>
          <select class="select" id="fl-entity">
            ${options(
              facets.entities.map((e) => ({ value: e, text: entityLabel(e) })),
              filters.entity,
              t('audit.filter.allEntities')
            )}
          </select>
        </div>
      </div>
      <p class="field__help">${esc(t('audit.filter.cairoNote'))}</p>
      <div class="btn-row">
        <button type="submit" class="btn btn--primary">
          ${icon('search', 'btn__icon')}
          <span class="btn__label">${esc(t('audit.filter.apply'))}</span>
        </button>
        <a class="btn btn--ghost" href="#audit-log">
          <span class="btn__label">${esc(t('audit.filter.reset'))}</span>
        </a>
        <a class="btn btn--secondary audit-filters__export" href="${esc(exportHref)}" download="audit-log.csv">
          ${icon('upload', 'btn__icon')}
          <span class="btn__label">${esc(t('audit.export'))}</span>
        </a>
      </div>
    </form>

    <p class="audit-count" role="status">${esc(
      t('audit.count', {
        from: formatNumber(from),
        to: formatNumber(to),
        total: formatNumber(results.total),
      })
    )}</p>

    ${
      results.items.length === 0
        ? `<div class="empty"><p class="empty__title">${esc(t('audit.empty'))}</p></div>`
        : `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
             aria-label="${esc(t('audit.caption'))}">
            <table class="table" role="table">
              <caption class="u-visually-hidden">${esc(t('audit.caption'))}</caption>
              <thead role="rowgroup"><tr role="row">
                <th role="columnheader" scope="col">${esc(t('audit.col.when'))}</th>
                <th role="columnheader" scope="col">${esc(t('audit.col.actor'))}</th>
                <th role="columnheader" scope="col">${esc(t('audit.col.company'))}</th>
                <th role="columnheader" scope="col">${esc(t('audit.col.action'))}</th>
                <th role="columnheader" scope="col">${esc(t('audit.col.entity'))}</th>
                <th role="columnheader" scope="col"><span class="u-visually-hidden">${esc(
                  t('admin.field.actions')
                )}</span></th>
              </tr></thead>
              <tbody role="rowgroup">${results.items.map(rowHtml).join('')}</tbody>
            </table>
          </div>`
    }

    ${
      lastPage > 1
        ? `<nav class="pagination" aria-label="${esc(t('audit.pagination'))}">
            <a class="pagination__link pagination__step" href="${pageLink(page - 1)}"
              ${page <= 1 ? 'aria-disabled="true" tabindex="-1"' : ''}>
              ${icon('chevronEnd', 'icon--dir')}
              <span>${esc(t('pagination.previous'))}</span>
            </a>
            <p class="pagination__status">${esc(
              t('audit.page', { page: formatNumber(page), pages: formatNumber(lastPage) })
            )}</p>
            <a class="pagination__link pagination__step" href="${pageLink(page + 1)}"
              ${page >= lastPage ? 'aria-disabled="true" tabindex="-1"' : ''}>
              <span>${esc(t('pagination.next'))}</span>
              ${icon('chevronEnd', 'icon--dir')}
            </a>
          </nav>`
        : ''
    }
  </div>`;

  // Previous on page 1 and Next on the last page are drawn but do nothing.
  for (const link of root.querySelectorAll('.pagination [aria-disabled="true"]')) {
    link.addEventListener('click', (event) => event.preventDefault());
  }

  root.querySelector('#auditFilters').addEventListener('submit', (event) => {
    event.preventDefault();
    const next = new URLSearchParams();
    const set = (key, id) => {
      const value = root.querySelector(`#${id}`).value;
      if (value) next.set(key, value);
    };
    set('from', 'fl-from');
    set('to', 'fl-to');
    set('companyId', 'fl-company');
    set('actorId', 'fl-actor');
    set('action', 'fl-action');
    set('entity', 'fl-entity');
    const qs = next.toString();
    location.hash = `#audit-log${qs ? `?${qs}` : ''}`;
  });

  for (const button of root.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => openDetail(button.dataset.view, button));
  }
  return undefined;
}

function rowHtml(row) {
  const who = row.actor ? personName(row.actor) : t('audit.system');
  return `<tr role="row">
    <td role="cell" class="table__num" data-label="${esc(t('audit.col.when'))}">${esc(
      formatDateTime(row.at)
    )}</td>
    <td role="cell" data-label="${esc(t('audit.col.actor'))}">${esc(who)}</td>
    <td role="cell" data-label="${esc(t('audit.col.company'))}">${
      row.companyCode
        ? `<span class="admin-code">${esc(row.companyCode)}</span>`
        : `<span class="audit-muted">${esc(t('audit.holdingWide'))}</span>`
    }</td>
    <td role="cell" data-label="${esc(t('audit.col.action'))}">${esc(actionLabel(row.action))}</td>
    <td role="cell" data-label="${esc(t('audit.col.entity'))}">${esc(entityLabel(row.entity))}</td>
    <td role="cell" class="admin-actions">
      <button type="button" class="btn btn--secondary btn--sm" data-view="${esc(row.id)}"
        aria-label="${esc(
          t('audit.viewNamed', {
            action: actionLabel(row.action),
            when: formatDateTime(row.at),
          })
        )}">
        <span class="btn__label">${esc(t('audit.view'))}</span>
      </button>
    </td>
  </tr>`;
}

/* ------------------------------------------------------------------ drawer */

function valueHtml(value) {
  if (value === null || value === undefined || value === '') {
    return `<span class="audit-muted" aria-label="${esc(t('audit.emptyValue'))}">—</span>`;
  }
  if (typeof value === 'boolean') return esc(t(value ? 'audit.yes' : 'audit.no'));
  if (Array.isArray(value)) {
    return `<span dir="ltr">${value.map((v) => esc(String(v))).join(', ')}</span>`;
  }
  if (typeof value === 'object') return `<code dir="ltr">${esc(JSON.stringify(value))}</code>`;
  return `<span dir="auto">${esc(String(value))}</span>`;
}

/**
 * The before/after of one entry. Changed fields are laid out with both values
 * and named as before and after (not by colour alone); unchanged ones collapse.
 */
export function diffHtml(before, after) {
  const names = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  const changed = names.filter((n) => !same(before?.[n], after?.[n]));
  const unchanged = names.filter((n) => same(before?.[n], after?.[n]));

  const rows = changed
    .map(
      (name) => `<div class="diff__row diff__row--changed">
        <dt class="diff__name">${esc(fieldLabel(name))}</dt>
        <dd class="diff__values">
          <p class="diff__old"><span class="diff__tag">${esc(t('audit.before'))}</span>${valueHtml(
            before?.[name]
          )}</p>
          <p class="diff__new"><span class="diff__tag">${esc(t('audit.after'))}</span>${valueHtml(
            after?.[name]
          )}</p>
        </dd>
      </div>`
    )
    .join('');

  const rest = unchanged.length
    ? `<details class="diff__unchanged">
        <summary>${esc(t('audit.unchanged', { count: formatNumber(unchanged.length) }))}</summary>
        <dl class="diff">${unchanged
          .map(
            (name) => `<div class="diff__row">
              <dt class="diff__name">${esc(fieldLabel(name))}</dt>
              <dd class="diff__values">${valueHtml(after?.[name] ?? before?.[name])}</dd>
            </div>`
          )
          .join('')}</dl>
      </details>`
    : '';

  if (!changed.length && !unchanged.length) {
    return `<p class="audit-muted">${esc(t('audit.noSnapshot'))}</p>`;
  }
  return `${changed.length ? `<dl class="diff">${rows}</dl>` : `<p class="audit-muted">${esc(t('audit.nothingChanged'))}</p>`}${rest}`;
}

async function openDetail(id, opener) {
  let entry;
  try {
    entry = await api(`/api/admin/audit/${encodeURIComponent(id)}`);
  } catch {
    return;
  }

  const who = entry.actor ? personName(entry.actor) : t('audit.system');
  const kind =
    entry.before == null && entry.after != null
      ? t('audit.kind.created')
      : entry.after == null && entry.before != null
        ? t('audit.kind.removed')
        : t('audit.kind.changed');

  const { dialog } = openModal({
    kind: 'drawer',
    lead: kind,
    title: actionLabel(entry.action),
    bodyHtml: `<dl class="labelstrip labelstrip--compact audit-meta">
        ${[
          [t('audit.col.when'), formatDateTimeSeconds(entry.at)],
          [t('audit.col.actor'), who],
          [t('audit.col.company'), entry.companyCode ?? t('audit.holdingWide')],
          [t('audit.col.entity'), entityLabel(entry.entity)],
          [t('audit.entityId'), entry.entityId ?? '—'],
          [t('audit.ip'), entry.ip ?? '—'],
        ]
          .map(
            ([key, value]) => `<div class="labelstrip__pair">
              <dt class="labelstrip__key">${esc(key)}</dt>
              <dd class="labelstrip__value">${esc(value)}</dd>
            </div>`
          )
          .join('')}
      </dl>
      <h3 class="card__title">${esc(t('audit.changes'))}</h3>
      ${diffHtml(entry.before, entry.after)}`,
  });
  dialog.addEventListener('close', () => opener?.focus(), { once: true });
}
