/**
 * pages/rooms/day.js — one day of every room.
 *
 *   #rooms/day                      today
 *   #rooms/day?date=2026-10-25&room=<id>
 *
 * On a desktop it is a timetable: a row per room, working hours as columns,
 * a label every hour and a lighter line every quarter, so a block's edges sit
 * on the grid. The time axis runs along the inline direction, so in Arabic
 * the morning is on the right and the day reads towards the left, with no
 * second layout. On a phone it is a plain list: each room, the stretches of
 * the day that are still free, and what is booked.
 *
 * Every booking says its exact time in words, never only by where it sits:
 * the range comes first in the block ("10:30–10:45", start on the left in
 * Arabic as in English), a block too narrow for a line of text turns the
 * range on its side, and hover, keyboard focus or a
 * tap opens a small panel with the range, the length, who booked it (or the
 * subject of your own) and the room. A free stretch says the quarter hour
 * under the pointer before it is booked.
 *
 * Both layouts are drawn from the same data and sit in the page together; the
 * page's container width decides which one is shown.
 */

import { api } from '../../api.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { namesOf } from '../../components/person.js';
import {
  addDays,
  cairoMinutes,
  cairoYmd,
  clockOf,
  formatDay,
  rangeHtml,
  rangeOf,
} from '../../format.js';
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

const DAY = 1440;
const HOUR = 60;
/** How far the panel stands off the thing it describes, in px. */
const POP_GAP = 6;

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

/**
 * The grid: a line every quarter hour, marked where it is a whole hour, and
 * the hours that get a label (every hour; every second one on a very long day).
 */
function gridFor(hours) {
  const lines = [];
  for (
    let at = Math.ceil(hours.workdayStartMin / SLOT) * SLOT;
    at <= hours.workdayEndMin;
    at += SLOT
  ) {
    lines.push({ at, hour: at % HOUR === 0 });
  }
  const span = hours.workdayEndMin - hours.workdayStartMin;
  const every = span > 14 * HOUR ? 2 * HOUR : HOUR;
  return {
    lines,
    labels: lines.filter((line) => line.at % every === 0).map((line) => line.at),
  };
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
  /** What each block's panel says, by the key in its data-pop. */
  let details = new Map();

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
      <div class="day-pop" id="dayPop" role="tooltip" hidden></div>
    </section>
  </div>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const dateInput = $('dayDate');
  const roomSelect = $('dayRoom');
  const section = $('dayCard');
  const body = $('dayBody');
  const summary = $('daySummary');
  const pop = $('dayPop');

  function setAddress() {
    const params = new URLSearchParams({ date: state.date });
    if (state.room) params.set('room', state.room);
    history.replaceState(null, '', `#rooms/day?${params}`);
  }

  /* ------------------------------------------------------------- the panel */

  /** The control the panel is open for, and whether a tap is holding it open. */
  let popFor = null;
  let pinned = false;

  function hidePop() {
    popFor?.removeAttribute('aria-describedby');
    popFor = null;
    pinned = false;
    pop.hidden = true;
  }

  /**
   * Puts the panel under its control (above when there is no room below),
   * centred on `clientX` or on the control, and kept inside the section.
   * Offsets are measured from the inline-start edge, so Arabic needs no case.
   */
  function placePop(target, clientX) {
    const frame = section.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const size = pop.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    const centre = clientX ?? box.left + box.width / 2;
    const fromStart = rtl ? frame.right - centre : centre - frame.left;
    const inline = Math.max(0, Math.min(frame.width - size.width, fromStart - size.width / 2));
    const below = box.bottom + POP_GAP + size.height <= window.innerHeight;
    const block = below
      ? box.bottom - frame.top + POP_GAP
      : box.top - frame.top - size.height - POP_GAP;
    pop.style.insetInlineStart = `${Math.round(inline)}px`;
    pop.style.insetBlockStart = `${Math.round(block)}px`;
  }

  function showPop(target, html, clientX) {
    if (popFor !== target) {
      popFor?.removeAttribute('aria-describedby');
      popFor = target;
      target.setAttribute('aria-describedby', 'dayPop');
    }
    pop.innerHTML = html;
    pop.hidden = false;
    placePop(target, clientX);
  }

  const popRow = (key, value) =>
    `<div class="day-pop__row"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`;

  /** A booking's panel: the range, then its length, who or what, and the room. */
  function bookingPop({ room, from, to, item }) {
    const organiser = item.organiser ? namesOf(item.organiser).primary.text : '';
    return `<p class="day-pop__time">${rangeHtml(from, to)}</p>
      <p class="day-pop__status">${esc(t(item.mine ? 'rooms.day.yours' : 'rooms.day.busy'))}</p>
      <dl class="day-pop__list">
        ${popRow(t('rooms.day.pop.length'), durationLabel(to - from))}
        ${item.subject ? popRow(t('rooms.book.subject'), item.subject) : ''}
        ${organiser && !item.mine ? popRow(t('rooms.day.pop.organiser'), organiser) : ''}
        ${popRow(t('room.name'), roomName(room))}
      </dl>`;
  }

  /** A free stretch's panel: the quarter hour a press would start at, or all of it. */
  function freePop(button, clientX) {
    const from = Number(button.dataset.from);
    const to = Number(button.dataset.to);
    const start = clientX === undefined ? null : startUnder(button, clientX);
    const shown = start === null ? { from, to } : { from: start, to: start + SLOT };
    return `<p class="day-pop__time">${esc(
      t('rooms.day.freeAt', { range: rangeOf(shown.from, shown.to) })
    )}</p>
      <p class="day-pop__hint">${esc(
        t('rooms.day.freeHint', { from: clockOf(shown.from), to: clockOf(to) })
      )}</p>`;
  }

  /** The quarter hour of a free stretch that sits under a pointer. */
  function startUnder(button, clientX) {
    const from = Number(button.dataset.from);
    const to = Number(button.dataset.to);
    const box = button.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    const along = rtl ? box.right - clientX : clientX - box.left;
    const wanted = from + Math.max(0, Math.min(1, along / box.width)) * (to - from);
    return Math.min(to - SLOT, Math.max(from, Math.floor(wanted / SLOT) * SLOT));
  }

  function openFor(target, clientX) {
    if (target.dataset.pop) {
      const info = details.get(target.dataset.pop);
      if (info) showPop(target, bookingPop(info));
    } else if (target.dataset.free !== undefined) {
      const precise = target.dataset.pointer !== undefined ? clientX : undefined;
      showPop(target, freePop(target, precise), precise);
    }
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

    details = new Map();
    return data.rooms.map(({ room, busy }, roomIndex) => {
      const blocks = busy
        .map((item) => ({
          from: minuteOn(state.date, item.start),
          to: minuteOn(state.date, item.end),
          item,
        }))
        .filter((b) => b.to > b.from)
        .sort((a, b) => a.from - b.from)
        .map((block, i) => {
          const key = `${roomIndex}-${i}`;
          details.set(key, { room, ...block });
          return { ...block, key };
        });
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

  /** What a block says after its time: my subject, or "Busy · organiser". */
  function busyWhat(item) {
    if (item.mine) return item.subject || t('rooms.day.yours');
    const organiser = item.organiser ? namesOf(item.organiser).primary.text : '';
    return organiser ? `${t('rooms.day.busy')} · ${organiser}` : t('rooms.day.busy');
  }

  /** "Meeting Room 2, busy 10:30 to 10:45, organiser Ahmed Hassan". */
  function busyName(room, { from, to, item }) {
    const vars = { name: roomName(room), from: clockOf(from), to: clockOf(to) };
    if (item.mine) {
      return t('rooms.day.mineNamed', {
        ...vars,
        subject: item.subject || t('rooms.mine.noSubject'),
      });
    }
    return item.organiser
      ? t('rooms.day.busyNamed', { ...vars, who: namesOf(item.organiser).primary.text })
      : t('rooms.day.busyNamedPlain', vars);
  }

  function timelineHtml(rows, hours) {
    const grid = gridFor(hours);
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
    const gridLines = grid.lines
      .map(
        ({ at, hour }) =>
          `<span class="day-tick${hour ? '' : ' day-tick--quarter'}" style="--at:${pct(
            at,
            hours
          )}%" aria-hidden="true"></span>`
      )
      .join('');

    return `<div class="card day-timeline" data-density="compact">
      <div class="day-timeline__head">
        <span class="u-microlabel" aria-hidden="true">${esc(t('room.name'))}</span>
        <div class="day-axis">
          ${grid.labels
            .map(
              (at) =>
                `<span class="day-axis__label" aria-hidden="true" style="--at:${pct(
                  at,
                  hours
                )}%">${clockOf(at)}</span>`
            )
            .join('')}
          ${
            showNow
              ? `<span class="day-axis__now" style="--at:${pct(nowMin, hours)}%">${esc(
                  t('rooms.day.now', { time: clockOf(nowMin) })
                )}</span>`
              : ''
          }
        </div>
      </div>
      <ul class="day-rows">${rows
        .map(({ room, blocks, free }) => {
          const blocksHtml = blocks
            .map((block) => {
              const { from, to, item, key } = block;
              const lo = Math.max(from, hours.workdayStartMin);
              const hi = Math.min(to, hours.workdayEndMin);
              if (hi <= lo) return '';
              return `<button type="button" class="day-busy${item.mine ? ' day-busy--mine' : ''}"
                data-pop="${key}" aria-label="${esc(busyName(room, block))}"
                style="--at:${pct(lo, hours)}%;--size:${pct(hi, hours) - pct(lo, hours)}%">
                <span class="day-busy__body" aria-hidden="true">
                  <span class="day-busy__time">${rangeHtml(from, to)}</span>
                  <span class="day-busy__what">${esc(busyWhat(item))}</span>
                </span>
              </button>`;
            })
            .join('');
          const freeHtml = free
            .map(
              (part) => `<button type="button" class="day-free" data-free
                data-room="${esc(room.id)}" data-from="${part.from}" data-to="${part.to}"
                data-pointer style="--at:${pct(part.from, hours)}%;--size:${
                  pct(part.to, hours) - pct(part.from, hours)
                }%" aria-label="${esc(freeLabel(room, part))}">
                <span class="day-free__body" aria-hidden="true">
                  ${icon('plus', 'day-free__icon')}
                  <span class="day-free__text">${rangeHtml(part.from, part.to)}</span>
                </span>
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
          ? `<ul class="day-slots" aria-label="${esc(t('rooms.day.freeTimes'))}">${free
              .map(
                (part) => `<li><button type="button" class="day-slot" data-free
                  data-room="${esc(room.id)}" data-from="${part.from}" data-to="${part.to}"
                  aria-label="${esc(freeLabel(room, part))}">
                  <span class="day-slot__time">${rangeHtml(part.from, part.to)}</span>
                  <span class="day-slot__length">${esc(durationLabel(part.to - part.from))}</span>
                  ${icon('plus', 'day-slot__icon')}
                </button></li>`
              )
              .join('')}</ul>`
          : `<p class="day-slots__none">${esc(
              t(blocks.length ? 'rooms.day.noneFree' : 'rooms.day.noneLeft')
            )}</p>`;

        // What is booked, in time order: each with its exact range. Mine say
        // what they are; anyone else's say who booked them.
        const booked = blocks.length
          ? `<div class="day-booked">
              <p class="u-microlabel">${esc(t('rooms.day.bookedTimes'))}</p>
              <ul class="day-slots">${blocks
                .map(
                  (block) => `<li><button type="button"
                    class="day-slot day-slot--booked${block.item.mine ? ' day-slot--mine' : ''}"
                    data-pop="${block.key}" aria-label="${esc(busyName(room, block))}">
                    <span class="day-slot__time">${rangeHtml(block.from, block.to)}</span>
                    <span class="day-slot__what">${esc(busyWhat(block.item))}</span>
                    ${
                      block.item.mine
                        ? `<span class="tag day-slot__tag">${esc(t('rooms.day.yours'))}</span>`
                        : ''
                    }
                  </button></li>`
                )
                .join('')}</ul>
            </div>`
          : '';

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
          ${booked}
        </li>`;
      })
      .join('')}</ul>`;
  }

  function showData(data) {
    loaded = data;
    hidePop();
    body.setAttribute('aria-busy', 'false');
    const rows = model(data);
    const withFree = rows.filter((r) => r.free.length > 0).length;
    summary.textContent = t('rooms.day.summary', { count: withFree, total: rows.length });
    body.innerHTML = `${timelineHtml(rows, data.hours)}${listHtml(rows)}`;
  }

  function showFailed() {
    body.setAttribute('aria-busy', 'false');
    summary.textContent = '';
    hidePop();
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
      hidePop();
      closedDay(env.hours);
      return;
    }

    body.setAttribute('aria-busy', 'true');
    if (!quiet || !loaded) {
      hidePop();
      body.innerHTML = skeleton();
    }
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

  const described = (event) => event.target.closest?.('[data-pop], [data-free]');

  // Hover (a mouse only: a finger's "hover" is the tap below) and focus.
  body.addEventListener('pointerover', (event) => {
    const target = described(event);
    if (target && event.pointerType === 'mouse' && !pinned) openFor(target, event.clientX);
  });
  body.addEventListener('pointermove', (event) => {
    const target = described(event);
    if (target?.dataset.pointer !== undefined && event.pointerType === 'mouse' && !pinned) {
      openFor(target, event.clientX);
    }
  });
  body.addEventListener('pointerout', (event) => {
    const target = described(event);
    if (!target || pinned || target.contains(event.relatedTarget)) return;
    // Keyboard focus keeps its panel when the mouse wanders off.
    if (document.activeElement === target && target.matches(':focus-visible')) openFor(target);
    else hidePop();
  });
  body.addEventListener('focusin', (event) => {
    const target = described(event);
    if (target && target.matches(':focus-visible')) openFor(target);
  });
  body.addEventListener('focusout', (event) => {
    if (described(event) === popFor) hidePop();
  });

  const onKey = (event) => {
    if (event.key === 'Escape' && !pop.hidden) hidePop();
  };
  const onOutside = (event) => {
    if (pinned && !event.target.closest?.('[data-pop]')) hidePop();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onOutside);

  body.addEventListener('click', async (event) => {
    // A booking: a tap (or Enter) opens its panel and a second one closes it.
    const booking = event.target.closest('[data-pop]');
    if (booking) {
      if (pinned && popFor === booking) {
        hidePop();
      } else {
        openFor(booking);
        pinned = true;
      }
      return;
    }

    const button = event.target.closest('[data-free]');
    if (!button || !loaded) return;
    const from = Number(button.dataset.from);
    const to = Number(button.dataset.to);

    // A press inside a long free stretch starts at the quarter hour it landed on.
    const precise =
      button.dataset.pointer !== undefined && event.detail > 0 && event.clientX > 0;
    const start = precise ? startUnder(button, event.clientX) : from;
    const duration = Math.max(SLOT, Math.min(60, Math.floor((to - start) / SLOT) * SLOT));
    hidePop();

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
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutside);
  };
}
