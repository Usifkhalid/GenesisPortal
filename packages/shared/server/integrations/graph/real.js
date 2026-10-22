/**
 * Graph, live. Talks to the "mgholding" tenant with the client-credentials
 * flow through @azure/msal-node, using ENTRA_*.
 *
 * Tenant access has not been granted yet: this is written to the documented
 * Graph contract and is proven against the real tenant only in session 19.
 * Paging follows @odata.nextLink; a 429 or 503 waits for Retry-After and tries
 * again, a bounded number of times.
 *
 * Calendar calls come in two kinds. Reading rooms and their free/busy uses the
 * application's own permission (Place.Read.All, Calendars.Read). Booking is
 * delegated: the event is created in the signed-in person's calendar
 * (/me/events) with the room as a resource attendee, using that person's token
 * (Calendars.ReadWrite), so Exchange applies the room's own booking policy and
 * the meeting is theirs in Outlook. When an administrator changes someone
 * else's meeting there is no token of the organiser's to use, and the call goes
 * to /users/{organiser}/… with the application permission instead. Handing a
 * person's token to this client (the session's MSAL cache) is session 19's
 * work, as is every call below being run against a tenant.
 */

import { ConfidentialClientApplication } from '@azure/msal-node';

import { appEnv } from '../../config/runtime.js';
import { addDaysYmd, cairoWallOf, formatCairo } from '../../lib/time.js';
import { GraphError } from './errors.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SELECT = [
  'id',
  'displayName',
  'mail',
  'userPrincipalName',
  'jobTitle',
  'department',
  'companyName',
  'officeLocation',
  'businessPhones',
  'mobilePhone',
  'accountEnabled',
  'userType',
].join(',');
/** Windows time zone name Exchange knows Cairo by; it carries the DST rules. */
const EXCHANGE_ZONE = 'Egypt Standard Time';
const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
/** getSchedule's own limits: 62 days a call (60 used), and a batch of mailboxes. */
const SCHEDULE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const SCHEDULE_BATCH = 20;
const MAX_ATTEMPTS = 5;
const DEFAULT_WAIT_MS = 2000;
const MAX_WAIT_MS = 120_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds, or an HTTP date, from a Retry-After header. */
export function retryAfterMs(header, fallback = DEFAULT_WAIT_MS) {
  if (!header) return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), MAX_WAIT_MS);
  const at = Date.parse(header);
  return Number.isNaN(at) ? fallback : Math.min(Math.max(at - Date.now(), 0), MAX_WAIT_MS);
}

/**
 * @param {object} [deps]  replacements for tests
 * @param {typeof fetch} [deps.fetch]
 * @param {() => Promise<string>} [deps.getToken]
 * @param {(ms: number) => Promise<void>} [deps.wait]
 * @returns {import('./index.js').GraphClient}
 */
export function createClient(deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const wait = deps.wait ?? sleep;

  let msal;
  const getToken =
    deps.getToken ??
    (async () => {
      msal ??= new ConfidentialClientApplication({
        auth: {
          clientId: appEnv().ENTRA_CLIENT_ID,
          clientSecret: appEnv().ENTRA_CLIENT_SECRET,
          authority: `https://login.microsoftonline.com/${appEnv().ENTRA_TENANT_ID}`,
        },
      });
      const result = await msal.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default'],
      });
      return result.accessToken;
    });

  /**
   * One request with 429/503 handling. Returns the parsed body, null for a 404
   * and for an empty answer. `token` is a person's delegated token; without it
   * the application's own is used. Times come back in UTC.
   */
  async function call(method, url, { token, body } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      const response = await doFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token ?? (await getToken())}`,
          Accept: 'application/json',
          Prefer: 'outlook.timezone="UTC"',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.ok) return response.status === 204 ? null : response.json();
      if (response.status === 404) return null;
      const retryable = response.status === 429 || response.status === 503;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        // Graph's error code (e.g. Authorization_RequestDenied) says what to
        // fix; its message is left out, as it can carry internals.
        const code = await response
          .json()
          .then((b) => b?.error?.code)
          .catch(() => null);
        const err = new Error(
          `Graph request failed: ${response.status}${code ? ` ${String(code).slice(0, 80)}` : ''}`
        );
        err.status = response.status;
        throw err;
      }
      await wait(retryAfterMs(response.headers.get('Retry-After')));
    }
  }

  const get = (url) => call('GET', url);

  /** Every page of a collection. */
  async function all(url, options) {
    const out = [];
    while (url) {
      const page = await call('GET', url, options);
      if (!page) break;
      out.push(...page.value);
      url = page['@odata.nextLink'] ?? null;
    }
    return out;
  }

  /** Where an organiser's calendar is, and with whose token. */
  async function calendarOf(organiser) {
    if (organiser.getAccessToken) {
      return { base: `${GRAPH}/me`, token: await organiser.getAccessToken() };
    }
    return { base: `${GRAPH}/users/${encodeURIComponent(organiser.email)}`, token: undefined };
  }

  /** Graph's { dateTime, timeZone } for an instant, on Cairo's clock. */
  const cairoTime = (date) => ({
    dateTime: formatCairo(date).replace(' ', 'T'),
    timeZone: EXCHANGE_ZONE,
  });
  /** A Graph dateTime answered in UTC (see the Prefer header) as a Date. */
  const utc = (value) => new Date(`${String(value.dateTime).replace(/\.\d+$/, '')}Z`);
  const eventOf = (e) => ({
    id: e.id,
    seriesMasterId: e.seriesMasterId ?? null,
    subject: e.subject ?? '',
    start: utc(e.start),
    end: utc(e.end),
    roomEmail: e.location?.locationUri ?? e.location?.uniqueId ?? null,
  });

  return {
    mode: 'real',

    /**
     * The application permissions (app roles) Entra put in the app's own
     * token, e.g. ["User.Read.All"]: what admin consent actually granted.
     * For diagnosing a 403; the token itself never leaves this function.
     */
    async applicationPermissions() {
      const [, payload] = String(await getToken()).split('.');
      try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return Array.isArray(claims.roles) ? claims.roles.map(String).sort() : [];
      } catch {
        return [];
      }
    },

    async listUsers() {
      const users = [];
      let url = `${GRAPH}/users?$select=${SELECT}&$top=100`;
      while (url) {
        const page = await get(url);
        if (!page) throw new Error('Graph returned no user page');
        users.push(...page.value);
        url = page['@odata.nextLink'] ?? null;
      }
      return users;
    },

    async getManager(userId) {
      const manager = await get(
        `${GRAPH}/users/${encodeURIComponent(userId)}/manager?$select=id,displayName,mail`
      );
      return manager?.id ? manager : null;
    },

    async listRooms() {
      const rooms = await all(`${GRAPH}/places/microsoft.graph.room?$top=100`);
      return rooms.map((room) => ({
        id: room.id,
        displayName: room.displayName,
        emailAddress: String(room.emailAddress ?? '').toLowerCase(),
        capacity: room.capacity ?? null,
        floorLabel: room.floorLabel ?? null,
        building: room.building ?? null,
      }));
    },

    async getSchedule(roomEmails, start, end) {
      const items = new Map(roomEmails.map((email) => [email, []]));
      for (let from = start.getTime(); from < end.getTime(); from += SCHEDULE_WINDOW_MS) {
        const to = Math.min(from + SCHEDULE_WINDOW_MS, end.getTime());
        for (let i = 0; i < roomEmails.length; i += SCHEDULE_BATCH) {
          const schedules = roomEmails.slice(i, i + SCHEDULE_BATCH);
          const answer = await call(
            'POST',
            `${GRAPH}/users/${encodeURIComponent(schedules[0])}/calendar/getSchedule`,
            {
              body: {
                schedules,
                startTime: {
                  dateTime: new Date(from).toISOString().slice(0, 19),
                  timeZone: 'UTC',
                },
                endTime: { dateTime: new Date(to).toISOString().slice(0, 19), timeZone: 'UTC' },
                availabilityViewInterval: 15,
              },
            }
          );
          for (const schedule of answer?.value ?? []) {
            const list = items.get(String(schedule.scheduleId).toLowerCase());
            if (!list) continue;
            for (const item of schedule.scheduleItems ?? []) {
              if (item.status === 'free') continue;
              list.push({ start: utc(item.start), end: utc(item.end), status: item.status });
            }
          }
        }
      }
      return roomEmails.map((roomEmail) => ({
        roomEmail,
        items: items.get(roomEmail).sort((a, b) => a.start - b.start),
      }));
    },

    async createEvent({ organiser, room, subject, start, end, recurrence, attendees }) {
      if (!organiser.getAccessToken) throw new GraphError('delegated_token_missing');
      const { base, token } = await calendarOf(organiser);
      const created = await call('POST', `${base}/events`, {
        token,
        body: {
          subject,
          start: cairoTime(start),
          end: cairoTime(end),
          location: { displayName: room.name, locationEmailAddress: room.email },
          attendees: [
            { emailAddress: { address: room.email, name: room.name }, type: 'resource' },
            ...(attendees ?? []).map((address) => ({
              emailAddress: { address },
              type: 'required',
            })),
          ],
          ...(recurrence
            ? {
                recurrence: {
                  pattern: {
                    type: 'weekly',
                    interval: 1,
                    daysOfWeek: recurrence.daysOfWeek.map((d) => DAY_NAMES[d]),
                    firstDayOfWeek: 'sunday',
                  },
                  range: {
                    type: 'endDate',
                    startDate: recurrence.startDate,
                    endDate: recurrence.endDate,
                    recurrenceTimeZone: EXCHANGE_ZONE,
                  },
                },
              }
            : {}),
        },
      });
      if (!created?.id) throw new Error('Graph did not return the event it created');
      if (!recurrence)
        return { id: created.id, seriesMasterId: null, events: [eventOf(created)] };

      // The portal keeps one reference per occurrence: ask Exchange for them.
      const from = `${recurrence.startDate}T00:00:00`;
      const to = `${addDaysYmd(recurrence.endDate, 2)}T00:00:00`;
      const instances = await all(
        `${base}/events/${encodeURIComponent(created.id)}/instances?startDateTime=${from}&endDateTime=${to}&$top=100`,
        { token }
      );
      return {
        id: created.id,
        seriesMasterId: created.id,
        events: instances.map((e) => ({ ...eventOf(e), seriesMasterId: created.id })),
      };
    },

    async updateEvent({ organiser, eventId, subject, start, end, room }) {
      const { base, token } = await calendarOf(organiser);
      let roomChange = {};
      if (room) {
        // Swap the room resource among the attendees, keep the people.
        const current = await call(
          'GET',
          `${base}/events/${encodeURIComponent(eventId)}?$select=attendees`,
          { token }
        );
        if (!current) throw new GraphError('event_not_found');
        roomChange = {
          location: { displayName: room.name, locationEmailAddress: room.email },
          attendees: [
            ...(current.attendees ?? []).filter((a) => a.type !== 'resource'),
            { emailAddress: { address: room.email, name: room.name }, type: 'resource' },
          ],
        };
      }
      const updated = await call('PATCH', `${base}/events/${encodeURIComponent(eventId)}`, {
        token,
        body: {
          ...(subject === undefined ? {} : { subject }),
          ...(start ? { start: cairoTime(start) } : {}),
          ...(end ? { end: cairoTime(end) } : {}),
          ...roomChange,
        },
      });
      if (!updated) throw new GraphError('event_not_found');
      return eventOf(updated);
    },

    async cancelEvent({ organiser, eventId, scope = 'one', from }) {
      const { base, token } = await calendarOf(organiser);
      const path = (id) => `${base}/events/${encodeURIComponent(id)}`;

      const event = await call('GET', `${path(eventId)}?$select=id,seriesMasterId`, { token });
      if (!event) throw new GraphError('event_not_found');

      if (scope !== 'series' || !event.seriesMasterId) {
        await call('POST', `${path(eventId)}/cancel`, { token, body: {} });
        return { cancelled: [eventId] };
      }

      // The rest of the series: end it the day before `from`, which sends the
      // cancellations for what follows and keeps what has already happened.
      const master = await call('GET', `${path(event.seriesMasterId)}?$select=id,recurrence`, {
        token,
      });
      if (!master?.recurrence) throw new GraphError('event_not_found');
      const lastDay = addDaysYmd(cairoWallOf(from ?? new Date()).ymd, -1);
      if (lastDay < master.recurrence.range.startDate) {
        await call('POST', `${path(master.id)}/cancel`, { token, body: {} });
      } else {
        await call('PATCH', path(master.id), {
          token,
          body: {
            recurrence: {
              ...master.recurrence,
              range: { ...master.recurrence.range, type: 'endDate', endDate: lastDay },
            },
          },
        });
      }
      return { cancelled: [eventId] };
    },

    async listMyEvents({ organiser, start, end }) {
      const { base, token } = await calendarOf(organiser);
      const events = await all(
        `${base}/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}` +
          '&$select=id,subject,start,end,seriesMasterId,isCancelled,location&$top=100',
        { token }
      );
      return events.filter((e) => !e.isCancelled).map(eventOf);
    },

    /**
     * One message as the no-reply mailbox, with the application's own
     * Mail.Send permission. Graph answers 202 with no body; the message is not
     * kept in that mailbox's Sent Items.
     */
    async sendMail({ from, to, subject, html }) {
      if (!to?.length) throw new GraphError('no_recipient', 'A message needs a recipient.');
      await call('POST', `${GRAPH}/users/${encodeURIComponent(from)}/sendMail`, {
        body: {
          message: {
            subject,
            body: { contentType: 'HTML', content: html },
            toRecipients: to.map((address) => ({ emailAddress: { address } })),
          },
          saveToSentItems: false,
        },
      });
      return { id: null };
    },

    /**
     * Teams activity feed (POST /users/{id}/teamwork/sendActivityNotification)
     * needs the portal's Teams app installed for the person. Not built: the
     * channel preference does not offer it yet.
     */
    async sendActivityNotification() {
      throw new GraphError(
        'not_implemented',
        'Teams activity notifications are not built yet.'
      );
    },
  };
}
