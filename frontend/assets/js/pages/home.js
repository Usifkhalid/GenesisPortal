/**
 * pages/home.js — the Home page.
 *
 * A welcome banner over a bento grid of the four jobs: tickets, rooms,
 * announcements and the directory. Loaded on demand by router.js.
 *
 * Real: the person, the company and the Cairo date and time, all from the
 * session (GET /api/me). They are on screen at once.
 *
 * Real: the news card (announcements). DEMO: the other four cards, whose
 * modules have no API yet, so each `load` below hands back demo-data.js.
 * Everything around `load` is already the real thing: a card shows a skeleton
 * while its list loads, then its rows, its own one-line empty state, or its own
 * failure with a retry. Replacing a `load` with an api() call is the whole of
 * wiring a card up.
 */

import { api } from '../api.js';
import { formatDate } from '../format.js';
import { t, getLocale } from '../i18n.js';
import { audienceLabel, dirOf, shownLanguage, textOf } from './announcements/shared.js';
import { esc } from '../html.js';
import { icon } from '../components/icons.js';
import { companyName } from '../components/company-mark.js';
import { initials } from '../components/initials.js';
import { recordSkeleton } from '../components/skeleton.js';
import {
  DEMO_TICKETS,
  DEMO_BOOKINGS,
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
function emptyLine({ title, text, mark = 'blankLabel' }) {
  return `<div class="empty empty--inline">
    ${icon(mark, 'empty__mark')}
    <div class="empty__copy">
      <p class="empty__title">${esc(t(title))}</p>
      <p class="empty__text">${esc(t(text))}</p>
    </div>
  </div>`;
}

/** What a card says when its list could not be fetched: the same line, and a way back. */
function failedLine() {
  return `<div class="empty empty--inline home__failed" role="status">
    ${icon('statusOverdue', 'empty__mark')}
    <div class="empty__copy">
      <p class="empty__title">${esc(t('home.failed.title'))}</p>
      <p class="empty__text">${esc(t('home.failed.text'))}</p>
    </div>
    <button type="button" class="btn btn--secondary btn--sm" data-retry>
      <span class="btn__label">${esc(t('action.retry'))}</span>
    </button>
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

function ticketRow({ company }, ticket) {
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

function bookingRow({ company }, booking) {
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
}

function newsRow(_ctx, item) {
  const lang = shownLanguage(item);
  const summary = textOf(item, 'summary', lang);
  return `<li class="record">
    <dl class="labelstrip labelstrip--compact">
      ${pair(t('announcement.published'), esc(formatDate(item.publishAt)))}
      ${pair(t('home.news.from'), esc(audienceLabel(item)))}
    </dl>
    <div class="record__head">
      <h3 class="record__title" lang="${lang}" dir="${dirOf(lang)}"><a href="#announcements/${esc(
        item.id
      )}">${esc(textOf(item, 'title', lang))}</a></h3>
      ${
        item.isRead === false
          ? `<span class="record__aside">
               <span class="tag tag--highlight">${esc(t('ann.card.unread'))}</span>
             </span>`
          : ''
      }
    </div>
    ${summary ? `<p class="record__text" lang="${lang}" dir="${dirOf(lang)}">${esc(summary)}</p>` : ''}
  </li>`;
}

function personRow(_ctx, person) {
  const name = t(person.name);
  return `<li class="record">
    <a class="person home__person" href="#directory">
      <span class="avatar" aria-hidden="true">${esc(initials(name))}</span>
      <span class="home__person-text">
        <span class="person__name">${esc(name)}</span>
        <span class="person__role">${esc(
          t('home.people.roleAt', { role: t(person.role), site: t(person.site) })
        )}</span>
      </span>
    </a>
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

/**
 * The search is real markup with nowhere real to go yet: it hands the words
 * to the directory's address, which that module will read.
 */
function peopleSearch() {
  return `<form class="field" role="search" data-people-search>
    <label class="field__label" for="homePeopleSearch">${esc(t('home.people.label'))}</label>
    <div class="input-group">
      ${icon('search', 'input-group__icon')}
      <input class="input" type="search" id="homePeopleSearch" name="q" autocomplete="off" />
    </div>
  </form>`;
}

/**
 * Home's cards, in reading order: what is waiting on the person, where they
 * have to be next, what they have open, then the two things they come to look
 * up. On a phone that is the order down the page. For each:
 *   load(ctx)  → a promise of the card's records (DEMO for all five, see top)
 *   row        → one record's markup
 *   empty      → what the card says with no records; absent when the card
 *                has something else to offer, as the directory has its search
 */
const CARDS = [
  {
    key: 'waiting',
    tag: 'nav.tickets',
    title: 'home.waiting.title',
    more: '#tickets',
    load: async () => DEMO_WAITING, // DEMO
    row: ticketRow,
    skeletonRows: 1,
    empty: {
      title: 'home.waiting.emptyTitle',
      text: 'home.waiting.emptyText',
      mark: 'statusResolved',
    },
  },
  {
    key: 'rooms',
    tag: 'nav.rooms',
    title: 'home.rooms.title',
    href: '#rooms',
    openLabel: 'home.rooms.openAll',
    load: async () => DEMO_BOOKINGS, // DEMO
    row: bookingRow,
    skeletonRows: 2,
    empty: { title: 'home.rooms.emptyTitle', text: 'home.rooms.emptyText' },
  },
  {
    key: 'tickets',
    tag: 'nav.tickets',
    title: 'home.tickets.title',
    count: 'home.tickets.count',
    href: '#tickets',
    openLabel: 'home.tickets.openAll',
    // DEMO. What is late comes first; after that, the order the queue gave them.
    load: async () =>
      [...DEMO_TICKETS].sort((a, b) => (b.status === 'overdue') - (a.status === 'overdue')),
    row: ticketRow,
    empty: { title: 'home.tickets.emptyTitle', text: 'home.tickets.emptyText' },
  },
  {
    key: 'people',
    tag: 'nav.directory',
    title: 'home.people.title',
    href: '#directory',
    openLabel: 'home.people.openAll',
    lead: peopleSearch,
    listLabel: 'home.people.recent',
    load: async () => DEMO_PEOPLE, // DEMO
    row: personRow,
    skeletonRows: 3,
    skeletonShape: 'person',
  },
  {
    key: 'news',
    tag: 'nav.announcements',
    title: 'home.news.title',
    href: '#announcements',
    openLabel: 'home.news.openAll',
    // The three newest for this person, pinned first (the server orders them).
    load: async () => (await api('/api/announcements?pageSize=3', { quiet: true })).items,
    row: newsRow,
    empty: { title: 'home.news.emptyTitle', text: 'home.news.emptyText' },
  },
];

/**
 * @typedef {{ status: 'loading' } | { status: 'failed' }
 *   | { status: 'ready', records: object[] }} CardState
 */

/** @param {(typeof CARDS)[number]} card  @param {CardState} state */
function headHtml(card, state) {
  const count = state.status === 'ready' ? state.records.length : 0;
  return cardHead({
    id: `home-${card.key}-title`,
    tag: t(card.tag),
    title: t(card.title),
    count: card.count && count ? t(card.count, { count }) : '',
    href: card.href,
    openLabel: card.openLabel ? t(card.openLabel) : '',
  });
}

/** A card's list in one of its states: loading, failed, empty or filled. */
function bodyHtml(card, ctx, state) {
  if (state.status === 'loading') {
    return `<p class="u-visually-hidden">${esc(t('loading.label'))}</p>
      ${recordSkeleton(card.skeletonRows ?? 3, card.skeletonShape)}`;
  }
  if (state.status === 'failed') return failedLine();
  if (state.records.length === 0) return card.empty ? emptyLine(card.empty) : '';

  const list = recordList(
    state.records.map((record) => card.row(ctx, record)),
    card.more ?? card.href
  );
  return card.listLabel
    ? `<div class="stack stack--tight">
         <p class="u-microlabel">${esc(t(card.listLabel))}</p>
         ${list}
       </div>`
    : list;
}

function cardHtml(card, ctx, state) {
  return `<section class="card home__${card.key}" data-card="${card.key}" tabindex="-1"
      aria-labelledby="home-${card.key}-title" aria-busy="${state.status === 'loading'}">
    ${headHtml(card, state)}
    ${card.lead ? card.lead() : ''}
    <div class="home__body" data-card-body>${bodyHtml(card, ctx, state)}</div>
  </section>`;
}

/**
 * Loads one card's records and redraws its head and its list in place; what
 * sits between them (the directory's search) is left alone, with whatever has
 * been typed into it. Each card is on its own: a slow or failed list never
 * holds up the others.
 */
async function fillCard(home, card, ctx) {
  const shown = home.querySelector(`[data-card="${card.key}"]`);

  /** @param {CardState} state */
  const show = (state) => {
    shown.setAttribute('aria-busy', String(state.status === 'loading'));
    shown.querySelector('.card__header').outerHTML = headHtml(card, state);
    shown.querySelector('[data-card-body]').innerHTML = bodyHtml(card, ctx, state);
  };

  try {
    show({ status: 'ready', records: await card.load(ctx) });
  } catch {
    show({ status: 'failed' });
    shown.querySelector('[data-retry]').addEventListener('click', () => {
      // The button is about to be redrawn away: keep the keyboard on its card.
      shown.focus();
      show({ status: 'loading' });
      fillCard(home, card, ctx);
    });
  }
}

/* ---------------------------------------------------------------- render */

/**
 * Renders Home into `root`. Safe to call again: a change of language or of
 * company simply renders the page afresh.
 *
 * @param {HTMLElement} root
 * @param {{ company: object, user: { name: string, firstName: string }, admin: boolean }} ctx
 *   company is the API's record; the user's names are already in the language in use
 * @returns {() => void} stops the clock when the page is left
 */
export function render(root, ctx) {
  const now = new Date();
  const home = document.createElement('div');
  home.className = 'bento home';
  home.innerHTML =
    banner(ctx, now) + CARDS.map((card) => cardHtml(card, ctx, { status: 'loading' })).join('');
  root.replaceChildren(home);

  home.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-people-search]');
    if (!form) return;
    event.preventDefault();
    const words = new FormData(form).get('q').trim();
    location.hash = words ? `#directory?q=${encodeURIComponent(words)}` : '#directory';
  });

  for (const card of CARDS) fillCard(home, card, ctx);

  // Keep the Cairo clock honest while the page stays open.
  const clock = setInterval(() => {
    const tick = new Date();
    home.querySelector('[data-cairo-time]').textContent = cairoTime(tick);
    home.querySelector('[data-cairo-date]').textContent = cairoDate(tick);
  }, 30_000);

  return () => clearInterval(clock);
}
