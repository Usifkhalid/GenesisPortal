/**
 * pages/announcements/manage.js — what administrators see: every status
 * (drafts, scheduled, published, expired) within their scope, with "read by
 * X of Y". Publish, unpublish, duplicate and delete happen here; writing
 * and editing happen in editor.js.
 */

import { api } from '../../api.js';
import { confirmDialog } from '../../components/dialog.js';
import { loadFailedNotice } from '../../components/notice.js';
import { showToast } from '../../components/toast.js';
import { formatDateTime, formatNumber } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import {
  CATEGORIES,
  announceChange,
  audienceLabel,
  categoryLabel,
  dirOf,
  errorText,
  pagerHtml,
  shownLanguage,
  textOf,
} from './shared.js';

const PAGE_SIZE = 20;
const STATUSES = ['Draft', 'Scheduled', 'Published', 'Expired'];
const BADGE = {
  Draft: '',
  Scheduled: 'badge--info',
  Published: 'badge--success',
  Expired: 'badge--warning',
};

/** Words for the languages a post still lacks. */
function missingBadges(item) {
  return ['en', 'ar']
    .filter((lang) => item.translationMissing[lang])
    .map(
      (lang) =>
        `<span class="badge badge--warning" title="${esc(t('ann.editor.incomplete'))}">${esc(
          t('ann.admin.missing', { language: t(`ann.lang.${lang}`) })
        )}</span>`
    )
    .join(' ');
}

function rowHtml(item) {
  const lang = shownLanguage({
    languages: { en: !item.translationMissing.en, ar: !item.translationMissing.ar },
  });
  const title = textOf(item, 'title', lang) || t('ann.admin.untitled');
  const named = (action) => t('ann.admin.action.named', { action, title });
  const status = item.status;
  const label = (key) => t(`ann.admin.action.${key}`);

  const actions = [
    `<a class="btn btn--secondary btn--sm" href="#announcements/${esc(item.id)}/edit"
        aria-label="${esc(named(label('edit')))}"><span class="btn__label">${esc(label('edit'))}</span></a>`,
    status !== 'Published'
      ? `<button type="button" class="btn btn--ghost btn--sm" data-act="publish" data-id="${esc(item.id)}"
          aria-label="${esc(named(label('publish')))}"><span class="btn__label">${esc(label('publish'))}</span></button>`
      : '',
    status !== 'Draft'
      ? `<button type="button" class="btn btn--ghost btn--sm" data-act="unpublish" data-id="${esc(item.id)}"
          aria-label="${esc(named(label('unpublish')))}"><span class="btn__label">${esc(label('unpublish'))}</span></button>`
      : '',
    `<button type="button" class="btn btn--ghost btn--sm" data-act="duplicate" data-id="${esc(item.id)}"
        aria-label="${esc(named(label('duplicate')))}"><span class="btn__label">${esc(label('duplicate'))}</span></button>`,
    status === 'Draft'
      ? `<button type="button" class="btn btn--ghost btn--sm" data-act="delete" data-id="${esc(item.id)}"
          aria-label="${esc(named(label('delete')))}"><span class="btn__label">${esc(label('delete'))}</span></button>`
      : '',
  ].join('');

  const when = item.publishAt ? formatDateTime(item.publishAt) : t('ann.admin.noDate');
  const { read, audience } = item.readStats;

  return `<tr role="row" data-id="${esc(item.id)}" data-updated="${esc(item.updatedAt)}">
    <td role="cell" data-label="${esc(t('ann.admin.col.title'))}">
      <a class="ann-manage__title" href="#announcements/${esc(item.id)}/edit" lang="${lang}" dir="${dirOf(lang)}">${esc(title)}</a>
      <span class="ann-manage__meta">
        <span class="tag">${esc(categoryLabel(item.category))}</span>
        ${item.isPinned ? `<span class="tag">${esc(t('ann.admin.pinned'))}</span>` : ''}
        ${missingBadges(item)}
      </span>
    </td>
    <td role="cell" data-label="${esc(t('ann.admin.col.audience'))}">${esc(audienceLabel(item))}</td>
    <td role="cell" data-label="${esc(t('ann.admin.col.status'))}">
      <span class="badge ${BADGE[status]}">${esc(t(`ann.admin.status.${status}`))}</span>
    </td>
    <td role="cell" data-label="${esc(t('ann.admin.col.when'))}">
      ${esc(when)}
      ${
        item.expiresAt
          ? `<span class="ann-manage__sub">${esc(
              t('ann.admin.expiresOn', { date: formatDateTime(item.expiresAt) })
            )}</span>`
          : ''
      }
    </td>
    <td role="cell" class="table__num" data-label="${esc(t('ann.admin.col.reads'))}">
      ${
        status === 'Published' || status === 'Expired' || read > 0
          ? esc(
              t('ann.admin.readBy', { read: formatNumber(read), total: formatNumber(audience) })
            )
          : '—'
      }
    </td>
    <td role="cell" class="admin-actions" data-label="${esc(t('ann.admin.col.actions'))}">${actions}</td>
  </tr>`;
}

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../../router.js').Match }} ctx
 */
export async function render(root, ctx) {
  const { query } = ctx.route;
  const status = STATUSES.includes(query.get('status')) ? query.get('status') : '';
  const category = CATEGORIES.includes(query.get('category')) ? query.get('category') : '';
  const companyId = query.get('companyId') ?? '';
  const page = Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1);

  let scope;
  try {
    scope = await api('/api/admin/scope', { quiet: true });
  } catch {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  const addressFor = (changes) => {
    const next = new URLSearchParams();
    const values = { status, category, companyId, page: '', ...changes };
    for (const [key, value] of Object.entries(values)) {
      if (value && !(key === 'page' && Number(value) === 1)) next.set(key, value);
    }
    const qs = next.toString();
    return `#announcements/manage${qs ? `?${qs}` : ''}`;
  };

  const audiences = [
    ...(scope.holdingAdmin
      ? [{ value: 'holding', label: t('ann.editor.audienceHolding') }]
      : []),
    ...scope.companies.map((c) => ({ value: c.id, label: `${c.code} · ${localized(c)}` })),
  ];

  root.innerHTML = `<div class="stack ann admin" data-density="compact">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t('ann.admin.title'))}</h1>
        <p class="page__lead">${esc(t('ann.admin.lead'))}</p>
      </div>
      <div class="page__actions">
        <a class="btn btn--secondary" href="#announcements">
          <span class="btn__label">${esc(t('ann.admin.view'))}</span>
        </a>
        <a class="btn btn--primary" href="#announcements/new">
          <span class="btn__label">${esc(t('ann.new'))}</span>
        </a>
      </div>
    </header>

    <form class="card ann-manage__filters" id="manageFilters" data-density="compact">
      <div class="field">
        <label class="field__label" for="fStatus">${esc(t('ann.admin.statusFilter'))}</label>
        <select class="select" id="fStatus">
          <option value="">${esc(t('ann.admin.statusAll'))}</option>
          ${STATUSES.map(
            (s) =>
              `<option value="${s}" ${s === status ? 'selected' : ''}>${esc(
                t(`ann.admin.status.${s}`)
              )}</option>`
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="fCategory">${esc(t('ann.filters.category'))}</label>
        <select class="select" id="fCategory">
          <option value="">${esc(t('ann.filters.categoryAll'))}</option>
          ${CATEGORIES.map(
            (c) =>
              `<option value="${c}" ${c === category ? 'selected' : ''}>${esc(
                categoryLabel(c)
              )}</option>`
          ).join('')}
        </select>
      </div>
      ${
        audiences.length > 1
          ? `<div class="field">
               <label class="field__label" for="fAudience">${esc(t('ann.admin.companyFilter'))}</label>
               <select class="select" id="fAudience">
                 <option value="">${esc(t('ann.admin.companyAll'))}</option>
                 ${audiences
                   .map(
                     (a) =>
                       `<option value="${esc(a.value)}" ${a.value === companyId ? 'selected' : ''}>${esc(
                         a.label
                       )}</option>`
                   )
                   .join('')}
               </select>
             </div>`
          : ''
      }
    </form>

    <div id="manageBody" aria-busy="true">
      <p class="u-visually-hidden">${esc(t('loading.label'))}</p>
      <div class="skeleton skeleton--title"></div>
    </div>
  </div>`;

  const go = (changes) => {
    location.hash = addressFor({ ...changes, page: '' });
  };
  root
    .querySelector('#fStatus')
    .addEventListener('change', (e) => go({ status: e.target.value }));
  root
    .querySelector('#fCategory')
    .addEventListener('change', (e) => go({ category: e.target.value }));
  root
    .querySelector('#fAudience')
    ?.addEventListener('change', (e) => go({ companyId: e.target.value }));

  const body = root.querySelector('#manageBody');
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  if (companyId) params.set('companyId', companyId);

  let result;
  try {
    result = await api(`/api/admin/announcements?${params}`, { quiet: true });
  } catch {
    body.setAttribute('aria-busy', 'false');
    body.innerHTML = loadFailedNotice();
    body.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  body.setAttribute('aria-busy', 'false');
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  if (result.items.length === 0) {
    const filtered = status || category || companyId;
    body.innerHTML = `<div class="empty"><p class="empty__title">${esc(
      t(filtered ? 'ann.admin.emptyFiltered' : 'ann.admin.empty')
    )}</p></div>`;
    return undefined;
  }

  const head = (key, cls = '') =>
    `<th role="columnheader" scope="col" ${cls ? `class="${cls}"` : ''}>${esc(t(key))}</th>`;
  body.innerHTML = `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
      aria-label="${esc(t('ann.admin.caption'))}">
      <table class="table" role="table">
        <caption class="u-visually-hidden">${esc(t('ann.admin.caption'))}</caption>
        <thead role="rowgroup"><tr role="row">
          ${head('ann.admin.col.title')}${head('ann.admin.col.audience')}${head('ann.admin.col.status')}
          ${head('ann.admin.col.when')}${head('ann.admin.col.reads', 'table__num')}
          <th role="columnheader" scope="col"><span class="u-visually-hidden">${esc(
            t('ann.admin.col.actions')
          )}</span></th>
        </tr></thead>
        <tbody role="rowgroup">${result.items.map(rowHtml).join('')}</tbody>
      </table>
    </div>
    ${pagerHtml({
      page,
      pages,
      label: t('ann.pagination'),
      hrefFor: (n) => addressFor({ page: String(n) }),
    })}`;

  for (const link of body.querySelectorAll('.pagination [aria-disabled="true"]')) {
    link.addEventListener('click', (event) => event.preventDefault());
  }

  /* ---- row actions */
  const byId = new Map(result.items.map((i) => [i.id, i]));

  async function act(button) {
    const item = byId.get(button.dataset.id);
    if (!item) return;
    const title = textOf(item, 'title') || t('ann.admin.untitled');
    const base = `/api/admin/announcements/${encodeURIComponent(item.id)}`;
    const kind = button.dataset.act;

    if (kind === 'unpublish') {
      const ok = await confirmDialog({
        title: t('ann.confirm.unpublishTitle'),
        body: t('ann.confirm.unpublishBody'),
        confirmLabel: t('ann.confirm.unpublish'),
        tone: 'primary',
      });
      if (!ok) return;
    }
    if (kind === 'delete') {
      const ok = await confirmDialog({
        title: t('ann.confirm.deleteTitle'),
        body: `${title}. ${t('ann.confirm.deleteBody')}`,
        confirmLabel: t('ann.confirm.delete'),
      });
      if (!ok) return;
    }

    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    try {
      if (kind === 'publish') {
        await api(`${base}/publish`, {
          method: 'POST',
          body: { updatedAt: item.updatedAt },
          quiet: true,
        });
      } else if (kind === 'unpublish') {
        await api(`${base}/unpublish`, {
          method: 'POST',
          body: { updatedAt: item.updatedAt },
          quiet: true,
        });
      } else if (kind === 'duplicate') {
        await api(`${base}/duplicate`, { method: 'POST', body: {}, quiet: true });
      } else if (kind === 'delete') {
        await api(base, { method: 'DELETE', quiet: true });
      }
      showToast({
        tone: 'success',
        titleKey: {
          publish: 'ann.toast.published',
          unpublish: 'ann.toast.unpublished',
          duplicate: 'ann.toast.duplicated',
          delete: 'ann.toast.deleted',
        }[kind],
      });
      announceChange();
      await render(root, ctx);
    } catch (err) {
      button.removeAttribute('aria-busy');
      button.disabled = false;
      showToast({ tone: 'danger', titleKey: 'ann.error.title', text: errorText(err) });
      if (err?.code === 'stale_record') await render(root, ctx);
    }
  }

  body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (button) act(button);
  });
  return undefined;
}
