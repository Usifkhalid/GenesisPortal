/**
 * pages/tickets/mine.js — my tickets: what I have raised, an open / closed
 * switch and a search over the number and the subject.
 *
 *   #tickets?view=closed&q=printer
 *
 * "Open" is one request (GET /api/tickets/mine, status=active) that grows by
 * "Show more"; a ticket IT has resolved is still open here until the person
 * confirms it. "Closed" is the Closed ones, newest first; a person has far
 * fewer of these than a page's worth.
 */

import { api } from '../../api.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { recordSkeleton } from '../../components/skeleton.js';
import { formatNumber } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import { expectedBy, numberHtml, pair, priorityLabel, statusBadge } from './shared.js';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 250;

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../../router.js').Match }} ctx
 */
export function render(root, ctx) {
  const asked = ctx.route.query;
  const state = {
    view: asked.get('view') === 'closed' ? 'closed' : 'open',
    q: (asked.get('q') ?? '').slice(0, 100),
    page: 1,
  };
  let items = [];
  let total = 0;
  let turn = 0;
  let timer = null;

  root.innerHTML = `<section class="card" aria-labelledby="tkMineTitle" id="tkMine" tabindex="-1">
    <div class="card__header">
      <div class="card__titles">
        <h2 class="card__title" id="tkMineTitle">${esc(t('tk.mine.title'))}
          <span class="card__count" id="tkMineCount"></span></h2>
      </div>
      <a class="btn btn--primary btn--sm card__aside" href="#tickets/new">
        ${icon('plus', 'btn__icon')}
        <span class="btn__label">${esc(t('action.newTicket'))}</span>
      </a>
    </div>
    <div class="tk-toolbar">
      <form class="field tk-toolbar__search" role="search" id="tkMineSearch"
        aria-label="${esc(t('search.landmark.tickets'))}">
        <label class="field__label" for="tkMineQ">${esc(t('tk.mine.search'))}</label>
        <div class="input-group">
          ${icon('search', 'input-group__icon')}
          <input class="input" id="tkMineQ" name="q" type="search" autocomplete="off"
            enterkeyhint="search" maxlength="100" value="${esc(state.q)}" />
        </div>
      </form>
      <div class="segmented tk-toolbar__switch" role="group" aria-label="${esc(t('tk.mine.show'))}">
        <button type="button" class="segmented__option" data-view="open">${esc(t('tk.mine.open'))}</button>
        <button type="button" class="segmented__option" data-view="closed">${esc(t('tk.mine.closed'))}</button>
      </div>
    </div>
    <div id="tkMineBody" aria-busy="true"></div>
    <p class="u-visually-hidden" id="tkMineStatus" role="status" aria-live="polite"></p>
  </section>`;

  const body = root.querySelector('#tkMineBody');
  const count = root.querySelector('#tkMineCount');
  const status = root.querySelector('#tkMineStatus');
  const switchButtons = [...root.querySelectorAll('[data-view]')];

  function drawSwitch() {
    for (const b of switchButtons) {
      b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    }
  }

  function setAddress() {
    const params = new URLSearchParams();
    if (state.view === 'closed') params.set('view', 'closed');
    if (state.q) params.set('q', state.q);
    const query = params.toString();
    history.replaceState(null, '', `#tickets${query ? `?${query}` : ''}`);
  }

  function rowHtml(ticket) {
    const expected = expectedBy(ticket);
    return `<li class="record" data-id="${esc(ticket.id)}">
      <dl class="labelstrip labelstrip--compact">
        ${pair(t('ticket.number'), numberHtml(ticket.number))}
        ${pair(t('tk.field.category'), esc(localized(ticket.category)))}
        ${pair(t('tk.field.urgency'), esc(priorityLabel(ticket.priority)))}
        ${pair(expected.label, esc(expected.value))}
      </dl>
      <div class="record__head">
        <h3 class="record__title"><a href="#tickets/${esc(ticket.id)}"><bdi>${esc(
          ticket.subject
        )}</bdi></a></h3>
        <span class="record__aside">${statusBadge(ticket.status)}</span>
      </div>
    </li>`;
  }

  function emptyHtml() {
    const searching = Boolean(state.q);
    const key = searching ? 'search' : state.view;
    return `<div class="empty">
      ${icon(searching ? 'search' : 'tickets', 'empty__mark')}
      <div class="empty__copy">
        <p class="empty__title">${esc(t(`tk.mine.empty.${key}.title`))}</p>
        <p class="empty__text">${esc(t(`tk.mine.empty.${key}.text`))}</p>
      </div>
      ${
        state.view === 'open' && !searching
          ? `<a class="btn btn--secondary btn--sm" href="#tickets/new">
               <span class="btn__label">${esc(t('action.newTicket'))}</span></a>`
          : ''
      }
    </div>`;
  }

  function draw() {
    body.setAttribute('aria-busy', 'false');
    count.textContent = total ? `(${formatNumber(total)})` : '';
    if (items.length === 0) {
      body.innerHTML = emptyHtml();
      status.textContent = t('tk.mine.none');
      return;
    }
    body.innerHTML = `<ul class="record-list" data-density="compact"
        aria-label="${esc(t('tk.mine.title'))}">${items.map(rowHtml).join('')}</ul>
      ${
        state.view === 'open' && items.length < total
          ? `<div class="tk-more"><button type="button" class="btn btn--secondary" data-more>
               <span class="btn__label">${esc(
                 t('tk.mine.more', {
                   shown: formatNumber(items.length),
                   total: formatNumber(total),
                 })
               )}</span></button></div>`
          : ''
      }`;
    status.textContent = t('tk.mine.found', { count: total });
  }

  async function fetchPage() {
    const q = state.q ? `&q=${encodeURIComponent(state.q)}` : '';
    if (state.view === 'open') {
      const page = await api(
        `/api/tickets/mine?status=active&page=${state.page}&pageSize=${PAGE_SIZE}${q}`,
        { quiet: true }
      );
      return { list: page.items, total: page.total, append: state.page > 1 };
    }
    const closed = await api(`/api/tickets/mine?status=Closed&pageSize=50${q}`, {
      quiet: true,
    });
    return { list: closed.items, total: closed.items.length, append: false };
  }

  async function load({ keepList = false } = {}) {
    const mine = ++turn;
    body.setAttribute('aria-busy', 'true');
    if (!keepList) {
      body.innerHTML = `<p class="u-visually-hidden">${esc(t('loading.label'))}</p>${recordSkeleton(3)}`;
    }
    try {
      const result = await fetchPage();
      if (mine !== turn) return;
      items = result.append ? [...items, ...result.list] : result.list;
      total = result.total;
      draw();
    } catch {
      if (mine !== turn) return;
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = loadFailedNotice();
      body.querySelector('[data-retry]').addEventListener('click', () => load());
    }
  }

  function restart() {
    state.page = 1;
    items = [];
    setAddress();
    drawSwitch();
    load();
  }

  root.querySelector('#tkMineSearch').addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    state.q = event.target.elements.q.value.trim();
    restart();
  });
  root.querySelector('#tkMineQ').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = event.target.value.trim();
      if (q === state.q) return;
      state.q = q;
      restart();
    }, SEARCH_DELAY_MS);
  });
  root.querySelector('.tk-toolbar__switch').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button || button.dataset.view === state.view) return;
    state.view = button.dataset.view;
    restart();
  });
  body.addEventListener('click', (event) => {
    if (!event.target.closest('[data-more]')) return;
    state.page += 1;
    load({ keepList: true });
  });

  drawSwitch();
  load();

  return () => {
    turn += 1;
    clearTimeout(timer);
  };
}
