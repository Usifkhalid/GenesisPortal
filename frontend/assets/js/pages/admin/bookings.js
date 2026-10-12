/**
 * pages/admin/bookings.js — every booking of the companies this person
 * administers, subjects included: by room, company, dates and status.
 *
 *   #admin/bookings?room=&company=&from=&to=&status=&page=
 *
 * An administrator can cancel someone else's meeting, and has to say why: the
 * reason is kept on the booking and in the audit log, for the organiser to be
 * told. A series asks whether only this meeting is meant, or it and every
 * later one.
 */

import { ApiError, api } from '../../api.js';
import { openModal } from '../../components/dialog.js';
import { describedBy, field, setBusy, setFieldError } from '../../components/form.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { showToast } from '../../components/toast.js';
import {
  addDays,
  cairoToday,
  cairoYmd,
  formatDay,
  formatNumber,
  formatTimeRange,
} from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import { personName, toastKeys } from './shared.js';

const PAGE_SIZE = 25;
const REASON_MAX = 500;
const STATUSES = ['confirmed', 'cancelled', 'all'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const when = (b) =>
  `${formatDay(cairoYmd(b.start), { weekday: 'short', year: true })}, ${formatTimeRange(
    b.start,
    b.end
  )}`;

/**
 * Asks why, and for a series which meetings. Resolves { scope, reason } or null.
 * @param {object} booking
 */
async function askCancel(booking) {
  const bodyHtml = `<form id="abkForm" class="stack" novalidate>
    <p>${esc(`${booking.subject ?? ''} · ${localized(booking.room)} · ${when(booking)}`)}</p>
    ${field({
      id: 'abkReason',
      label: t('admin.bookings.reason'),
      required: !booking.mine,
      help: t('admin.bookings.reasonHelp'),
      control: `<textarea class="textarea" id="abkReason" name="reason" rows="3"
        maxlength="${REASON_MAX}" aria-describedby="${describedBy('abkReason')}"></textarea>`,
    })}
    ${
      booking.recurring
        ? `<fieldset class="stack stack--tight admin-fieldset--plain">
            <legend class="field__label">${esc(t('rooms.mine.cancelWhich'))}</legend>
            <label class="choice">
              <input class="choice__control" type="radio" name="scope" value="one" checked />
              <span class="choice__text"><span class="choice__label">${esc(
                t('rooms.mine.cancelOne')
              )}</span></span>
            </label>
            <label class="choice">
              <input class="choice__control" type="radio" name="scope" value="series" />
              <span class="choice__text"><span class="choice__label">${esc(
                t('rooms.mine.cancelSeries')
              )}</span></span>
            </label>
          </fieldset>`
        : ''
    }
  </form>`;

  const { dialog, close, closed } = openModal({
    title: t('rooms.mine.cancelTitle'),
    bodyHtml,
    footerHtml: `<button type="button" class="btn btn--ghost" data-modal-close>
        <span class="btn__label">${esc(t('rooms.mine.keep'))}</span>
      </button>
      <button type="submit" class="btn btn--danger" form="abkForm">
        <span class="btn__label">${esc(t('rooms.mine.cancelConfirm'))}</span>
      </button>`,
  });
  const form = dialog.querySelector('#abkForm');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const reason = form.elements.reason.value.trim();
    if (!reason && !booking.mine) {
      setFieldError(form, 'abkReason', t('admin.bookings.reasonRequired'));
      form.elements.reason.focus();
      return;
    }
    close({ scope: form.elements.scope?.value ?? 'one', reason });
  });
  form.elements.reason.addEventListener('input', () => setFieldError(form, 'abkReason', ''));
  form.elements.reason.focus();
  return (await closed) ?? null;
}

/**
 * @param {HTMLElement} root
 * @param {{ scope: object, ctx: object }} context
 */
export async function render(root, { scope, ctx }) {
  const asked = ctx.route.query;
  const companies = scope.companies;
  const today = cairoToday();
  const state = {
    room: asked.get('room') ?? '',
    company: companies.some((c) => c.id === asked.get('company')) ? asked.get('company') : '',
    from: DAY.test(asked.get('from') ?? '') ? asked.get('from') : today,
    to: DAY.test(asked.get('to') ?? '') ? asked.get('to') : addDays(today, 30),
    status: STATUSES.includes(asked.get('status')) ? asked.get('status') : 'confirmed',
    page: Math.max(1, Math.trunc(Number(asked.get('page'))) || 1),
  };
  let turn = 0;
  let result = { items: [], total: 0 };

  let rooms;
  try {
    rooms = (await api('/api/rooms', { quiet: true })).items;
  } catch {
    root.innerHTML = loadFailedNotice();
    root
      .querySelector('[data-retry]')
      .addEventListener('click', () => render(root, { scope, ctx }));
    return undefined;
  }
  if (!rooms.some((r) => r.id === state.room)) state.room = '';

  const option = (value, text, chosen) =>
    `<option value="${esc(value)}" ${value === chosen ? 'selected' : ''}>${esc(text)}</option>`;

  root.innerHTML = `
    <p class="admin-lead">${esc(t('admin.bookings.lead'))}</p>
    <form class="card admin-filters" id="abFilters" aria-label="${esc(t('admin.bookings.filters'))}">
      <div class="field">
        <label class="field__label" for="abRoom">${esc(t('room.name'))}</label>
        <select class="select" id="abRoom" name="room">
          ${option('', t('rooms.day.allRooms'), state.room)}
          ${rooms.map((r) => option(r.id, localized(r), state.room)).join('')}
        </select>
      </div>
      ${
        companies.length > 1
          ? `<div class="field">
               <label class="field__label" for="abCompany">${esc(t('ticket.company'))}</label>
               <select class="select" id="abCompany" name="company">
                 ${option('', t('admin.bookings.allCompanies'), state.company)}
                 ${companies
                   .map((c) => option(c.id, `${c.code} · ${localized(c)}`, state.company))
                   .join('')}
               </select>
             </div>`
          : ''
      }
      <div class="field">
        <label class="field__label" for="abFrom">${esc(t('admin.bookings.from'))}</label>
        <input class="input" id="abFrom" name="from" type="date" value="${esc(state.from)}" />
      </div>
      <div class="field">
        <label class="field__label" for="abTo">${esc(t('admin.bookings.to'))}</label>
        <input class="input" id="abTo" name="to" type="date" value="${esc(state.to)}" />
      </div>
      <div class="field">
        <label class="field__label" for="abStatus">${esc(t('status.label'))}</label>
        <select class="select" id="abStatus" name="status">
          ${STATUSES.map((s) => option(s, t(`admin.bookings.status.${s}`), state.status)).join('')}
        </select>
      </div>
    </form>
    <p class="admin-lead" id="abCount" role="status" aria-live="polite"></p>
    <div id="abBody" aria-busy="true"></div>`;

  const form = root.querySelector('#abFilters');
  const body = root.querySelector('#abBody');
  const count = root.querySelector('#abCount');
  const codeOf = (companyId) => companies.find((c) => c.id === companyId)?.code ?? '';

  function setAddress() {
    const params = new URLSearchParams();
    if (state.room) params.set('room', state.room);
    if (state.company) params.set('company', state.company);
    params.set('from', state.from);
    params.set('to', state.to);
    if (state.status !== 'confirmed') params.set('status', state.status);
    if (state.page > 1) params.set('page', String(state.page));
    history.replaceState(null, '', `#admin/bookings?${params}`);
  }

  function rowHtml(b) {
    const cancelled = b.status === 'cancelled';
    return `<tr role="row" ${cancelled ? 'class="table__muted"' : ''} data-id="${esc(b.id)}">
      <td role="cell" data-label="${esc(t('home.rooms.when'))}">${esc(when(b))}</td>
      <td role="cell" data-label="${esc(t('room.name'))}">${esc(localized(b.room))}</td>
      <td role="cell" data-label="${esc(t('rooms.book.subject'))}">
        <span class="admin-subject">${esc(b.subject ?? t('audit.emptyValue'))}</span>
        ${b.recurring ? `<span class="tag">${esc(t('rooms.mine.series'))}</span>` : ''}
      </td>
      <td role="cell" data-label="${esc(t('admin.bookings.organiser'))}">${esc(
        b.organiser ? personName(b.organiser) : t('audit.emptyValue')
      )} <span class="admin-code">${esc(codeOf(b.companyId))}</span></td>
      <td role="cell" data-label="${esc(t('status.label'))}">
        ${
          cancelled
            ? `<span class="badge">${icon('x', 'badge__icon')}<span>${esc(
                t('admin.bookings.status.cancelled')
              )}</span></span>
               ${b.cancelReason ? `<p class="admin-reason">${esc(b.cancelReason)}</p>` : ''}`
            : `<span class="badge badge--success">${icon('statusResolved', 'badge__icon')}<span>${esc(
                t('admin.bookings.status.confirmed')
              )}</span></span>`
        }
      </td>
      <td role="cell" class="admin-actions">
        ${
          b.canManage
            ? `<button type="button" class="btn btn--secondary btn--sm" data-cancel="${esc(b.id)}"
                 aria-label="${esc(t('rooms.mine.cancelNamed', { subject: b.subject ?? '' }))}">
                 <span class="btn__label">${esc(t('rooms.mine.cancel'))}</span>
               </button>`
            : ''
        }
      </td>
    </tr>`;
  }

  function draw() {
    body.setAttribute('aria-busy', 'false');
    const { items, total } = result;
    count.textContent = t('admin.bookings.count', { count: formatNumber(total) });
    if (items.length === 0) {
      body.innerHTML = `<div class="empty empty--inline">
        ${icon('calendar', 'empty__mark')}
        <div class="empty__copy">
          <p class="empty__title">${esc(t('admin.bookings.emptyTitle'))}</p>
          <p class="empty__text">${esc(t('admin.bookings.emptyText'))}</p>
        </div></div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    body.innerHTML = `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
        aria-label="${esc(t('admin.bookings.caption'))}">
        <table class="table" role="table">
          <caption class="u-visually-hidden">${esc(t('admin.bookings.caption'))}</caption>
          <thead role="rowgroup"><tr role="row">
            <th role="columnheader" scope="col">${esc(t('home.rooms.when'))}</th>
            <th role="columnheader" scope="col">${esc(t('room.name'))}</th>
            <th role="columnheader" scope="col">${esc(t('rooms.book.subject'))}</th>
            <th role="columnheader" scope="col">${esc(t('admin.bookings.organiser'))}</th>
            <th role="columnheader" scope="col">${esc(t('status.label'))}</th>
            <th role="columnheader" scope="col"><span class="u-visually-hidden">${esc(
              t('admin.field.actions')
            )}</span></th>
          </tr></thead>
          <tbody role="rowgroup">${items.map(rowHtml).join('')}</tbody>
        </table>
      </div>
      ${
        pages > 1
          ? `<nav class="pagination" aria-label="${esc(t('admin.bookings.pages'))}">
              <button type="button" class="btn btn--secondary btn--sm" data-page="${state.page - 1}"
                ${state.page <= 1 ? 'disabled' : ''}>
                <span class="btn__label">${esc(t('pagination.previous'))}</span></button>
              <p class="pagination__status">${esc(
                t('admin.bookings.pageOf', { page: state.page, pages })
              )}</p>
              <button type="button" class="btn btn--secondary btn--sm" data-page="${state.page + 1}"
                ${state.page >= pages ? 'disabled' : ''}>
                <span class="btn__label">${esc(t('pagination.next'))}</span></button>
            </nav>`
          : ''
      }`;
  }

  async function load() {
    const mine = ++turn;
    setAddress();
    body.setAttribute('aria-busy', 'true');
    const params = new URLSearchParams({
      from: state.from,
      to: state.to,
      status: state.status,
      page: String(state.page),
      pageSize: String(PAGE_SIZE),
    });
    if (state.room) params.set('roomId', state.room);
    if (state.company) params.set('companyId', state.company);
    try {
      const next = await api(`/api/admin/bookings?${params}`, { quiet: true });
      if (mine !== turn) return;
      result = next;
      draw();
    } catch {
      if (mine !== turn) return;
      body.setAttribute('aria-busy', 'false');
      count.textContent = '';
      body.innerHTML = loadFailedNotice();
      body.querySelector('[data-retry]').addEventListener('click', load);
    }
  }

  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', () => {
    const from = form.elements.from.value;
    const to = form.elements.to.value;
    if (!DAY.test(from) || !DAY.test(to)) return;
    state.room = form.elements.room.value;
    state.company = form.elements.company?.value ?? '';
    state.from = from;
    // A range that ends before it starts is read as one day.
    state.to = to < from ? from : to;
    form.elements.to.value = state.to;
    state.status = form.elements.status.value;
    state.page = 1;
    load();
  });

  body.addEventListener('click', async (event) => {
    const pager = event.target.closest('[data-page]');
    if (pager) {
      state.page = Number(pager.dataset.page);
      await load();
      root.querySelector('.table-wrap')?.focus();
      return;
    }

    const button = event.target.closest('[data-cancel]');
    if (!button) return;
    const booking = result.items.find((b) => b.id === button.dataset.cancel);
    const answer = await askCancel(booking);
    if (!answer) {
      button.focus();
      return;
    }
    setBusy(button, true);
    try {
      const { cancelled } = await api(
        `/api/bookings/${encodeURIComponent(booking.id)}/cancel`,
        {
          method: 'POST',
          quiet: true,
          body: { scope: answer.scope, ...(answer.reason ? { reason: answer.reason } : {}) },
        }
      );
      showToast({
        tone: 'success',
        titleKey: 'rooms.mine.cancelled',
        text: t(cancelled.length > 1 ? 'rooms.mine.cancelledMany' : 'rooms.mine.cancelledOne', {
          count: cancelled.length,
        }),
      });
      await load();
      (body.querySelector('[data-cancel]') ?? root.querySelector('#abStatus')).focus();
    } catch (err) {
      setBusy(button, false);
      if (err instanceof ApiError && err.code === 'reason_required') {
        showToast({
          tone: 'danger',
          titleKey: 'rooms.mine.cancelFailed',
          textKey: 'admin.bookings.reasonRequired',
        });
      } else {
        showToast({ tone: 'danger', ...toastKeys(err) });
      }
      load();
    }
  });

  await load();
  return () => {
    turn += 1;
  };
}
