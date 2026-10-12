/**
 * pages/tickets/queue.js — IT's queue: every ticket the support team serves,
 * across companies. Quick filters, a filter bar, a dense table with the SLA
 * clock, bulk assign, and "Log a ticket for someone".
 *
 *   #tickets/queue?f=unassigned&company=&location=&category=&priority=&status=&q=&page=
 *
 * Only IT sees this page (tickets.js hides it and the API refuses anyone
 * else). The words here are IT's: P1..P4, the SLA clock, "breached".
 */

import { api } from '../../api.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { displayName } from '../../components/person.js';
import { showToast } from '../../components/toast.js';
import { formatNumber } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import { openLogDialog } from './log.js';
import {
  PRIORITIES,
  announceChange,
  dueDate,
  errorText,
  numberHtml,
  priorityBadge,
  slaBadge,
  statusBadge,
  statusLabel,
} from './shared.js';

const PAGE_SIZE = 25;

/** Each quick filter is a fixed part of the query. */
const QUICK = {
  unassigned: { assignee: 'unassigned' },
  mine: { assignee: 'me' },
  atRisk: { sla: 'at_risk' },
  breached: { sla: 'breached' },
  all: {},
};
const QUICK_KEYS = Object.keys(QUICK);
const STATUS_CHOICES = [
  'active',
  'New',
  'Open',
  'WaitingOnRequester',
  'Resolved',
  'Closed',
  'all',
];

/**
 * @param {HTMLElement} root
 * @param {{ route: object, who: object, user: object }} ctx
 */
export async function render(root, ctx) {
  const options = ctx.who.queueOptions;
  const asked = ctx.route.query;
  const known = (list, value) => (list.some((x) => x.id === value) ? value : '');
  const state = {
    quick: QUICK_KEYS.includes(asked.get('f')) ? asked.get('f') : 'all',
    company: known(options.companies, asked.get('company')),
    location: known(options.locations, asked.get('location')),
    category: known(options.categories, asked.get('category')),
    priority: PRIORITIES.includes(asked.get('priority')) ? asked.get('priority') : '',
    status: STATUS_CHOICES.includes(asked.get('status')) ? asked.get('status') : 'active',
    q: (asked.get('q') ?? '').slice(0, 100),
    page: Math.max(1, Math.trunc(Number(asked.get('page'))) || 1),
  };
  let result = { items: [], total: 0 };
  let counts = ctx.who.counts ?? null;
  // Only a Lead or a HoldingAdmin assigns (D118); an agent reads the queue.
  const canAssign = Boolean(counts?.canAssign);
  let turn = 0;
  let timer = null;
  const selected = new Set();

  const option = (value, text, chosen) =>
    `<option value="${esc(value)}" ${value === chosen ? 'selected' : ''}>${esc(text)}</option>`;
  const quickLabel = (key) => t(`tk.queue.quick.${key}`);

  root.innerHTML = `<section class="stack tk-queue" aria-labelledby="tkQueueTitle">
    <div class="tk-queue__head">
      <h2 class="u-visually-hidden" id="tkQueueTitle">${esc(t('tk.queue.title'))}</h2>
      <div class="segmented tk-quick" role="group" aria-label="${esc(t('tk.queue.quickLabel'))}" id="tkQuick">
        ${QUICK_KEYS.map(
          (key) =>
            `<button type="button" class="segmented__option" data-quick="${key}">
              <span>${esc(quickLabel(key))}</span>
              <span class="tk-quick__count" data-count="${key}"></span>
            </button>`
        ).join('')}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn--ghost btn--sm" id="tkRefresh">
          ${icon('refresh', 'btn__icon')}<span class="btn__label">${esc(t('tk.queue.refresh'))}</span>
        </button>
        <button type="button" class="btn btn--primary btn--sm" id="tkLog">
          ${icon('phone', 'btn__icon')}<span class="btn__label">${esc(t('tk.queue.log'))}</span>
        </button>
      </div>
    </div>

    <div class="tk-searchrow">
      <form class="field tk-search" role="search" id="tkSearchForm">
        <label class="field__label" for="tkQ">${esc(t('tk.queue.search'))}</label>
        <div class="input-group">
          ${icon('search', 'input-group__icon')}
          <input class="input" id="tkQ" name="q" type="search" autocomplete="off" maxlength="100"
            enterkeyhint="search" value="${esc(state.q)}" />
        </div>
      </form>
      <button type="button" class="btn btn--secondary" id="tkFiltersToggle" aria-expanded="false"
        aria-controls="tkFilterForm">
        <span class="btn__label">${esc(t('tk.queue.filters'))}</span>
        <span class="tk-quick__count" id="tkFilterCount"></span>
      </button>
    </div>

    <div class="tk-filters">
      <form class="tk-filters__form card" id="tkFilterForm" hidden>
        <div class="field">
          <label class="field__label" for="tkFCompany">${esc(t('ticket.company'))}</label>
          <select class="select" id="tkFCompany" name="company">
            ${option('', t('tk.queue.any'), state.company)}
            ${options.companies
              .map((c) => option(c.id, `${c.code} · ${localized(c)}`, state.company))
              .join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="tkFLocation">${esc(t('tk.field.location'))}</label>
          <select class="select" id="tkFLocation" name="location">
            ${option('', t('tk.queue.any'), state.location)}
            ${options.locations.map((l) => option(l.id, localized(l), state.location)).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="tkFCategory">${esc(t('tk.field.category'))}</label>
          <select class="select" id="tkFCategory" name="category">
            ${option('', t('tk.queue.any'), state.category)}
            ${options.categories.map((c) => option(c.id, localized(c), state.category)).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="tkFPriority">${esc(t('field.priority'))}</label>
          <select class="select" id="tkFPriority" name="priority">
            ${option('', t('tk.queue.any'), state.priority)}
            ${PRIORITIES.map((p) =>
              option(p, `${p} · ${t(`ticket.priority.${p}`)}`, state.priority)
            ).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="tkFStatus">${esc(t('status.label'))}</label>
          <select class="select" id="tkFStatus" name="status">
            ${STATUS_CHOICES.map((s) =>
              option(
                s,
                s === 'active'
                  ? t('tk.queue.statusActive')
                  : s === 'all'
                    ? t('tk.queue.statusAll')
                    : statusLabel(s, true),
                state.status
              )
            ).join('')}
          </select>
        </div>
      </form>
    </div>

    ${
      canAssign
        ? `<div class="tk-bulk card" id="tkBulk" hidden>
      <p class="tk-bulk__count" id="tkBulkCount" role="status" aria-live="polite"></p>
      <div class="field tk-bulk__who">
        <label class="field__label" for="tkBulkAgent">${esc(t('tk.queue.bulkTo'))}</label>
        <select class="select" id="tkBulkAgent">
          ${options.agents
            .map((a) => `<option value="${esc(a.id)}">${esc(displayName(a))}</option>`)
            .join('')}
        </select>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn--primary btn--sm" id="tkBulkGo">
          <span class="btn__label">${esc(t('tk.queue.bulkAssign'))}</span>
        </button>
        <button type="button" class="btn btn--ghost btn--sm" id="tkBulkClear">
          <span class="btn__label">${esc(t('tk.queue.bulkClear'))}</span>
        </button>
      </div>
    </div>`
        : ''
    }

    <p class="tk-queue__count" id="tkCount" role="status" aria-live="polite"></p>
    <div id="tkQueueBody" aria-busy="true"></div>
  </section>`;

  const body = root.querySelector('#tkQueueBody');
  const countLine = root.querySelector('#tkCount');
  const bulk = root.querySelector('#tkBulk');
  const filterForm = root.querySelector('#tkFilterForm');

  /* ---------------------------------------------------------------- address */
  function setAddress() {
    const params = new URLSearchParams();
    if (state.quick !== 'all') params.set('f', state.quick);
    for (const key of ['company', 'location', 'category', 'priority', 'q']) {
      if (state[key]) params.set(key, state[key]);
    }
    if (state.status !== 'active') params.set('status', state.status);
    if (state.page > 1) params.set('page', String(state.page));
    const query = params.toString();
    history.replaceState(null, '', `#tickets/queue${query ? `?${query}` : ''}`);
  }

  function drawQuick() {
    for (const button of root.querySelectorAll('[data-quick]')) {
      button.setAttribute('aria-pressed', String(button.dataset.quick === state.quick));
    }
    const put = (key, value) => {
      const el = root.querySelector(`[data-count="${key}"]`);
      if (el) el.textContent = value == null ? '' : formatNumber(value);
    };
    put('unassigned', counts?.unassigned);
    put('mine', counts?.assignedToMe);
  }

  /* ------------------------------------------------------------------ table */
  function rowHtml(ticket) {
    const checked = selected.has(ticket.id);
    const requester = ticket.requester ? displayName(ticket.requester) : '';
    const assignee = ticket.assignee ? displayName(ticket.assignee) : t('ticket.unassigned');
    const done = ['Resolved', 'Closed'].includes(ticket.status);
    return `<tr role="row" data-id="${esc(ticket.id)}" ${done ? 'class="table__muted"' : ''}>
      ${
        canAssign
          ? `<td role="cell" class="tk-table__pick">
        <label class="choice choice--inline">
          <input class="choice__control" type="checkbox" data-pick="${esc(ticket.id)}"
            ${checked ? 'checked' : ''}
            aria-label="${esc(t('tk.queue.pick', { number: ticket.number }))}" />
        </label>
      </td>`
          : ''
      }
      <td role="cell" data-label="${esc(t('ticket.one'))}">
        <a class="tk-table__subject" href="#tickets/${esc(ticket.id)}?from=queue"><bdi>${esc(
          ticket.subject
        )}</bdi></a>
        <span class="tk-table__meta"><span class="table__num">${numberHtml(ticket.number)}</span>
          · ${esc(requester)}${
            ticket.company
              ? ` · <span class="admin-code">${esc(ticket.company.code)}</span>`
              : ''
          }${ticket.location ? ` · ${esc(localized(ticket.location))}` : ''}</span>
      </td>
      <td role="cell" data-label="${esc(t('field.priority'))}">${priorityBadge(ticket.priority, { staff: true })}</td>
      <td role="cell" data-label="${esc(t('status.label'))}">${statusBadge(ticket.status, { staff: true })}</td>
      <td role="cell" data-label="${esc(t('tk.field.sla'))}">
        ${slaBadge(ticket)}
        ${
          ticket.sla.dueAt && !done
            ? `<span class="tk-table__meta table__num">${esc(dueDate(ticket.sla.dueAt))}</span>`
            : ''
        }
      </td>
      <td role="cell" data-label="${esc(t('ticket.assignee'))}">${esc(assignee)}</td>
      <td role="cell" data-label="${esc(t('tk.field.category'))}">${esc(localized(ticket.category))}</td>
      <td role="cell" data-label="${esc(t('tk.queue.updated'))}" class="table__num">${esc(
        dueDate(ticket.updatedAt)
      )}</td>
    </tr>`;
  }

  function draw() {
    body.setAttribute('aria-busy', 'false');
    const { items, total } = result;
    countLine.textContent = t('tk.queue.count', { count: formatNumber(total) });
    drawBulk();
    if (items.length === 0) {
      body.innerHTML = `<div class="empty empty--inline">
        ${icon('statusResolved', 'empty__mark')}
        <div class="empty__copy">
          <p class="empty__title">${esc(t('tk.queue.emptyTitle'))}</p>
          <p class="empty__text">${esc(t('tk.queue.emptyText'))}</p>
        </div></div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const allOnPage = items.every((i) => selected.has(i.id));
    body.innerHTML = `<div class="table-wrap tk-table" data-density="compact" tabindex="0" role="region"
        aria-label="${esc(t('tk.queue.caption'))}">
        <table class="table" role="table">
          <caption class="u-visually-hidden">${esc(t('tk.queue.caption'))}</caption>
          <thead role="rowgroup"><tr role="row">
            ${
              canAssign
                ? `<th role="columnheader" scope="col" class="tk-table__pick">
              <label class="choice choice--inline">
                <input class="choice__control" type="checkbox" id="tkPickAll" ${allOnPage ? 'checked' : ''}
                  aria-label="${esc(t('tk.queue.pickAll'))}" />
              </label>
            </th>`
                : ''
            }
            <th role="columnheader" scope="col">${esc(t('ticket.one'))}</th>
            <th role="columnheader" scope="col">${esc(t('field.priority'))}</th>
            <th role="columnheader" scope="col">${esc(t('status.label'))}</th>
            <th role="columnheader" scope="col">${esc(t('tk.field.sla'))}</th>
            <th role="columnheader" scope="col">${esc(t('ticket.assignee'))}</th>
            <th role="columnheader" scope="col">${esc(t('tk.field.category'))}</th>
            <th role="columnheader" scope="col">${esc(t('tk.queue.updated'))}</th>
          </tr></thead>
          <tbody role="rowgroup">${items.map(rowHtml).join('')}</tbody>
        </table>
      </div>
      ${
        pages > 1
          ? `<nav class="pagination" aria-label="${esc(t('tk.queue.pages'))}">
              <button type="button" class="btn btn--secondary btn--sm" data-page="${state.page - 1}"
                ${state.page <= 1 ? 'disabled' : ''}>
                <span class="btn__label">${esc(t('pagination.previous'))}</span></button>
              <p class="pagination__status">${esc(
                t('tk.queue.pageOf', { page: state.page, pages })
              )}</p>
              <button type="button" class="btn btn--secondary btn--sm" data-page="${state.page + 1}"
                ${state.page >= pages ? 'disabled' : ''}>
                <span class="btn__label">${esc(t('pagination.next'))}</span></button>
            </nav>`
          : ''
      }`;
  }

  function drawBulk() {
    if (!bulk) return;
    bulk.hidden = selected.size === 0;
    root.querySelector('#tkBulkCount').textContent = t('tk.queue.selected', {
      count: formatNumber(selected.size),
    });
  }

  /* ------------------------------------------------------------------- load */
  function query() {
    const params = new URLSearchParams({
      status: state.status,
      page: String(state.page),
      pageSize: String(PAGE_SIZE),
    });
    for (const [key, value] of Object.entries(QUICK[state.quick])) params.set(key, value);
    if (state.company) params.set('companyId', state.company);
    if (state.location) params.set('locationId', state.location);
    if (state.category) params.set('categoryId', state.category);
    if (state.priority) params.set('priority', state.priority);
    if (state.q) params.set('q', state.q);
    return params;
  }

  async function load({ quiet = false } = {}) {
    const mine = ++turn;
    setAddress();
    drawQuick();
    drawFilterCount();
    if (!quiet) body.setAttribute('aria-busy', 'true');
    try {
      const [page, fresh] = await Promise.all([
        api(`/api/tickets/queue?${query()}`, { quiet: true }),
        api('/api/tickets/counts', { quiet: true }).catch(() => null),
      ]);
      if (mine !== turn) return;
      result = page;
      if (fresh?.queue) counts = fresh.queue;
      drawQuick();
      draw();
    } catch {
      if (mine !== turn) return;
      body.setAttribute('aria-busy', 'false');
      countLine.textContent = '';
      body.innerHTML = loadFailedNotice();
      body.querySelector('[data-retry]').addEventListener('click', () => load());
    }
  }

  const restart = () => {
    state.page = 1;
    selected.clear();
    load();
  };

  /* ----------------------------------------------------------------- events */
  root.querySelector('#tkQuick').addEventListener('click', (event) => {
    const button = event.target.closest('[data-quick]');
    if (!button || button.dataset.quick === state.quick) return;
    state.quick = button.dataset.quick;
    restart();
  });

  filterForm.addEventListener('submit', (event) => event.preventDefault());
  filterForm.addEventListener('change', () => {
    const f = filterForm.elements;
    state.company = f.company.value;
    state.location = f.location.value;
    state.category = f.category.value;
    state.priority = f.priority.value;
    state.status = f.status.value;
    restart();
  });
  root.querySelector('#tkSearchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    const q = event.target.elements.q.value.trim();
    if (q === state.q) return;
    state.q = q;
    restart();
  });
  root.querySelector('#tkQ').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = event.target.value.trim();
      if (q === state.q) return;
      state.q = q;
      restart();
    }, 250);
  });

  root.querySelector('#tkRefresh').addEventListener('click', () => load());

  const toggle = root.querySelector('#tkFiltersToggle');
  const setFiltersOpen = (open) => {
    filterForm.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setFiltersOpen(filterForm.hidden));
  // A queue opened on a filtered address shows the filters that are on.
  const activeFilters = () =>
    [state.company, state.location, state.category, state.priority].filter(Boolean).length +
    (state.status !== 'active' ? 1 : 0);
  const drawFilterCount = () => {
    const count = activeFilters();
    root.querySelector('#tkFilterCount').textContent = count ? formatNumber(count) : '';
  };
  setFiltersOpen(activeFilters() > 0);
  drawFilterCount();

  body.addEventListener('change', (event) => {
    const one = event.target.closest('[data-pick]');
    if (one) {
      if (one.checked) selected.add(one.dataset.pick);
      else selected.delete(one.dataset.pick);
      drawBulk();
      const all = root.querySelector('#tkPickAll');
      if (all) all.checked = result.items.every((i) => selected.has(i.id));
      return;
    }
    if (event.target.id === 'tkPickAll') {
      for (const item of result.items) {
        if (event.target.checked) selected.add(item.id);
        else selected.delete(item.id);
      }
      for (const box of body.querySelectorAll('[data-pick]'))
        box.checked = event.target.checked;
      drawBulk();
    }
  });

  body.addEventListener('click', async (event) => {
    const pager = event.target.closest('[data-page]');
    if (!pager) return;
    state.page = Number(pager.dataset.page);
    await load();
    root.querySelector('.tk-table')?.focus();
  });

  root.querySelector('#tkBulkClear')?.addEventListener('click', () => {
    selected.clear();
    for (const box of body.querySelectorAll('[data-pick], #tkPickAll')) box.checked = false;
    drawBulk();
  });

  root.querySelector('#tkBulkGo')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const agentId = root.querySelector('#tkBulkAgent').value;
    const ids = [...selected];
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    let done = 0;
    const refused = [];
    // One request each: the server decides, per ticket (a Lead or a
    // HoldingAdmin only, D118).
    for (const id of ids) {
      try {
        await api(`/api/tickets/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          quiet: true,
          body: { assigneeId: agentId },
        });
        done += 1;
      } catch (err) {
        refused.push(err);
      }
    }
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
    selected.clear();
    showToast({
      tone: refused.length ? 'warning' : 'success',
      titleKey: 'tk.queue.bulkDone',
      text: refused.length
        ? t('tk.queue.bulkPartial', {
            done,
            failed: refused.length,
            reason: errorText(refused[0]),
          })
        : t('tk.queue.bulkAll', { count: done }),
    });
    announceChange();
    await load();
  });

  root.querySelector('#tkLog').addEventListener('click', async (event) => {
    const opener = event.currentTarget;
    const made = await openLogDialog({ ctx });
    if (made) {
      announceChange();
      await load();
    }
    opener.focus();
  });

  await load();
  return () => {
    turn += 1;
    clearTimeout(timer);
  };
}
