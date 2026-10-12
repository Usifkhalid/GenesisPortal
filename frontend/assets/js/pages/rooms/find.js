/**
 * pages/rooms/find.js — "Find a room": say when, for how many and with what,
 * and see the rooms that are free, smallest that fits first.
 *
 *   #rooms                         the form, filled with the next bookable hour
 *   #rooms/new                     the same (where Home's "Book a room" lands)
 *   #rooms?date=&start=&duration=&people=&equipment=   the same, filled in
 *
 * A search runs once on arrival, so the first thing on screen is rooms that
 * are free in the next hour. "Book" on a room opens the booking dialog with
 * everything filled; the subject is the only thing to type, which makes a
 * booking two taps. What is booked is always what was searched for, not
 * whatever the form says by then.
 */

import { ApiError } from '../../api.js';
import { icon } from '../../components/icons.js';
import { showToast } from '../../components/toast.js';
import { recordSkeleton } from '../../components/skeleton.js';
import { setBusy } from '../../components/form.js';
import { cairoYmd, clockOf, rangeOf } from '../../format.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';
import { openBookingDialog } from './booking.js';
import {
  DURATIONS,
  FILTER_EQUIPMENT,
  cancelBooking,
  dayLabel,
  durationLabel,
  equipmentLabel,
  errorText,
  findFree,
  fitDuration,
  floorLabel,
  nextSlot,
  pair,
  roomName,
  seatsLabel,
  whenLabel,
} from './shared.js';

const MAX_PEOPLE = 500;

/** "10:30" → 630, or null. */
function minutesOf(text) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** One line in a card: what the list says when it has nothing, or failed. */
function stateLine({ mark, title, text, actions = '' }) {
  return `<div class="empty empty--inline" role="status">
    ${icon(mark, 'empty__mark')}
    <div class="empty__copy">
      <p class="empty__title">${esc(title)}</p>
      <p class="empty__text">${esc(text)}</p>
    </div>
    ${actions}
  </div>`;
}

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../../router.js').Match, env: object }} ctx
 */
export function render(root, ctx) {
  const { env, route } = ctx;
  const { rooms, hours } = env;

  if (rooms.length === 0) {
    root.innerHTML = `<section class="card">${stateLine({
      mark: 'rooms',
      title: t('rooms.none.title'),
      text: t('rooms.none.text'),
    })}</section>`;
    return undefined;
  }

  /* ------------------------------------------------------------ the search */
  const first = nextSlot(hours);
  const asked = route.query;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asked.get('date') ?? '')
    ? asked.get('date')
    : first.date;
  const start =
    minutesOf(asked.get('start')) ??
    (date === first.date ? first.start : hours.workdayStartMin);
  const wantedLength = Number(asked.get('duration')) || 60;
  const people = Math.min(
    MAX_PEOPLE,
    Math.max(1, Math.trunc(Number(asked.get('people'))) || 1)
  );
  const equipment = (asked.get('equipment') ?? '')
    .split(',')
    .filter((key) => FILTER_EQUIPMENT.includes(key));

  const durationOptions = [...new Set([...DURATIONS, wantedLength])].sort((a, b) => a - b);
  const chosenLength = durationOptions.includes(wantedLength)
    ? wantedLength
    : fitDuration(60, start, hours);

  const today = cairoYmd(new Date());
  const equipmentChoices = FILTER_EQUIPMENT.map(
    (key) => `<label class="choice choice--inline">
        <input class="choice__control" type="checkbox" name="equipment" value="${key}"
          ${equipment.includes(key) ? 'checked' : ''} />
        <span class="choice__text"><span class="choice__label">${esc(equipmentLabel(key))}</span></span>
      </label>`
  ).join('');

  root.innerHTML = `<div class="stack">
    <form class="card find" id="findForm" novalidate aria-labelledby="findTitle">
      <div class="card__header">
        <div class="card__titles">
          <span class="tag">${esc(t('nav.rooms'))}</span>
          <h2 class="card__title" id="findTitle">${esc(t('rooms.find.title'))}</h2>
        </div>
      </div>
      <div class="find__fields">
        <div class="field find__date">
          <label class="field__label" for="findDate">${esc(t('field.date'))}</label>
          <input class="input" id="findDate" name="date" type="date" required
            min="${today}" value="${esc(date)}" />
        </div>
        <div class="field">
          <label class="field__label" for="findStart">${esc(t('field.time'))}</label>
          <input class="input" id="findStart" name="start" type="time" required step="900"
            value="${clockOf(start)}" />
        </div>
        <div class="field">
          <label class="field__label" for="findDuration">${esc(t('rooms.find.duration'))}</label>
          <select class="select" id="findDuration" name="duration">
            ${durationOptions
              .map(
                (d) =>
                  `<option value="${d}" ${d === chosenLength ? 'selected' : ''}>${esc(
                    durationLabel(d)
                  )}</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="findPeople">${esc(t('rooms.find.people'))}</label>
          <input class="input" id="findPeople" name="people" type="number" inputmode="numeric"
            min="1" max="${MAX_PEOPLE}" value="${people}" />
        </div>
      </div>
      <fieldset class="find__equipment">
        <legend class="field__label">${esc(t('rooms.find.equipment'))}
          <span class="field__optional">(${esc(t('field.optional'))})</span></legend>
        <div class="find__choices">${equipmentChoices}</div>
      </fieldset>
      <p class="find__error field__error" id="findError" role="alert" hidden></p>
      <div class="find__actions">
        <button type="submit" class="btn btn--primary" id="findGo">
          ${icon('search', 'btn__icon')}
          <span class="btn__label">${esc(t('rooms.find.go'))}</span>
        </button>
        <p class="field__help">${esc(t('field.timezoneNote'))}</p>
      </div>
    </form>

    <section class="card" aria-labelledby="freeTitle" id="freeCard" tabindex="-1">
      <div class="card__header">
        <div class="card__titles">
          <span class="tag">${esc(t('status.available'))}</span>
          <h2 class="card__title" id="freeTitle">${esc(t('rooms.find.resultsTitle'))}</h2>
        </div>
      </div>
      <p class="find__summary" id="freeSummary" role="status" aria-live="polite"></p>
      <div id="freeBody" aria-busy="true"></div>
    </section>
  </div>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const form = $('findForm');
  const body = $('freeBody');
  const summary = $('freeSummary');
  const errorLine = $('findError');
  const goButton = $('findGo');

  /** What the visible results were found for. */
  let found = null;
  let turn = 0;
  /** True while this view itself announces a change, so it does not hear itself. */
  let announcing = false;
  const announce = () => {
    announcing = true;
    env.notifyChanged();
    announcing = false;
  };

  const equipmentChecked = () =>
    [...form.querySelectorAll('[name="equipment"]:checked')].map((box) => box.value);

  function readForm() {
    const dateValue = form.elements.date.value;
    const startValue = minutesOf(form.elements.start.value);
    const peopleValue = Number(form.elements.people.value);
    return {
      date: dateValue,
      start: startValue,
      duration: Number(form.elements.duration.value),
      people: peopleValue,
      equipment: equipmentChecked(),
    };
  }

  function validate(search) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(search.date)) return t('rooms.book.dateError');
    if (search.start === null) return t('rooms.book.timeError');
    if (search.start % 15 !== 0) return t('rooms.error.booking_granularity');
    if (!Number.isInteger(search.people) || search.people < 1)
      return t('rooms.book.peopleError');
    return '';
  }

  function setAddress(search) {
    const params = new URLSearchParams({
      date: search.date,
      start: clockOf(search.start),
      duration: String(search.duration),
      people: String(search.people),
    });
    if (search.equipment.length > 0) params.set('equipment', search.equipment.join(','));
    history.replaceState(null, '', `#rooms?${params}`);
  }

  /* --------------------------------------------------------------- drawing */

  function roomRow(room) {
    const gear = room.equipment.map(equipmentLabel).join(', ');
    return `<li class="record">
      <dl class="labelstrip labelstrip--compact">
        ${pair(t('room.capacity'), esc(seatsLabel(room)))}
        ${pair(t('room.floor'), esc(floorLabel(room)))}
        ${pair(t('rooms.find.equipment'), esc(gear || t('rooms.equipment.none')))}
      </dl>
      <div class="record__head room-row">
        <h3 class="record__title">
          <a href="#rooms/${esc(room.id)}" data-room="${esc(room.id)}">${esc(roomName(room))}</a>
        </h3>
        <span class="record__aside">
          <button type="button" class="btn btn--primary btn--sm" data-book="${esc(room.id)}"
            aria-label="${esc(t('rooms.find.bookNamed', { name: roomName(room) }))}">
            ${icon('calendar', 'btn__icon')}
            <span class="btn__label">${esc(t('rooms.find.book'))}</span>
          </button>
        </span>
      </div>
    </li>`;
  }

  function showLoading() {
    body.setAttribute('aria-busy', 'true');
    summary.textContent = '';
    body.innerHTML = `<p class="u-visually-hidden">${esc(t('loading.label'))}</p>${recordSkeleton(3)}`;
  }

  function showResult(search, result, { confirmation = '' } = {}) {
    found = { search, rooms: result.rooms };
    body.setAttribute('aria-busy', 'false');
    const label = `${dayLabel(search.date)}, ${rangeOf(
      search.start,
      search.start + search.duration
    )}`;

    if (result.rooms.length === 0) {
      summary.textContent = t('rooms.find.noneSummary', { when: label });
      body.innerHTML = `${confirmation}${stateLine({
        mark: 'blankLabel',
        title: t('rooms.find.noneTitle'),
        text: t('rooms.find.noneText'),
        actions: `<a class="btn btn--secondary btn--sm" href="#rooms/day?date=${esc(search.date)}">
            <span class="btn__label">${esc(t('rooms.find.seeDay'))}</span>
          </a>`,
      })}`;
      return;
    }

    summary.textContent = t('rooms.find.summary', { count: result.rooms.length, when: label });
    body.innerHTML = `${confirmation}<ul class="record-list" data-density="compact"
      aria-label="${esc(t('rooms.find.resultsTitle'))}">${result.rooms.map(roomRow).join('')}</ul>
      <p class="find__hint">${esc(t('rooms.find.order'))}</p>`;
  }

  function showFailure(err, search) {
    body.setAttribute('aria-busy', 'false');
    summary.textContent = '';
    const refused = err instanceof ApiError && err.status === 400;
    const next = nextSlot(hours);
    const useNext = refused
      ? `<button type="button" class="btn btn--secondary btn--sm" data-use-next>
           <span class="btn__label">${esc(
             t('rooms.find.useNext', {
               when: `${dayLabel(next.date)}, ${clockOf(next.start)}`,
             })
           )}</span>
         </button>`
      : `<button type="button" class="btn btn--secondary btn--sm" data-retry>
           <span class="btn__label">${esc(t('action.retry'))}</span>
         </button>`;
    body.innerHTML = stateLine({
      mark: 'statusOverdue',
      title: t(refused ? 'rooms.find.refusedTitle' : 'home.failed.title'),
      text: errorText(err),
      actions: useNext,
    });
    body.querySelector('[data-retry]')?.addEventListener('click', () => run(search));
    body.querySelector('[data-use-next]')?.addEventListener('click', () => {
      form.elements.date.value = next.date;
      form.elements.start.value = clockOf(next.start);
      form.elements.duration.value = String(fitDuration(60, next.start, hours));
      form.requestSubmit();
    });
  }

  async function run(search, { focus = false } = {}) {
    const mine = ++turn;
    setAddress(search);
    showLoading();
    setBusy(goButton, true);
    try {
      const result = await findFree(search);
      if (mine !== turn) return;
      showResult(search, result);
      if (focus) $('freeCard').focus({ preventScroll: false });
    } catch (err) {
      if (mine !== turn) return;
      found = null;
      showFailure(err, search);
    } finally {
      if (mine === turn) setBusy(goButton, false);
    }
  }

  /* ---------------------------------------------------------------- events */

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const search = readForm();
    const message = validate(search);
    errorLine.hidden = !message;
    errorLine.textContent = message;
    if (message) return;
    run(search, { focus: true });
  });

  async function book(roomId) {
    if (!found) return;
    const { search } = found;
    const items = await openBookingDialog(
      env,
      {
        roomId,
        date: search.date,
        start: search.start,
        duration: search.duration,
        people: search.people,
      },
      (slot) => {
        form.elements.date.value = slot.date;
        form.elements.start.value = clockOf(slot.start);
        form.elements.duration.value = String(slot.duration);
        form.elements.people.value = String(slot.people);
        form.requestSubmit();
      }
    );
    if (!items) return;
    announce();

    const room = rooms.find((r) => r.id === roomId);
    const series = items.length > 1;
    const confirmation = `<div class="notice notice--success find__done" role="status">
      ${icon('statusResolved', 'notice__icon')}
      <div class="notice__content stack stack--tight">
        <div>
          <p class="notice__title">${esc(t(series ? 'rooms.book.doneSeries' : 'rooms.book.done'))}</p>
          <p>${esc(
            series
              ? t('rooms.book.doneSeriesText', { count: items.length, room: roomName(room) })
              : `${roomName(room)} · ${whenLabel(items[0].start, items[0].end)}`
          )}</p>
        </div>
        <div class="btn-row">
          <a class="btn btn--secondary btn--sm" href="#rooms/mine">
            <span class="btn__label">${esc(t('rooms.find.viewMine'))}</span>
          </a>
          <button type="button" class="btn btn--ghost btn--sm" data-undo="${esc(items[0].id)}"
            data-series="${series}">
            <span class="btn__label">${esc(t('rooms.find.undo'))}</span>
          </button>
        </div>
      </div>
    </div>`;

    // The room just booked is no longer free: ask again, then say what was done.
    try {
      showResult(search, await findFree(search), { confirmation });
    } catch {
      showResult(
        search,
        { rooms: found.rooms.filter((r) => r.id !== roomId) },
        { confirmation }
      );
    }
    body.querySelector('.find__done')?.scrollIntoView({ block: 'nearest' });
  }

  body.addEventListener('click', async (event) => {
    const bookButton = event.target.closest('[data-book]');
    if (bookButton) {
      await book(bookButton.dataset.book);
      return;
    }
    const undo = event.target.closest('[data-undo]');
    if (undo) {
      setBusy(undo, true);
      try {
        await cancelBooking(
          undo.dataset.undo,
          undo.dataset.series === 'true' ? 'series' : 'one'
        );
        announce();
        showToast({ tone: 'success', titleKey: 'rooms.mine.cancelled' });
        if (found) run(found.search);
      } catch (err) {
        setBusy(undo, false);
        showToast({
          tone: 'danger',
          titleKey: 'rooms.mine.cancelFailed',
          text: errorText(err),
        });
      }
    }
  });

  // A booking made elsewhere on the page (a room's panel) changes who is free.
  const stopListening = env.onChanged(() => {
    if (!announcing && found && body.querySelector('[data-book]')) run(found.search);
  });

  run(readForm());

  return () => {
    turn += 1;
    stopListening();
  };
}
