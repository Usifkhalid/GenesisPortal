/**
 * pages/rooms/day.js — one day of every room.
 *
 *   #rooms/day                      today
 *   #rooms/day?date=2026-10-25&room=<id>
 *
 * On a desktop it is a timetable: a row per room, working hours as columns.
 * The time axis runs along the inline direction, so in Arabic the morning is
 * on the right and the day reads towards the left, with no second layout.
 * On a phone it is a plain list: each room and the stretches of the day that
 * are still free, each one a button.
 *
 * Both are drawn from the same data and sit in the page together; the page's
 * container width decides which one is shown, so the phone never pays for a
 * grid it cannot use and the desktop never shows a list it has outgrown.
 */

import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { cairoMinutes, cairoYmd, clockOf, addDays, formatDay } from '../../format.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';
import { openBookingDialog } from './booking.js';
import {
  SLOT,
  durationLabel,
  floorLabel,
  isWorkingDay,
  nextWorkingDay,
  roomName,
  seatsLabel,
  weekdayList,
} from './shared.js';
import { api } from '../../api.js';

const DAY = 1440;

/** The minute of Cairo's day `ymd` that an instant falls on, clamped to the day. */
function minuteOn(ymd, instant) {
  const day = cairoYmd(instant);
  if (day < ymd) return 0;
  if (day > ymd) return DAY;
  return cairoMinutes(instant);
}

/** Overlapping or touching intervals folded into the fewest. */
function merge(intervals) {
  const sorted = [...intervals].sort((a, b) => a.from - b.from);
  const out = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && item.from <= last.to) last.to = Math.max(last.to, item.to);
    else out.push({ from: item.from, to: item.to });
  }
  return out;
}

/** The parts of [lo, hi) that no busy interval covers, at least one slot long. */
function freeParts(busy, lo, hi) {
  const out = [];
  let at = lo;
  for (const b of merge(busy)) {
    if (b.to <= at) continue;
    if (b.from > at) out.push({ from: at, to: Math.min(b.from, hi) });
    at = Math.max(at, b.to);
    if (at >= hi) break;
  }
  if (at < hi) out.push({ from: at, to: hi });
  return out.filter((part) => part.to - part.from >= SLOT);
}

/** An hour mark every hour, or every second or third when the day is long. */
function ticksFor(hours) {
  const span = hours.workdayEndMin - hours.workdayStartMin;
  const every = span > 14 * 60 ? 180 : span > 10 * 60 ? 120 : 60;
  const out = [];
  for (
    let at = Math.ceil(hours.workdayStartMin / every) * every;
    at <= hours.workdayEndMin;
    at += every
  ) {
    out.push(at);
  }
  return out;
}

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../../router.js').Match, env: object }} ctx
 */
export function render(root, ctx) {
  const { env, route } = ctx;
  const { rooms } = env;
  const today = cairoYmd(new Date());

  if (rooms.length === 0) {
    root.innerHTML = `<section class="card"><div class="empty empty--inline">
      ${icon('rooms', 'empty__mark')}
      <div class="empty__copy">
        <p class="empty__title">${esc(t('rooms.none.title'))}</p>
        <p class="empty__text">${esc(t('rooms.none.text'))}</p>
      </div></div></section>`;
    return undefined;
  }

  const state = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(route.query.get('date') ?? '')
      ? route.query.get('date')
      : today,
    room: rooms.some((r) => r.id === route.query.get('room')) ? route.query.get('room') : '',
  };
  let turn = 0;
  let loaded = null;

  root.innerHTML = `<div class="stack">
    <form class="card day-controls" id="dayForm" aria-label="${esc(t('rooms.day.controls'))}">
      <div class="day-controls__date">
        <button type="button" class="btn btn--secondary btn--icon" data-step="-1"
          aria-label="${esc(t('rooms.day.previous'))}">${icon('chevronStart', 'btn__icon icon--dir')}</button>
        <div class="field day-controls__field">
          <label class="field__label" for="dayDate">${esc(t('field.date'))}</label>
          <input class="input" id="dayDate" type="date" value="${esc(state.date)}" required />
        </div>
        <button type="button" class="btn btn--secondary btn--icon" data-step="1"
          aria-label="${esc(t('rooms.day.next'))}">${icon('chevronEnd', 'btn__icon icon--dir')}</button>
        <button type="button" class="btn btn--ghost" data-today>
          <span class="btn__label">${esc(t('rooms.day.today'))}</span>
        </button>
      </div>
      <div class="field day-controls__room">
        <label class="field__label" for="dayRoom">${esc(t('rooms.book.room'))}</label>
        <select class="select" id="dayRoom">
          <option value="">${esc(t('rooms.day.allRooms'))}</option>
          ${rooms
            .map(
              (room) =>
                `<option value="${esc(room.id)}" ${room.id === state.room ? 'selected' : ''}>${esc(
                  roomName(room)
                )}</option>`
            )
            .join('')}
        </select>
      </div>
    </form>

    <section class="day" aria-labelledby="dayTitle" tabindex="-1" id="dayCard">
      <h2 class="day__title" id="dayTitle"></h2>
      <p class="day__summary" id="daySummary" role="status" aria-live="polite"></p>
      <div id="dayBody" aria-busy="true"></div>
    </section>
  </div>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const dateInput = $('dayDate');
  const roomSelect = $('dayRoom');
  const body = $('dayBody');
  const summary = $('daySummary');

  function setAddress() {
    const params = new URLSearchParams({ date: state.date });
    if (state.room) params.set('room', state.room);
    history.replaceState(null, '', `#rooms/day?${params}`);
  }

  /* --------------------------------------------------------------- drawing */

  function skeleton() {
    const row = `<li class="day-skeleton__row">
      <span class="skeleton skeleton--text skeleton--line-short"></span>
      <span class="skeleton day-skeleton__track"></span>
    </li>`;
    return `<p class="u-visually-hidden">${esc(t('loading.label'))}</p>
      <ul class="day-skeleton card" aria-hidden="true">${row.repeat(Math.min(rooms.length, 6))}</ul>`;
  }

  function closedDay(hours) {
    const next = nextWorkingDay(hours, state.date);
    body.innerHTML = `<div class="card"><div class="empty empty--inline" role="status">
      ${icon('calendar', 'empty__mark')}
      <div class="empty__copy">
        <p class="empty__title">${esc(
          t('rooms.day.closedTitle', { day: formatDay(state.date) })
        )}</p>
        <p class="empty__text">${esc(
          t('rooms.day.closedText', { days: weekdayList(hours.workingDays) })
        )}</p>
      </div>
      <button type="button" class="btn btn--secondary btn--sm" data-goto="${esc(next)}">
        <span class="btn__label">${esc(
          t('rooms.day.goto', { day: formatDay(next, { weekday: 'short' }) })
        )}</span>
      </button></div></div>`;
  }

  /** Each room's busy and free minutes for the day shown. */
  function model(data) {
    const { hours } = data;
    const nowMin = state.date === today ? cairoMinutes(new Date()) : null;
    const earliest =
      nowMin === null
        ? hours.workdayStartMin
        : Math.max(hours.workdayStartMin, Math.ceil((nowMin + 1) / SLOT) * SLOT);

    return data.rooms.map(({ room, busy }) => {
      const blocks = busy
        .map((item) => ({
          from: minuteOn(state.date, item.start),
          to: minuteOn(state.date, item.end),
          item,
        }))
        .filter((b) => b.to > b.from);
      return {
        room,
        blocks,
        free: freeParts(blocks, earliest, hours.workdayEndMin),
      };
    });
  }

  const pct = (minute, hours) =>
    ((minute - hours.workdayStartMin) / (hours.workdayEndMin - hours.workdayStartMin)) * 100;

  function freeLabel(room, part) {
    return t('rooms.day.freeNamed', {
      name: roomName(room),
      from: clockOf(part.from),
      to: clockOf(part.to),
    });
  }

  function busyText(item) {
    if (item.mine)
      return item.subject ? `${t('rooms.day.yours')} · ${item.subject}` : t('rooms.day.yours');
    return item.subject || t('rooms.day.booked');
  }

  function timelineHtml(rows, hours) {
    const ticks = ticksFor(hours);
    const nowMin = state.date === today ? cairoMinutes(new Date()) : null;
    const showNow =
      nowMin !== null && nowMin > hours.workdayStartMin && nowMin < hours.workdayEndMin;
    const past =
      nowMin !== null && nowMin > hours.workdayStartMin
        ? `<span class="day-past" style="--size:${Math.min(100, pct(nowMin, hours))}%"></span>`
        : '';
    const now = showNow
      ? `<span class="day-now" style="--at:${pct(nowMin, hours)}%" aria-hidden="true"></span>`
      : '';
    const gridLines = ticks
      .map(
        (at) =>
          `<span class="day-tick" style="--at:${pct(at, hours)}%" aria-hidden="true"></span>`
      )
      .join('');

    return `<div class="card day-timeline" data-density="compact">
      <div class="day-timeline__head" aria-hidden="true">
        <span class="u-microlabel">${esc(t('room.name'))}</span>
        <div class="day-axis">${ticks
          .map(
            (at) =>
              `<span class="day-axis__label" style="--at:${pct(at, hours)}%">${clockOf(at)}</span>`
          )
          .join('')}</div>
      </div>
      <ul class="day-rows">${rows
        .map(({ room, blocks, free }) => {
          const blocksHtml = blocks
            .map(({ from, to, item }) => {
              const lo = Math.max(from, hours.workdayStartMin);
              const hi = Math.min(to, hours.workdayEndMin);
              if (hi <= lo) return '';
              const text = busyText(item);
              return `<span class="day-busy${item.mine ? ' day-busy--mine' : ''}"
                title="${esc(text)}"
                style="--at:${pct(lo, hours)}%;--size:${pct(hi, hours) - pct(lo, hours)}%">
                <span class="day-busy__text" aria-hidden="true">${esc(text)}</span>
                <span class="u-visually-hidden">${esc(
                  `${clockOf(from)}–${clockOf(to)}: ${text}`
                )}</span>
              </span>`;
            })
            .join('');
          const freeHtml = free
            .map(
              (part) => `<button type="button" class="day-free" data-free
                data-room="${esc(room.id)}" data-from="${part.from}" data-to="${part.to}"
                data-pointer style="--at:${pct(part.from, hours)}%;--size:${
                  pct(part.to, hours) - pct(part.from, hours)
                }%" aria-label="${esc(freeLabel(room, part))}">
                ${icon('plus', 'day-free__icon')}
                <span class="day-free__text" aria-hidden="true">${clockOf(part.from)}–${clockOf(part.to)}</span>
              </button>`
            )
            .join('');
          return `<li class="day-row">
            <div class="day-row__room">
              <a class="day-row__name" href="#rooms/${esc(room.id)}" data-room="${esc(room.id)}">${esc(
                roomName(room)
              )}</a>
              <span class="day-row__meta">${esc(seatsLabel(room))} · ${esc(floorLabel(room))}</span>
            </div>
            <div class="day-track" role="group" aria-label="${esc(
              `${roomName(room)}, ${formatDay(state.date, { weekday: 'short' })}`
            )}">
              ${gridLines}${past}${blocksHtml}${freeHtml}${now}
            </div>
          </li>`;
        })
        .join('')}</ul>
    </div>`;
  }

  function listHtml(rows) {
    return `<ul class="day-list">${rows
      .map(({ room, blocks, free }) => {
        const slots = free.length
          ? `<ul class="day-slots">${free
              .map(
                (part) => `<li><button type="button" class="day-slot" data-free
                  data-room="${esc(room.id)}" data-from="${part.from}" data-to="${part.to}"
                  aria-label="${esc(freeLabel(room, part))}">
                  <span class="day-slot__time">${clockOf(part.from)}–${clockOf(part.to)}</span>
                  <span class="day-slot__length">${esc(durationLabel(part.to - part.from))}</span>
                  ${icon('plus', 'day-slot__icon')}
                </button></li>`
              )
              .join('')}</ul>`
          : `<p class="day-slots__none">${esc(
              t(blocks.length ? 'rooms.day.noneFree' : 'rooms.day.noneLeft')
            )}</p>`;
        return `<li class="card day-list__room">
          <div class="card__header">
            <div class="card__titles">
              <h3 class="card__title"><a href="#rooms/${esc(room.id)}" data-room="${esc(
                room.id
              )}">${esc(roomName(room))}</a></h3>
              <p class="day-row__meta">${esc(seatsLabel(room))} · ${esc(floorLabel(room))}</p>
            </div>
          </div>
          ${slots}
        </li>`;
      })
      .join('')}</ul>`;
  }

  function showData(data) {
    loaded = data;
    body.setAttribute('aria-busy', 'false');
    const rows = model(data);
    const withFree = rows.filter((r) => r.free.length > 0).length;
    summary.textContent = t('rooms.day.summary', { count: withFree, total: rows.length });
    body.innerHTML = `${timelineHtml(rows, data.hours)}${listHtml(rows)}`;
  }

  function showFailed() {
    body.setAttribute('aria-busy', 'false');
    summary.textContent = '';
    body.innerHTML = loadFailedNotice();
    body.querySelector('[data-retry]').addEventListener('click', () => load());
  }

  async function load({ quiet = false } = {}) {
    const mine = ++turn;
    $('dayTitle').textContent = formatDay(state.date, { weekday: 'long', year: true });
    setAddress();

    if (!isWorkingDay(env.hours, state.date)) {
      body.setAttribute('aria-busy', 'false');
      summary.textContent = '';
      closedDay(env.hours);
      return;
    }

    body.setAttribute('aria-busy', 'true');
    if (!quiet || !loaded) body.innerHTML = skeleton();
    const params = new URLSearchParams({ date: state.date, view: 'day' });
    if (state.room) params.set('roomId', state.room);
    try {
      const data = await api(`/api/rooms/availability?${params}`, { quiet: true });
      if (mine === turn) showData(data);
    } catch {
      if (mine === turn) showFailed();
    }
  }

  /* ---------------------------------------------------------------- events */

  function go(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    state.date = ymd;
    dateInput.value = ymd;
    load();
  }

  root.addEventListener('click', (event) => {
    const step = event.target.closest('[data-step]');
    if (step) {
      go(addDays(state.date, Number(step.dataset.step)));
      return;
    }
    if (event.target.closest('[data-today]')) {
      go(today);
      return;
    }
    const jump = event.target.closest('[data-goto]');
    if (jump) go(jump.dataset.goto);
  });
  dateInput.addEventListener('change', () => go(dateInput.value));
  roomSelect.addEventListener('change', () => {
    state.room = roomSelect.value;
    load();
  });

  body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-free]');
    if (!button || !loaded) return;
    const from = Number(button.dataset.from);
    const to = Number(button.dataset.to);

    // A press inside a long free stretch starts where it landed, on the half hour.
    let start = from;
    if (button.dataset.pointer !== undefined && event.detail > 0 && event.clientX > 0) {
      const box = button.getBoundingClientRect();
      const rtl = document.documentElement.dir === 'rtl';
      const along = rtl ? box.right - event.clientX : event.clientX - box.left;
      const wanted = from + Math.max(0, Math.min(1, along / box.width)) * (to - from);
      start = Math.min(to - SLOT, Math.max(from, Math.floor(wanted / 30) * 30));
    }
    const duration = Math.max(SLOT, Math.min(60, Math.floor((to - start) / SLOT) * SLOT));

    const items = await openBookingDialog(
      { rooms, hours: loaded.hours },
      { roomId: button.dataset.room, date: state.date, start, duration },
      (slot) => {
        const params = new URLSearchParams({
          date: slot.date,
          start: clockOf(slot.start),
          duration: String(slot.duration),
          people: String(slot.people),
        });
        location.hash = `#rooms?${params}`;
      }
    );
    // Everything listening, this view included, redraws on the change.
    if (items) env.notifyChanged();
  });

  const stopListening = env.onChanged(() => load({ quiet: true }));
  load();

  return () => {
    turn += 1;
    stopListening();
  };
}
