/**
 * pages/rooms/booking.js — the booking dialog: subject, who to invite, whether
 * it repeats, and a confirm. Opened from a free room in "Find a room", from a
 * free stretch of the day view and from a room's panel.
 *
 * The time and the room come in filled from where the person was, and stay
 * folded under one line ("Meeting Room 2 · Sun, 25 Oct, 10:00–11:00 · Change"),
 * so the common case is two taps: Book, then Confirm. Anything the server
 * refuses is said in place, on the field it is about when there is one, and a
 * room taken in the meantime lists the times that met something.
 */

import { ApiError } from '../../api.js';
import { openModal } from '../../components/dialog.js';
import {
  clearFieldErrors,
  describedBy,
  field,
  setBusy,
  setFieldError,
} from '../../components/form.js';
import { icon } from '../../components/icons.js';
import { createPeoplePicker } from '../../components/people-picker.js';
import { showToast } from '../../components/toast.js';
import {
  addDays,
  cairoYmd,
  clockOf,
  fromCairoInput,
  rangeOf,
  weekdayOf,
} from '../../format.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';
import {
  DURATIONS,
  bookRoom,
  conflictLines,
  dayLabel,
  durationLabel,
  errorText,
  roomLine,
  roomName,
} from './shared.js';

const SUBJECT_MAX = 200;
const HORIZON_DAYS = 90;
const SERIES_MONTHS = 6;

/** "2026-10-25" plus whole months, as the server counts them. */
function addMonths(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

/** An inline notice for what the server said. */
function noticeHtml({ tone = 'danger', title, text, lines = [], action = '' }) {
  return `<div class="notice notice--${tone}" role="alert">
    ${icon('statusOverdue', 'notice__icon')}
    <div class="notice__content stack stack--tight">
      <div>
        <p class="notice__title">${esc(title)}</p>
        <p>${esc(text)}</p>
      </div>
      ${
        lines.length
          ? `<ul class="booking__conflicts">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
          : ''
      }
      ${action}
    </div>
  </div>`;
}

/**
 * @param {object} env
 * @param {object[]} env.rooms
 * @param {{ workdayStartMin: number, workdayEndMin: number, workingDays: number[] }} env.hours
 * @param {object} preset
 * @param {string} [preset.roomId]
 * @param {string} preset.date  Cairo day, "2026-10-25"
 * @param {number} preset.start  minutes after midnight
 * @param {number} preset.duration  minutes
 * @param {number} [preset.people]
 * @param {string} [preset.subject]
 * @param {(slot: { date: string, start: number, duration: number, people: number }) => void} [onFindAnother]
 *   offered when the room was taken: "Find another room" for the same time
 * @returns {Promise<object[] | null>}  the bookings made, or null when closed
 */
export async function openBookingDialog(env, preset, onFindAnother) {
  const { rooms, hours } = env;
  const today = cairoYmd(new Date());
  const furthest = addDays(today, HORIZON_DAYS);
  const selectedRoom = rooms.find((r) => r.id === preset.roomId) ?? rooms[0];
  let peopleEdited = false;

  const roomOptions = rooms
    .map(
      (room) =>
        `<option value="${esc(room.id)}" ${room.id === selectedRoom.id ? 'selected' : ''}>${esc(
          `${roomName(room)} · ${roomLine(room)}`
        )}</option>`
    )
    .join('');

  const durationOptions = [...new Set([...DURATIONS, preset.duration])]
    .sort((a, b) => a - b)
    .map(
      (d) =>
        `<option value="${d}" ${d === preset.duration ? 'selected' : ''}>${esc(
          durationLabel(d)
        )}</option>`
    )
    .join('');

  const weekdayChoices = hours.workingDays
    .map(
      (day) => `<label class="choice choice--inline">
        <input class="choice__control" type="checkbox" name="weekday" value="${day}" />
        <span class="choice__text"><span class="choice__label">${esc(
          t(`rooms.weekday.${day}`)
        )}</span></span>
      </label>`
    )
    .join('');

  const bodyHtml = `<form id="bkForm" class="booking stack" novalidate>
    <div id="bkNotice" class="booking__notice"></div>

    ${field({
      id: 'bkSubject',
      label: t('rooms.book.subject'),
      required: true,
      help: t('rooms.book.subjectHelp'),
      control: `<input class="input" id="bkSubject" name="subject" type="text" maxlength="${SUBJECT_MAX}"
        autocomplete="off" required value="${esc(preset.subject ?? t('rooms.book.subjectDefault'))}"
        aria-describedby="${describedBy('bkSubject')}" />`,
    })}

    <div id="bkPeople"></div>

    <details class="booking__when" id="bkWhen">
      <summary class="booking__summary">
        <span id="bkSummary" class="booking__summary-text"></span>
        <span class="booking__change">${esc(t('rooms.book.change'))}</span>
      </summary>
      <div class="stack booking__fields">
        ${field({
          id: 'bkRoom',
          label: t('rooms.book.room'),
          control: `<select class="select" id="bkRoom" name="roomId"
            aria-describedby="${describedBy('bkRoom', false)}">${roomOptions}</select>`,
        })}
        <div class="field-row">
          ${field({
            id: 'bkDate',
            label: t('field.date'),
            control: `<input class="input" id="bkDate" name="date" type="date" required
              min="${today}" max="${furthest}" value="${esc(preset.date)}"
              aria-describedby="${describedBy('bkDate', false)}" />`,
          })}
          ${field({
            id: 'bkStart',
            label: t('field.time'),
            control: `<input class="input" id="bkStart" name="start" type="time" required step="900"
              value="${clockOf(preset.start)}" aria-describedby="${describedBy('bkStart', false)}" />`,
          })}
        </div>
        <div class="field-row">
          ${field({
            id: 'bkDuration',
            label: t('rooms.find.duration'),
            control: `<select class="select" id="bkDuration" name="duration"
              aria-describedby="${describedBy('bkDuration', false)}">${durationOptions}</select>`,
          })}
          ${field({
            id: 'bkCount',
            label: t('rooms.book.people'),
            control: `<input class="input" id="bkCount" name="people" type="number" inputmode="numeric"
              min="1" max="${selectedRoom.capacity}" value="${preset.people ?? 1}"
              aria-describedby="${describedBy('bkCount', false)}" />`,
          })}
        </div>
        <p class="field__help">${esc(t('field.timezoneNote'))}</p>
      </div>
    </details>

    ${field({
      id: 'bkRepeat',
      label: t('rooms.book.repeat'),
      control: `<select class="select" id="bkRepeat" name="repeat"
        aria-describedby="${describedBy('bkRepeat', false)}">
          <option value="none">${esc(t('rooms.book.repeatNone'))}</option>
          <option value="daily">${esc(t('rooms.book.repeatDaily'))}</option>
          <option value="weekly">${esc(t('rooms.book.repeatWeekly'))}</option>
        </select>`,
    })}

    <fieldset class="booking__weekdays" id="bkWeekdays" hidden>
      <legend class="field__label">${esc(t('rooms.book.weekdays'))}</legend>
      <div class="booking__weekday-list">${weekdayChoices}</div>
      <p class="field__error" id="bkWeekdays-error" role="alert" hidden></p>
    </fieldset>

    <div id="bkUntilWrap" hidden>
      ${field({
        id: 'bkUntil',
        label: t('rooms.book.until'),
        required: true,
        help: t('rooms.book.untilHelp', { months: SERIES_MONTHS }),
        control: `<input class="input" id="bkUntil" name="until" type="date"
          aria-describedby="${describedBy('bkUntil')}" />`,
      })}
    </div>
  </form>`;

  const footerHtml = `<button type="button" class="btn btn--ghost" data-modal-close>
      <span class="btn__label">${esc(t('action.cancel'))}</span>
    </button>
    <button type="submit" class="btn btn--primary" form="bkForm" id="bkSubmit">
      <span class="btn__label">${esc(t('rooms.book.confirm'))}</span>
    </button>`;

  const { dialog, close, closed } = openModal({
    title: t('rooms.book.title'),
    bodyHtml,
    footerHtml,
  });
  dialog.classList.add('booking-dialog');

  const form = dialog.querySelector('#bkForm');
  const noticeBox = dialog.querySelector('#bkNotice');
  const when = dialog.querySelector('#bkWhen');
  const submit = dialog.querySelector('#bkSubmit');
  const el = (name) => form.elements[name];

  const picker = createPeoplePicker({
    host: dialog.querySelector('#bkPeople'),
    id: 'bkInvite',
    label: t('rooms.book.invite'),
    help: t('rooms.book.inviteHelp'),
  });

  /* ------------------------------------------------------------- reading */

  const roomNow = () => rooms.find((r) => r.id === el('roomId').value) ?? selectedRoom;

  /** The slot as the form has it, or null while the date or time is blank. */
  function slot() {
    const date = el('date').value;
    const time = el('start').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
    const start = fromCairoInput(`${date}T${time}`);
    if (!start) return null;
    const minutes = Number(el('duration').value);
    const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
    return { date, time, start, end, minutes };
  }

  function drawSummary() {
    const s = slot();
    const from = s ? Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3)) : 0;
    const text = s
      ? `${roomName(roomNow())} · ${dayLabel(s.date)}, ${rangeOf(from, from + s.minutes)}`
      : roomName(roomNow());
    dialog.querySelector('#bkSummary').textContent = text;
  }

  function syncRepeat() {
    const kind = el('repeat').value;
    dialog.querySelector('#bkWeekdays').hidden = kind !== 'weekly';
    dialog.querySelector('#bkUntilWrap').hidden = kind === 'none';
    if (kind === 'none') return;

    const date = el('date').value;
    if (kind === 'weekly' && date) {
      const first = weekdayOf(date);
      const boxes = [...form.querySelectorAll('[name="weekday"]')];
      // A series has to include the weekday of its first meeting.
      const mine = boxes.find((b) => Number(b.value) === first);
      if (mine && !boxes.some((b) => b.checked)) mine.checked = true;
    }
    if (date) {
      const until = el('until');
      until.min = date;
      until.max = addMonths(date, SERIES_MONTHS);
      if (!until.value) until.value = addDays(date, kind === 'weekly' ? 28 : 6);
      if (until.value > until.max) until.value = until.max;
    }
  }

  /* -------------------------------------------------------------- events */

  for (const name of ['roomId', 'date', 'start', 'duration']) {
    el(name).addEventListener('input', () => {
      drawSummary();
      if (name === 'roomId') el('people').max = roomNow().capacity;
      if (name === 'date') syncRepeat();
    });
  }
  // A field put right stops saying it is wrong, without waiting for Confirm.
  form.addEventListener('input', (event) => {
    if (event.target.id) setFieldError(form, event.target.id, '');
  });
  el('repeat').addEventListener('input', syncRepeat);
  el('people').addEventListener('input', () => {
    peopleEdited = true;
  });
  // Invited people are people in the room, until the number is set by hand.
  picker.onChange = () => {
    if (!peopleEdited) el('people').value = String(Math.max(1, picker.count + 1));
  };
  if (preset.people && preset.people > 1) peopleEdited = true;

  /* ------------------------------------------------------------ checking */

  /** Puts a message on a field and opens the fold that holds it. */
  function refuse(id, message) {
    setFieldError(form, id, message);
    if (form.querySelector(`#${id}`)?.closest('details')) when.open = true;
  }

  function check() {
    clearFieldErrors(form);
    noticeBox.innerHTML = '';
    let bad = false;

    if (!el('subject').value.trim()) {
      setFieldError(form, 'bkSubject', t('rooms.book.subjectError'));
      bad = true;
    }
    const s = slot();
    if (!el('date').value) {
      refuse('bkDate', t('rooms.book.dateError'));
      bad = true;
    }
    if (!el('start').value) {
      refuse('bkStart', t('rooms.book.timeError'));
      bad = true;
    } else if (s && Number(s.time.slice(3)) % 15 !== 0) {
      refuse('bkStart', t('rooms.error.booking_granularity'));
      bad = true;
    }
    const people = Number(el('people').value);
    if (!Number.isInteger(people) || people < 1) {
      refuse('bkCount', t('rooms.book.peopleError'));
      bad = true;
    } else if (people > roomNow().capacity) {
      refuse('bkCount', t('rooms.error.over_capacity', { capacity: roomNow().capacity }));
      bad = true;
    }

    const kind = el('repeat').value;
    if (kind !== 'none') {
      const until = el('until').value;
      if (!until) {
        setFieldError(form, 'bkUntil', t('rooms.book.untilError'));
        bad = true;
      } else if (s && until < s.date) {
        setFieldError(form, 'bkUntil', t('rooms.error.recurrence_ends_before_start'));
        bad = true;
      }
    }
    if (kind === 'weekly') {
      const days = [...form.querySelectorAll('[name="weekday"]:checked')];
      if (days.length === 0) {
        const error = dialog.querySelector('#bkWeekdays-error');
        error.textContent = t('rooms.book.weekdaysError');
        error.hidden = false;
        bad = true;
      }
    }
    return bad ? null : { s, people, kind };
  }

  function bodyFor({ s, people, kind }) {
    const body = {
      roomId: el('roomId').value,
      subject: el('subject').value.trim(),
      start: s.start,
      end: s.end,
      attendeeCount: people,
      attendeeIds: picker.ids,
    };
    if (kind === 'daily') body.recurrence = { type: 'daily', until: el('until').value };
    if (kind === 'weekly') {
      body.recurrence = {
        type: 'weekly',
        weekdays: [...form.querySelectorAll('[name="weekday"]:checked')]
          .map((box) => Number(box.value))
          .sort(),
        until: el('until').value,
      };
    }
    return body;
  }

  /** Says what the server refused, where the person will look for it. */
  function showRefusal(err) {
    const code = err instanceof ApiError ? err.code : '';
    const text = errorText(err);
    const onField = {
      booking_granularity: 'bkStart',
      booking_in_past: 'bkStart',
      booking_too_far: 'bkDate',
      not_a_working_day: 'bkDate',
      outside_working_hours: 'bkStart',
      booking_too_short: 'bkDuration',
      booking_too_long: 'bkDuration',
      over_capacity: 'bkCount',
      recurrence_too_long: 'bkUntil',
      recurrence_ends_before_start: 'bkUntil',
    }[code];

    if (code === 'room_conflict') {
      when.open = true;
      const again = onFindAnother
        ? `<div><button type="button" class="btn btn--secondary" data-find-another>
             <span class="btn__label">${esc(t('rooms.book.findAnother'))}</span>
           </button></div>`
        : '';
      noticeBox.innerHTML = noticeHtml({
        title: t('rooms.book.conflictTitle'),
        text,
        lines: conflictLines(err),
        action: again,
      });
      noticeBox.querySelector('[data-find-another]')?.addEventListener('click', () => {
        const s = slot();
        close(null);
        if (s) {
          onFindAnother({
            date: s.date,
            start: Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3)),
            duration: s.minutes,
            people: Math.max(1, Number(el('people').value) || 1),
          });
        }
      });
      noticeBox.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (onField) {
      refuse(onField, text);
      form.querySelector(`#${onField}`)?.focus();
      return;
    }
    if (code === 'recurrence_day_mismatch') {
      const error = dialog.querySelector('#bkWeekdays-error');
      error.textContent = text;
      error.hidden = false;
      return;
    }
    noticeBox.innerHTML = noticeHtml({
      tone: err instanceof ApiError && err.status === 0 ? 'warning' : 'danger',
      title: t(code === 'unknown_attendee' ? 'rooms.book.inviteFailed' : 'rooms.book.failed'),
      text,
    });
    noticeBox.scrollIntoView({ block: 'nearest' });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const checked = check();
    if (!checked) {
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    setBusy(submit, true, t('rooms.book.booking'));
    try {
      const { items } = await bookRoom(bodyFor(checked));
      showToast({
        tone: 'success',
        titleKey: items.length > 1 ? 'rooms.book.doneSeries' : 'rooms.book.done',
        text:
          items.length > 1
            ? t('rooms.book.doneSeriesText', { count: items.length, room: roomName(roomNow()) })
            : `${roomName(roomNow())} · ${dayLabel(checked.s.date)}, ${checked.s.time}`,
      });
      close(items);
    } catch (err) {
      setBusy(submit, false, t('rooms.book.confirm'));
      showRefusal(err);
    }
  });

  drawSummary();
  syncRepeat();
  // The subject is the one thing to type: its text is selected, so Confirm
  // alone books a meeting called "Meeting".
  el('subject').focus();
  el('subject').select();

  const result = await closed;
  return Array.isArray(result) ? result : null;
}
