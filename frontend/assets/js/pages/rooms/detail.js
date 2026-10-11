/**
 * pages/rooms/detail.js — one room, in a panel over whichever view opened it:
 * its photo, how many it seats, the floor, what it has in it, and the two
 * things a person does next, book it or look at its day.
 *
 * A room with no photo yet says so; nothing stands in for a picture.
 */

import { openModal } from '../../components/dialog.js';
import { icon } from '../../components/icons.js';
import { cairoYmd } from '../../format.js';
import { esc } from '../../html.js';
import { t } from '../../i18n.js';
import { openBookingDialog } from './booking.js';
import {
  equipmentLabel,
  fitDuration,
  floorLabel,
  nextSlot,
  pair,
  roomName,
  seatsLabel,
} from './shared.js';

/**
 * @param {object} env
 * @param {object} room
 * @returns {{ close: () => void, closed: Promise<unknown> }}
 */
export function openRoomPanel(env, room) {
  const gear = room.equipment.length
    ? `<ul class="room-gear" aria-label="${esc(t('rooms.find.equipment'))}">${room.equipment
        .map(
          (key) =>
            `<li class="room-gear__item">${icon('check', 'room-gear__icon')}<span>${esc(
              equipmentLabel(key)
            )}</span></li>`
        )
        .join('')}</ul>`
    : `<p class="room-detail__none">${esc(t('rooms.equipment.none'))}</p>`;

  const photo = room.photoUrl
    ? `<img class="room-photo" src="${esc(room.photoUrl)}" alt="" loading="lazy" decoding="async" />`
    : `<div class="room-photo room-photo--blank">
         ${icon('rooms', 'room-photo__icon')}
         <span>${esc(t('rooms.detail.noPhoto'))}</span>
       </div>`;

  const bodyHtml = `<div class="room-detail">
    ${photo}
    <dl class="labelstrip labelstrip--open">
      ${pair(t('room.capacity'), esc(seatsLabel(room)))}
      ${pair(t('room.floor'), esc(floorLabel(room)))}
      ${pair(
        t('rooms.detail.access'),
        esc(t(room.restricted ? 'rooms.detail.restricted' : 'rooms.detail.everyone'))
      )}
    </dl>
    <section class="room-detail__section" aria-labelledby="roomGearTitle">
      <h3 class="card__title" id="roomGearTitle">${esc(t('rooms.find.equipment'))}</h3>
      ${gear}
    </section>
    ${
      room.notes
        ? `<section class="room-detail__section" aria-labelledby="roomNotesTitle">
             <h3 class="card__title" id="roomNotesTitle">${esc(t('rooms.detail.notes'))}</h3>
             <p>${esc(room.notes)}</p>
           </section>`
        : ''
    }
    <div class="btn-row">
      <button type="button" class="btn btn--primary" data-book>
        ${icon('calendar', 'btn__icon')}
        <span class="btn__label">${esc(t('rooms.detail.book'))}</span>
      </button>
      <a class="btn btn--secondary" href="#rooms/day?date=${esc(cairoYmd(new Date()))}&room=${esc(room.id)}">
        <span class="btn__label">${esc(t('rooms.detail.day'))}</span>
      </a>
    </div>
  </div>`;

  const panel = openModal({
    kind: 'drawer',
    title: roomName(room),
    lead: t('room.one'),
    bodyHtml,
  });

  panel.dialog.querySelector('[data-book]').addEventListener('click', async () => {
    const slot = nextSlot(env.hours);
    panel.close();
    const items = await openBookingDialog(env, {
      roomId: room.id,
      date: slot.date,
      start: slot.start,
      duration: fitDuration(60, slot.start, env.hours),
    });
    if (items) env.notifyChanged();
  });

  return panel;
}
