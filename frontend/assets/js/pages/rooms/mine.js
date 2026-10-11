/**
 * pages/rooms/mine.js — my bookings: what I have booked that is still to come,
 * soonest first, each with a way to cancel it.
 *
 * A series is folded into one entry (its next meeting, how it repeats and how
 * many more there are) because a daily series is a hundred rows nobody wants
 * to scroll. Cancelling it asks which is meant: only this meeting, or this one
 * and every later one.
 */

import { openModal } from '../../components/dialog.js';
import { setBusy } from '../../components/form.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { recordSkeleton } from '../../components/skeleton.js';
import { showToast } from '../../components/toast.js';
import { formatDay, formatNumber } from '../../format.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';
import {
  cancelBooking,
  errorText,
  floorLabel,
  myBookings,
  pair,
  roomName,
  weekdayList,
  whenLabel,
} from './shared.js';

/** Occurrences of one series, in time order, kept together. */
function fold(items) {
  const bySeries = new Map();
  const entries = [];
  for (const item of items) {
    if (!item.seriesId) {
      entries.push({ first: item, later: [] });
      continue;
    }
    let entry = bySeries.get(item.seriesId);
    if (!entry) {
      entry = { first: item, later: [] };
      bySeries.set(item.seriesId, entry);
      entries.push(entry);
    } else {
      entry.later.push(item);
    }
  }
  return entries;
}

/** "Repeats every working day until 30 Nov" / "Repeats on Sun, Tue until 30 Nov". */
function repeatText(booking) {
  const rule = booking.recurrence;
  if (!rule) return t('rooms.mine.repeats');
  const until = formatDay(rule.until, { weekday: 'short', year: true });
  return rule.type === 'daily'
    ? t('rooms.mine.repeatsDaily', { until })
    : t('rooms.mine.repeatsWeekly', { days: weekdayList(rule.weekdays ?? []), until });
}

/**
 * Asks which of a booking is meant. Resolves 'one', 'series' or null (kept).
 * @param {{ first: object, later: object[] }} entry
 */
async function askCancel(entry) {
  const { first, later } = entry;
  const series = Boolean(first.seriesId) && later.length > 0;
  const bodyHtml = `<p>${esc(
    `${roomName(first.room)} · ${whenLabel(first.start, first.end)}`
  )}</p>
    <p>${esc(t('rooms.mine.cancelBody'))}</p>
    ${
      series
        ? `<fieldset class="stack stack--tight">
            <legend class="field__label">${esc(t('rooms.mine.cancelWhich'))}</legend>
            <label class="choice">
              <input class="choice__control" type="radio" name="scope" value="one" checked />
              <span class="choice__text"><span class="choice__label">${esc(
                t('rooms.mine.cancelOne')
              )}</span></span>
            </label>
            <label class="choice">
              <input class="choice__control" type="radio" name="scope" value="series" />
              <span class="choice__text">
                <span class="choice__label">${esc(t('rooms.mine.cancelSeries'))}</span>
                <span class="choice__help">${esc(
                  t('rooms.mine.cancelSeriesHelp', { count: later.length + 1 })
                )}</span>
              </span>
            </label>
          </fieldset>`
        : ''
    }`;

  const { dialog, close, closed } = openModal({
    title: t('rooms.mine.cancelTitle'),
    bodyHtml,
    footerHtml: `<button type="button" class="btn btn--ghost" data-modal-close>
        <span class="btn__label">${esc(t('rooms.mine.keep'))}</span>
      </button>
      <button type="button" class="btn btn--danger" data-confirm>
        <span class="btn__label">${esc(t('rooms.mine.cancelConfirm'))}</span>
      </button>`,
  });
  dialog.querySelector('[data-confirm]').addEventListener('click', () => {
    const chosen = dialog.querySelector('[name="scope"]:checked');
    close(chosen?.value ?? 'one');
  });
  return (await closed) ?? null;
}

/**
 * @param {HTMLElement} root
 * @param {{ env: object }} ctx
 */
export function render(root, ctx) {
  const { env } = ctx;
  let items = [];
  let turn = 0;
  /** True while this view announces its own change, so it does not reload for it. */
  let announcing = false;

  root.innerHTML = `<section class="card" aria-labelledby="mineTitle" id="mineCard" tabindex="-1">
    <div class="card__header">
      <div class="card__titles">
        <span class="tag">${esc(t('rooms.mine.tag'))}</span>
        <h2 class="card__title" id="mineTitle">${esc(t('rooms.mine.title'))}
          <span class="card__count" id="mineCount"></span></h2>
      </div>
      <a class="btn btn--primary btn--sm card__aside" href="#rooms">
        ${icon('plus', 'btn__icon')}
        <span class="btn__label">${esc(t('action.bookRoom'))}</span>
      </a>
    </div>
    <div id="mineBody" aria-busy="true"></div>
    <p class="u-visually-hidden" id="mineStatus" role="status" aria-live="polite"></p>
  </section>`;

  const body = root.querySelector('#mineBody');
  const count = root.querySelector('#mineCount');
  const status = root.querySelector('#mineStatus');
  const card = root.querySelector('#mineCard');

  function rowHtml({ first, later }) {
    const now = Date.now();
    const underway =
      new Date(first.start).getTime() <= now && now < new Date(first.end).getTime();
    return `<li class="record" data-id="${esc(first.id)}">
      <dl class="labelstrip labelstrip--compact">
        ${pair(t('field.date'), esc(whenLabel(first.start, first.end)))}
        ${pair(t('room.name'), esc(roomName(first.room)))}
        ${pair(t('room.floor'), esc(floorLabel(first.room)))}
        ${
          first.attendeeCount
            ? pair(t('rooms.mine.people'), esc(formatNumber(first.attendeeCount)))
            : ''
        }
      </dl>
      <div class="record__head">
        <h3 class="record__title">${esc(first.subject || t('rooms.mine.noSubject'))}</h3>
        <span class="record__aside rooms-badges">
          ${first.seriesId ? `<span class="tag">${esc(t('rooms.mine.series'))}</span>` : ''}
          ${
            underway
              ? `<span class="badge badge--info">${icon('statusProgress', 'badge__icon')}<span>${esc(
                  t('rooms.mine.now')
                )}</span></span>`
              : ''
          }
        </span>
      </div>
      ${
        first.seriesId
          ? `<p class="record__text">${esc(repeatText(first))}${
              later.length ? ` · ${esc(t('rooms.mine.more', { count: later.length }))}` : ''
            }</p>`
          : ''
      }
      <div class="btn-row">
        ${
          first.canManage
            ? `<button type="button" class="btn btn--secondary btn--sm" data-cancel="${esc(first.id)}"
                aria-label="${esc(t('rooms.mine.cancelNamed', { subject: first.subject || roomName(first.room) }))}">
                <span class="btn__label">${esc(
                  t(later.length ? 'rooms.mine.cancelMore' : 'rooms.mine.cancel')
                )}</span>
              </button>`
            : ''
        }
        <a class="btn btn--ghost btn--sm" href="#rooms/${esc(first.room.id)}" data-room="${esc(
          first.room.id
        )}"><span class="btn__label">${esc(t('rooms.mine.roomDetails'))}</span></a>
      </div>
    </li>`;
  }

  function draw() {
    body.setAttribute('aria-busy', 'false');
    const entries = fold(items);
    count.textContent = items.length ? `(${formatNumber(entries.length)})` : '';

    if (entries.length === 0) {
      body.innerHTML = `<div class="empty empty--inline">
        ${icon('calendar', 'empty__mark')}
        <div class="empty__copy">
          <p class="empty__title">${esc(t('rooms.mine.emptyTitle'))}</p>
          <p class="empty__text">${esc(t('rooms.mine.emptyText'))}</p>
        </div>
        <a class="btn btn--secondary btn--sm" href="#rooms">
          <span class="btn__label">${esc(t('rooms.mine.emptyAction'))}</span>
        </a>
      </div>`;
      return;
    }
    body.innerHTML = `<ul class="record-list" data-density="compact"
      aria-label="${esc(t('rooms.mine.title'))}">${entries.map(rowHtml).join('')}</ul>`;
  }

  async function load() {
    const mine = ++turn;
    body.setAttribute('aria-busy', 'true');
    body.innerHTML = `<p class="u-visually-hidden">${esc(t('loading.label'))}</p>${recordSkeleton(3)}`;
    try {
      const result = await myBookings();
      if (mine !== turn) return;
      items = result.items;
      draw();
    } catch {
      if (mine !== turn) return;
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = loadFailedNotice();
      body.querySelector('[data-retry]').addEventListener('click', load);
    }
  }

  body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-cancel]');
    if (!button) return;

    const entry = fold(items).find((e) => e.first.id === button.dataset.cancel);
    if (!entry) return;
    const scope = await askCancel(entry);
    if (!scope) {
      button.focus();
      return;
    }

    setBusy(button, true);
    try {
      await cancelBooking(entry.first.id, scope);
    } catch (err) {
      setBusy(button, false);
      showToast({ tone: 'danger', titleKey: 'rooms.mine.cancelFailed', text: errorText(err) });
      // Gone or over since the list was read: the list is what is wrong.
      if (
        ['booking_gone', 'booking_finished', 'booking_cancelled', 'not_found'].includes(
          err.code
        )
      ) {
        load();
      }
      return;
    }

    const gone = new Set([entry.first.id]);
    if (scope === 'series') for (const later of entry.later) gone.add(later.id);
    items = items.filter((item) => !gone.has(item.id));
    draw();
    status.textContent = t('rooms.mine.cancelled');
    showToast({
      tone: 'success',
      titleKey: 'rooms.mine.cancelled',
      text: t(gone.size > 1 ? 'rooms.mine.cancelledMany' : 'rooms.mine.cancelledOne', {
        count: gone.size,
      }),
    });
    announcing = true;
    env.notifyChanged();
    announcing = false;
    // The button that was pressed is gone: keep the keyboard on the list.
    (body.querySelector('[data-cancel]') ?? card).focus();
  });

  const stopListening = env.onChanged(() => {
    if (!announcing) load();
  });
  load();

  return () => {
    turn += 1;
    stopListening();
  };
}
