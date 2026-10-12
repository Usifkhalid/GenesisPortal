/**
 * demo-data.js — static stand-ins for what the API will return.
 *
 * Nothing here is real: the news and the colleagues are placeholders so Home
 * can be seen and reviewed before the modules exist. Tickets, bookings and
 * announcements now come from their APIs.
 * The signed-in person and their companies are real now: see auth.js. Every display string is an i18n key
 * under "demo.", so the demo reads properly in both languages; the real
 * records will carry their own English and Arabic values.
 *
 * Delete this file when the last module that imports it has an API.
 */

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
