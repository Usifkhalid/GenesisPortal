/**
 * demo-data.js — static stand-ins for what the API will return.
 *
 * Nothing here is real: the tickets, the bookings, the news and the colleagues
 * are placeholders so Home can be seen and reviewed before the modules exist.
 * The signed-in person and their companies are real now: see auth.js. Every display string is an i18n key
 * under "demo.", so the demo reads properly in both languages; the real
 * records will carry their own English and Arabic values.
 *
 * Delete this file when the last module that imports it has an API.
 */

/**
 * The user's open tickets. `seq` becomes the ticket number, prefixed with the
 * company code and the year. `due` is Cairo time; `day` is set when it is
 * not today, as a key under "day." so it reads in both languages.
 */
export const DEMO_TICKETS = [
  { seq: 42, priority: 'P2', due: '14:30', subject: 'demo.tickets.t1', status: 'inProgress' },
  {
    seq: 39,
    priority: 'P1',
    due: '12:00',
    day: 'thu',
    subject: 'demo.tickets.t2',
    status: 'overdue',
  },
  {
    seq: 31,
    priority: 'P3',
    due: '16:00',
    day: 'thu',
    subject: 'demo.tickets.t3',
    status: 'open',
  },
  {
    seq: 27,
    priority: 'P3',
    due: '10:00',
    day: 'sun',
    subject: 'demo.tickets.t4',
    status: 'inProgress',
  },
];

/** The user's next room bookings. `today` picks the "Today" label. */
export const DEMO_BOOKINGS = [
  { room: 204, floor: '2', today: true, time: '15:00–16:00', title: 'demo.bookings.b1' },
  { room: 101, floor: '1', day: 'thu', time: '10:00–11:30', title: 'demo.bookings.b2' },
];

export const DEMO_ANNOUNCEMENTS = [
  {
    published: '07/10/2026',
    from: 'app.group',
    title: 'demo.news.n1.title',
    body: 'demo.news.n1.body',
    isNew: true,
  },
  { published: '05/10/2026', from: 'company', title: 'demo.news.n2.title' },
  { published: '01/10/2026', from: 'app.group', title: 'demo.news.n3.title' },
];

/** Colleagues the user looked up recently. */
export const DEMO_PEOPLE = [
  { name: 'demo.people.p1.name', role: 'demo.people.p1.role', site: 'demo.people.p1.site' },
  { name: 'demo.people.p2.name', role: 'demo.people.p2.role', site: 'demo.people.p2.site' },
  { name: 'demo.people.p3.name', role: 'demo.people.p3.role', site: 'demo.people.p3.site' },
];

/** Tickets waiting on the user's own reply. Empty, to show the small empty state. */
export const DEMO_WAITING = [];

/** A ticket number as the portal writes it: GEN-2026-00042. */
export function ticketNumber(companyCode, seq) {
  return `${companyCode}-2026-${String(seq).padStart(5, '0')}`;
}
