/**
 * pages/home.js — the Home page.
 *
 * A welcome banner over a bento grid of the four jobs: tickets, rooms,
 * announcements and the directory. Loaded on demand by app.js. The person and
 * the company are the session's; everything else is static demo data for now; the markup is the shape the real modules
 * will fill, including what each card says when it has nothing to show.
 */

import { t, getLocale } from '../i18n.js';
import { icon } from '../components/icons.js';
import { companyName } from '../components/company-mark.js';
import { initials } from '../components/initials.js';
import {
  DEMO_TICKETS,
  DEMO_BOOKINGS,
  DEMO_ANNOUNCEMENTS,
  DEMO_PEOPLE,
  DEMO_WAITING,
  ticketNumber,
} from '../demo-data.js';

const CAIRO = 'Africa/Cairo';

/** Home shows the head of each list; the module's own page shows the rest. */
const MAX_ROWS = 4;

/** Each ticket status has its own badge tone and its own icon silhouette. */
const STATUS = {
  open: { tone: '', icon: 'statusOpen' },
  inProgress: { tone: 'badge--info', icon: 'statusProgress' },
  waiting: { tone: 'badge--warning', icon: 'statusWaiting' },
  resolved: { tone: 'badge--success', icon: 'statusResolved' },
  overdue: { tone: 'badge--danger', icon: 'statusOverdue' },
};

let clockTimer = null;

const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );

/* ------------------------------------------------------------- Cairo time */

/**
 * Dates are shown in Cairo time whatever zone the device is in. Digits stay
 * Latin in Arabic too, so they are set by the same face and line up in a strip.
 */
function dateLocale() {
  return getLocale() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
}

function cairoDate(now) {
  return new Intl.DateTimeFormat(dateLocale(), {
    timeZone: CAIRO,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
}

function cairoTime(now) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

function cairoHour(now) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: CAIRO,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now)
  );
}

function greetingKey(hour) {
  if (hour >= 5 && hour < 12) return 'home.greetingMorning';
  if (hour >= 12 && hour < 17) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

/** "14:30" today, "Thu 16:00" on another day. */
function when(day, time) {
  return day ? `${t(`day.${day}`)} ${time}` : time;
}

/* ---------------------------------------------------------------- pieces */

/** One key/value pair of a label strip. */
function pair(key, value) {
  return `<div class="labelstrip__pair">
    <dt class="labelstrip__key">${esc(key)}</dt>
    <dd class="labelstrip__value">${value}</dd>
  </div>`;
}

/** A card's head: pill tag over the title, round arrow button at the end. */
function cardHead({ id, tag, title, count = '', href = '', openLabel = '' }) {
  return `<div class="card__header">
    <div class="card__titles">
      <span class="tag">${esc(tag)}</span>
      <h2 class="card__title" id="${id}">${esc(title)}${
        count ? ` <span class="card__count">${esc(count)}</span>` : ''
      }</h2>
    </div>
    ${
      href
        ? `<a class="arrow-btn card__aside" href="${href}" aria-label="${esc(openLabel)}">
             ${icon('arrowUpEnd', '', { directional: true })}
           </a>`
        : ''
    }
  </div>`;
}

/**
 * What a card says when its list is empty: one line, in place, at the card's
 * own size. Home never swaps itself for a page-sized empty state.
 */
function emptyLine(titleKey, textKey, mark = 'blankLabel') {
  return `<div class="empty empty--inline">
    ${icon(mark, 'empty__mark')}
    <div class="empty__copy">
      <p class="empty__title">${esc(t(titleKey))}</p>
      <p class="empty__text">${esc(t(textKey))}</p>
    </div>
  </div>`;
}

/** A capped record list, with a link to the rest when there is a rest. */
function recordList(rows, href) {
  const extra = rows.length - MAX_ROWS;
  return `<ul class="record-list" data-density="compact">${rows.slice(0, MAX_ROWS).join('')}</ul>
    ${
      extra > 0
        ? `<a class="record-list__more" href="${href}">${esc(t('home.more', { count: extra }))}</a>`
        : ''
    }`;
}

function ticketRow(company, ticket) {
  const number = ticketNumber(company.code, ticket.seq);
  const status = STATUS[ticket.status];
  return `<li class="record">
    <dl class="labelstrip labelstrip--compact">
      ${pair(t('ticket.one'), esc(number))}
      ${pair(t('field.priority'), esc(ticket.priority))}
      ${pair(t('ticket.due'), esc(when(ticket.day, ticket.due)))}
    </dl>
    <div class="record__head">
      <h3 class="record__title">
        <a href="#tickets/${esc(number)}">${esc(t(ticket.subject))}</a>
      </h3>
      <span class="record__aside">
        <span class="badge ${status.tone}">
          ${icon(status.icon, 'badge__icon')}
          <span>${esc(t(`status.${ticket.status}`))}</span>
        </span>
      </span>
    </div>
  </li>`;
}

/* ---------------------------------------------------------------- banner */

function banner({ company, user, admin }, now) {
  const greeting = t(greetingKey(cairoHour(now)), { name: user.firstName });

  return `<section class="banner" aria-labelledby="homeGreeting">
    <div class="banner__body">
      <div class="banner__intro">
        <h1 class="banner__greeting" id="homeGreeting">${esc(greeting)}</h1>
        <p class="banner__lead">${esc(t('home.lead'))}</p>
      </div>
      <div class="btn-row">
        <a class="btn btn--primary" href="#rooms/new">
          ${icon('calendar', 'btn__icon')}
          <span class="btn__label">${esc(t('action.bookRoom'))}</span>
        </a>
        <a class="btn btn--primary" href="#tickets/new">
          ${icon('plus', 'btn__icon')}
          <span class="btn__label">${esc(t('action.newTicket'))}</span>
        </a>
        ${
          admin
            ? `<a class="btn btn--secondary" href="#announcements/new">
                 <span class="btn__label">${esc(t('action.newAnnouncement'))}</span>
               </a>`
            : ''
        }
      </div>
      <dl class="labelstrip labelstrip--open banner__strip">
        ${pair(t('ticket.company'), companyName(company).outerHTML)}
        ${pair(t('home.today'), `<span data-cairo-date>${esc(cairoDate(now))}</span>`)}
        ${pair(t('home.cairoTime'), `<span data-cairo-time>${esc(cairoTime(now))}</span>`)}
      </dl>
    </div>
  </section>`;
}

/* ----------------------------------------------------------------- cards */

function ticketsCard({ company }) {
  // What is late comes first; after that, the order the queue gave them.
  const tickets = [...DEMO_TICKETS].sort(
    (a, b) => (b.status === 'overdue') - (a.status === 'overdue')
  );
  const rows = tickets.map((ticket) => ticketRow(company, ticket));

  return `<section class="card home__tickets" aria-labelledby="homeTicketsTitle">
    ${cardHead({
      id: 'homeTicketsTitle',
      tag: t('nav.tickets'),
      title: t('home.tickets.title'),
      count: rows.length ? t('home.tickets.count', { count: rows.length }) : '',
      href: '#tickets',
      openLabel: t('home.tickets.openAll'),
    })}
    ${
      rows.length
        ? recordList(rows, '#tickets')
        : emptyLine('home.tickets.emptyTitle', 'home.tickets.emptyText')
    }
  </section>`;
}

function roomsCard({ company }) {
  const rows = DEMO_BOOKINGS.map((booking) => {
    const room = `${company.code}-${booking.room}`;
    const day = booking.today ? t('home.today') : t(`day.${booking.day}`);
    return `<li class="record">
      <dl class="labelstrip labelstrip--compact">
        ${pair(t('room.name'), esc(room))}
        ${pair(t('home.rooms.when'), `${esc(day)} ${esc(booking.time)}`)}
        ${pair(t('room.floor'), esc(booking.floor))}
      </dl>
      <h3 class="record__title"><a href="#rooms/${esc(room)}">${esc(t(booking.title))}</a></h3>
    </li>`;
  });

  return `<section class="card home__rooms" aria-labelledby="homeRoomsTitle">
    ${cardHead({
      id: 'homeRoomsTitle',
      tag: t('nav.rooms'),
      title: t('home.rooms.title'),
      href: '#rooms',
      openLabel: t('home.rooms.openAll'),
    })}
    ${
      rows.length
        ? recordList(rows, '#rooms')
        : emptyLine('home.rooms.emptyTitle', 'home.rooms.emptyText')
    }
  </section>`;
}

function waitingCard({ company }) {
  const rows = DEMO_WAITING.map((ticket) => ticketRow(company, ticket));

  return `<section class="card home__waiting" aria-labelledby="homeWaitingTitle">
    ${cardHead({
      id: 'homeWaitingTitle',
      tag: t('nav.tickets'),
      title: t('home.waiting.title'),
    })}
    ${
      rows.length
        ? recordList(rows, '#tickets')
        : emptyLine('home.waiting.emptyTitle', 'home.waiting.emptyText', 'statusResolved')
    }
  </section>`;
}

function newsCard({ company }) {
  const rows = DEMO_ANNOUNCEMENTS.map((item) => {
    const from = item.from === 'company' ? companyName(company).outerHTML : esc(t(item.from));
    return `<li class="record">
      <dl class="labelstrip labelstrip--compact">
        ${pair(t('announcement.published'), esc(item.published))}
        ${pair(t('home.news.from'), from)}
      </dl>
      <div class="record__head">
        <h3 class="record__title"><a href="#announcements">${esc(t(item.title))}</a></h3>
        ${
          item.isNew
            ? `<span class="record__aside">
                 <span class="tag tag--highlight">${esc(t('home.news.new'))}</span>
               </span>`
            : ''
        }
      </div>
      ${item.body ? `<p class="record__text">${esc(t(item.body))}</p>` : ''}
    </li>`;
  });

  return `<section class="card home__news" aria-labelledby="homeNewsTitle">
    ${cardHead({
      id: 'homeNewsTitle',
      tag: t('nav.announcements'),
      title: t('home.news.title'),
      href: '#announcements',
      openLabel: t('home.news.openAll'),
    })}
    ${
      rows.length
        ? recordList(rows, '#announcements')
        : emptyLine('home.news.emptyTitle', 'home.news.emptyText')
    }
  </section>`;
}

function peopleCard() {
  const rows = DEMO_PEOPLE.map((person) => {
    const name = t(person.name);
    return `<li class="record">
      <a class="person home__person" href="#directory">
        <span class="avatar" aria-hidden="true">${esc(initials(name))}</span>
        <span class="home__person-text">
          <span class="person__name">${esc(name)}</span>
          <span class="person__role">${esc(t(person.role))}, ${esc(t(person.site))}</span>
        </span>
      </a>
    </li>`;
  });

  // With nobody looked up yet the card is simply the search: no empty state,
  // because the field already says what to do.
  const recent = rows.length
    ? `<div class="stack stack--tight">
         <p class="u-microlabel">${esc(t('home.people.recent'))}</p>
         ${recordList(rows, '#directory')}
       </div>`
    : '';

  return `<section class="card home__people" aria-labelledby="homePeopleTitle">
    ${cardHead({
      id: 'homePeopleTitle',
      tag: t('nav.directory'),
      title: t('home.people.title'),
      href: '#directory',
      openLabel: t('home.people.openAll'),
    })}
    <form class="field" role="search" data-demo-form>
      <label class="field__label" for="homePeopleSearch">${esc(t('home.people.label'))}</label>
      <div class="input-group">
        ${icon('search', 'input-group__icon')}
        <input class="input" type="search" id="homePeopleSearch" autocomplete="off" />
      </div>
    </form>
    ${recent}
  </section>`;
}

/* ---------------------------------------------------------------- render */

/**
 * Renders Home into `root`. Safe to call again: a change of language or of
 * company simply renders the page afresh.
 *
 * @param {HTMLElement} root
 * @param {{ company: object, user: { name: string, firstName: string }, admin: boolean }} ctx
 *   company is the API's record; the user's names are already in the language in use
 */
export function render(root, ctx) {
  const now = new Date();
  root.innerHTML = `<div class="bento home">
    ${banner(ctx, now)}
    ${ticketsCard(ctx)}
    ${roomsCard(ctx)}
    ${waitingCard(ctx)}
    ${newsCard(ctx)}
    ${peopleCard()}
  </div>`;

  // The search has nowhere to go until the directory exists.
  root
    .querySelector('[data-demo-form]')
    ?.addEventListener('submit', (event) => event.preventDefault());

  // Keep the Cairo clock honest while the page stays open.
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    const tick = new Date();
    const time = root.querySelector('[data-cairo-time]');
    const date = root.querySelector('[data-cairo-date]');
    if (!time || !date) {
      clearInterval(clockTimer);
      return;
    }
    time.textContent = cairoTime(tick);
    date.textContent = cairoDate(tick);
  }, 30_000);
}
