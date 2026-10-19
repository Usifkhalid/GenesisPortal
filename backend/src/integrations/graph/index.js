/**
 * integrations/graph — the only door to Microsoft Graph.
 *
 * No module outside this folder may call Graph or hold a Graph token. Callers
 * import `graph()` and get whichever implementation GRAPH_MODE selects, so a
 * feature written against the mock works unchanged against the real tenant.
 *
 * GRAPH_DIRECTORY_MODE picks users and managers apart from the rest: with it
 * real and GRAPH_MODE mock, the directory comes from the tenant (application
 * token, User.Read.All) while mail, calendar and rooms stay mocked (D139).
 */

import { env } from '../../config/env.js';

/**
 * A user as Graph returns it, limited to the fields the portal reads.
 * @typedef {object} GraphUser
 * @property {string} id  the Entra object id
 * @property {string | null} displayName
 * @property {string | null} mail
 * @property {string | null} userPrincipalName
 * @property {string | null} jobTitle
 * @property {string | null} department
 * @property {string | null} companyName
 * @property {string | null} officeLocation
 * @property {string[]} businessPhones
 * @property {string | null} mobilePhone
 * @property {boolean} accountEnabled
 * @property {string | null} [userType]  "Member" or "Guest"; guests are not synced
 */

/**
 * The person a calendar call acts as. With `getAccessToken` the real client
 * makes a delegated call in that person's own calendar; without it (an
 * administrator acting on someone else's meeting) it uses the application's
 * own permission on the organiser's mailbox.
 * @typedef {object} GraphOrganiser
 * @property {string} email
 * @property {string} [entraObjectId]
 * @property {(() => Promise<string>) | null} [getAccessToken]
 */

/**
 * A room mailbox as Exchange lists it.
 * @typedef {object} GraphRoom
 * @property {string} id
 * @property {string} displayName
 * @property {string} emailAddress
 * @property {number | null} capacity
 * @property {string | null} floorLabel
 * @property {string | null} building
 */

/**
 * One event in a calendar. A recurring booking is several, sharing seriesMasterId.
 * @typedef {object} GraphEvent
 * @property {string} id
 * @property {string | null} seriesMasterId
 * @property {string} subject
 * @property {Date} start
 * @property {Date} end
 * @property {string | null} roomEmail
 */

/**
 * A series as Exchange repeats it: weekly on `daysOfWeek` (0 is Sunday) from
 * `startDate` to `endDate`, both Cairo calendar days. "Every working day" is
 * the same thing with the working days.
 * @typedef {object} GraphRecurrence
 * @property {number[]} daysOfWeek
 * @property {string} startDate  "2026-10-25"
 * @property {string} endDate
 */

/**
 * @typedef {object} GraphClient
 * @property {string} mode
 * @property {string} [directoryMode]  set when users and managers come from elsewhere
 * @property {() => Promise<GraphUser[]>} listUsers  every user, all pages
 * @property {(userId: string) => Promise<{ id: string } | null>} getManager
 *   the user's manager, or null when they have none
 * @property {() => Promise<GraphRoom[]>} listRooms  every room mailbox
 * @property {(roomEmails: string[], start: Date, end: Date) =>
 *   Promise<{ roomEmail: string, items: { start: Date, end: Date, status: string, eventId?: string }[] }[]>} getSchedule
 *   when each room is busy in [start, end). `eventId` is the mock's extra; the
 *   real answer has none, and callers must work without it.
 * @property {(input: { organiser: GraphOrganiser, room: { email: string, name: string },
 *   subject: string, start: Date, end: Date, recurrence: GraphRecurrence | null,
 *   attendees: string[], occurrences?: { start: Date, end: Date }[] }) =>
 *   Promise<{ id: string, seriesMasterId: string | null, events: GraphEvent[] }>} createEvent
 *   creates the event in the organiser's calendar with the room as a resource
 *   attendee. `occurrences` is every occurrence the portal worked out; the
 *   answer lists one event per occurrence. Throws GraphError room_conflict.
 * @property {(input: { organiser: GraphOrganiser, eventId: string, subject?: string,
 *   start?: Date, end?: Date, room?: { email: string, name: string } }) =>
 *   Promise<GraphEvent>} updateEvent  one occurrence; `room` moves it to another room
 * @property {(input: { organiser: GraphOrganiser, eventId: string, scope?: 'one' | 'series',
 *   from?: Date }) => Promise<{ cancelled: string[] }>} cancelEvent
 *   one occurrence, or the rest of its series from `from`
 * @property {(input: { organiser: GraphOrganiser, start: Date, end: Date }) =>
 *   Promise<GraphEvent[]>} listMyEvents  the organiser's own events in a range
 * @property {(input: { from: string, to: string[], subject: string, html: string,
 *   text?: string }) => Promise<{ id: string | null }>} sendMail  one message, sent
 *   as the no-reply mailbox `from` (real: POST /users/{from}/sendMail with the
 *   application's Mail.Send permission; mock: a file in backend/mock/outbox/)
 * @property {(input: { userEmail: string, topic: string, text: string,
 *   link?: string }) => Promise<{ delivered: boolean }>} sendActivityNotification
 *   Teams activity feed. A stub in both clients until the Teams app exists.
 * @property {() => Promise<object[]>} [listOutbox]  mock only, newest first
 * @property {() => Promise<void>} [clearOutbox]  mock only
 */

/** @type {GraphClient | undefined} */
let instance;

/**
 * A new client for GRAPH_MODE.
 * @param {object} [options]
 * @param {object[]} [options.memoryCalendar]  mock only: keep calendar events in
 *   this array instead of the MockCalendarEvent table (the portal in memory)
 * @param {{ add: Function, list: Function, clear: Function }} [options.outbox]  mock
 *   only: where sent mail goes instead of backend/mock/outbox/
 * @returns {Promise<GraphClient>}
 */
export async function createGraph({ memoryCalendar, outbox, config = env } = {}) {
  const directoryMode = config.GRAPH_DIRECTORY_MODE ?? config.GRAPH_MODE;
  if (config.GRAPH_MODE === 'real' && directoryMode === 'real') {
    return (await import('./real.js')).createClient();
  }

  const [{ createClient }, { createMemoryCalendar }] = await Promise.all([
    import('./mock.js'),
    import('./mock-calendar.js'),
  ]);
  const mock = createClient(undefined, {
    ...(memoryCalendar ? { calendar: createMemoryCalendar(memoryCalendar) } : {}),
    ...(outbox ? { outbox } : {}),
  });
  if (config.GRAPH_MODE === 'real') {
    // The real tenant for mail, calendar and rooms; the mock directory.
    const real = (await import('./real.js')).createClient();
    return withDirectory(real, mock);
  }
  if (directoryMode === 'real') {
    return withDirectory(mock, (await import('./real.js')).createClient());
  }
  return mock;
}

/**
 * `base` with users and managers taken from `directory`.
 * @param {GraphClient} base
 * @param {GraphClient} directory
 * @returns {GraphClient}
 */
export function withDirectory(base, directory) {
  return {
    ...base,
    directoryMode: directory.mode,
    listUsers: () => directory.listUsers(),
    getManager: (userId) => directory.getManager(userId),
    ...(directory.applicationPermissions
      ? { applicationPermissions: directory.applicationPermissions }
      : {}),
  };
}

/** The process's client. @returns {Promise<GraphClient>} */
export async function graph() {
  instance ??= await createGraph();
  return instance;
}
