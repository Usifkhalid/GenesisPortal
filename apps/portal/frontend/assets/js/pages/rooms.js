/**
 * pages/rooms.js — room booking, one page with a view per address:
 *
 *   #rooms                  find a free room for a time (and #rooms/new)
 *   #rooms/day              a day of every room: a timetable, or a list on a phone
 *   #rooms/mine             what I have booked, with cancel
 *   #rooms/<room id>        a room's panel, over "find a room"
 *
 * The views are modules in rooms/, fetched when asked for. They share one
 * environment: the rooms this person may use, their company's working hours,
 * and a small bus so that a booking made in one place redraws the others.
 *
 * A room name anywhere on the page opens the room's panel in place; its
 * address is the page's own address with the room id, so it can be shared.
 */

import { loadFailedNotice } from '../components/notice.js';
import { esc } from '../html.js';
import { t } from '../i18n.js';
import { openRoomPanel } from './rooms/detail.js';
import { loadEnvironment } from './rooms/shared.js';

const VIEWS = { day: 'day', mine: 'mine' };

const NAV = [
  { key: 'find', href: '#rooms', label: 'rooms.nav.find' },
  { key: 'day', href: '#rooms/day', label: 'rooms.nav.day' },
  { key: 'mine', href: '#rooms/mine', label: 'rooms.nav.mine' },
];

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../router.js').Match, company: object }} ctx
 */
export async function render(root, ctx) {
  const [first] = ctx.route.params;
  const view = VIEWS[first] ?? 'find';
  const roomId = first && !VIEWS[first] && first !== 'new' ? first : null;

  root.innerHTML = `<div class="stack rooms">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t('nav.rooms'))}</h1>
        <p class="page__lead">${esc(t('rooms.lead'))}</p>
      </div>
    </header>
    <nav class="rooms-nav" aria-label="${esc(t('rooms.nav.label'))}">
      ${NAV.map(
        (item) =>
          `<a class="rooms-nav__link" href="${item.href}" ${
            item.key === view ? 'aria-current="page"' : ''
          }>${esc(t(item.label))}</a>`
      ).join('')}
    </nav>
    <div id="roomsView" class="rooms__view"></div>
  </div>`;

  const host = root.querySelector('#roomsView');

  let loaded;
  try {
    loaded = await loadEnvironment(ctx);
  } catch {
    host.innerHTML = loadFailedNotice();
    host.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    return undefined;
  }

  const listeners = new Set();
  const env = {
    ...loaded,
    /** Tell every view that bookings changed. */
    notifyChanged: () => {
      for (const listener of [...listeners]) listener();
    },
    /** @returns {() => void} the way to stop listening */
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const module = await import(`./rooms/${view}.js`);
  const leave = await module.render(host, { ...ctx, env });

  /* ------------------------------------------------------------ room panel */
  let panel = null;
  let addressBefore = '#rooms';

  function openPanel(id, { direct = false } = {}) {
    const room = env.rooms.find((r) => r.id === id);
    if (!room) return;
    panel?.close();
    addressBefore = direct ? '#rooms' : location.hash || '#rooms';
    history.replaceState(null, '', `#rooms/${room.id}`);

    const mine = openRoomPanel(env, room);
    panel = mine;
    mine.closed.then(() => {
      if (panel !== mine) return;
      panel = null;
      history.replaceState(null, '', addressBefore);
    });
  }

  const onClick = (event) => {
    const link = event.target.closest('a[data-room]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    openPanel(link.dataset.room);
  };
  root.addEventListener('click', onClick);

  if (roomId) {
    if (env.rooms.some((r) => r.id === roomId)) openPanel(roomId, { direct: true });
    else
      host.insertAdjacentHTML(
        'afterbegin',
        `<p class="rooms__missing" role="alert">${esc(t('rooms.detail.notFound'))}</p>`
      );
  }

  return () => {
    root.removeEventListener('click', onClick);
    const open = panel;
    panel = null;
    open?.close();
    if (typeof leave === 'function') leave();
  };
}
