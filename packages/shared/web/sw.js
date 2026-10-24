/**
 * sw.js — the portal's service worker: the shell opens with no signal.
 *
 * Served by backend/src/lib/service-worker.js, which fills in VERSION (a hash
 * of every frontend file) and PRECACHE (what the shell needs). The raw file
 * below is valid JavaScript, so it can be linted as it is.
 *
 *   shell, CSS, JS, i18n, fonts, icons   cache first, in a cache named for VERSION
 *   API reads (GET /api/*)               network first; after NETWORK_WAIT_MS
 *                                        the last saved answer, when there is one
 *   everything that changes state        not touched: the page says "no signal"
 *   a page that is not saved             offline.html
 *
 * A new VERSION installs beside the old one and waits. The page offers the
 * update (components/status-banner.js); on "Update" it posts SKIP_WAITING, the
 * old caches are deleted on activation and the page reloads, so a person is
 * never switched to new scripts in the middle of filling in a form.
 *
 * Saved API answers are one person's data on a device that may be shared.
 * They are deleted on sign-out and when the login page opens (pwa.js), and
 * here when any API answer is a 401.
 */

const VERSION = '__VERSION__';
const PRECACHE = /*__PRECACHE__*/ [];

const PREFIX = 'portal-';
const STATIC_CACHE = `${PREFIX}static-${VERSION}`;
const API_CACHE = `${PREFIX}api-${VERSION}`;
const OFFLINE_PAGE = '/offline.html';
/** On a weak connection a saved answer now beats a fresh one in half a minute. */
const NETWORK_WAIT_MS = 6000;

const SHELL = new Set(PRECACHE);

/* ---------------------------------------------------------------- lifecycle */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // "reload": the HTTP cache may hold the previous version's file.
      const fresh = (url) => new Request(url, { cache: 'reload' });
      try {
        await cache.addAll(PRECACHE.map(fresh));
      } catch {
        // One file dropped on a weak connection must not leave the portal
        // with no worker at all: keep what arrives, the rest is saved when
        // it is first used. The three pages of the shell are the exception.
        await Promise.all(PRECACHE.map((url) => cache.add(fresh(url)).catch(() => {})));
        for (const url of ['/', '/login.html', OFFLINE_PAGE]) {
          if (!(await cache.match(url))) throw new Error(`could not save ${url}`);
        }
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== STATIC_CACHE && name !== API_CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();

  // The page names the font files it has already downloaded (the ones for the
  // language in use); they come from the browser's own cache, not the network.
  if (event.data?.type === 'SAVE_FONTS' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        for (const url of event.data.urls) {
          const path = new URL(url, self.location.origin).pathname;
          if (!path.startsWith('/assets/fonts/') || (await cache.match(path))) continue;
          await cache.add(path).catch(() => {});
        }
      })()
    );
  }
});

/* ------------------------------------------------------------------ fetch */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  // Sign-in must always be the server's own answer, and so must a worker update.
  if (path === '/sw.js' || path.startsWith('/auth/') || path.startsWith('/api/auth/')) {
    if (request.mode === 'navigate') event.respondWith(navigate(request, url));
    return;
  }
  // The mocked mailbox of development; never worth keeping.
  if (path.startsWith('/api/dev')) return;

  if (path.startsWith('/api/')) {
    event.respondWith(networkFirst(event));
  } else if (request.mode === 'navigate') {
    event.respondWith(navigate(request, url));
  } else if (path.startsWith('/assets/') || SHELL.has(path)) {
    event.respondWith(cacheFirst(request, event));
  }
});

/**
 * Which saved page an address is: the shell is one file for "/" and "/index.html",
 * and for the helpdesk's published links /new and /queue (the server answers
 * them with that same page).
 */
function shellKey(path) {
  if (path === '/' || path === '/index.html' || path === '/new' || path === '/queue')
    return '/';
  if (path === '/login' || path === '/login.html') return '/login.html';
  return path;
}

async function navigate(request, url) {
  const key = shellKey(url.pathname);
  if (SHELL.has(key) && !url.pathname.startsWith('/auth/')) {
    const saved = await (await caches.open(STATIC_CACHE)).match(key);
    if (saved) return saved;
  }
  try {
    return await fetch(request);
  } catch {
    return (await (await caches.open(STATIC_CACHE)).match(OFFLINE_PAGE)) ?? Response.error();
  }
}

async function cacheFirst(request, event) {
  const cache = await caches.open(STATIC_CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;

  const response = await fetch(request);
  if (response.ok) event.waitUntil(cache.put(request, response.clone()));
  return response;
}

async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(API_CACHE);

  const network = fetch(request).then((response) => {
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    else if (response.status === 401) event.waitUntil(forgetSavedAnswers());
    return response;
  });
  // If the timer wins and the network later fails, nobody is left to hear it.
  network.catch(() => {});

  const saved = async () => {
    const hit = await cache.match(request);
    if (hit) tellPages({ type: 'portal:saved-answer' });
    return hit;
  };
  const patience = new Promise((resolve) =>
    setTimeout(() => resolve(saved()), NETWORK_WAIT_MS)
  );

  try {
    return (await Promise.race([network, patience])) ?? (await network);
  } catch {
    return (await saved()) ?? Response.error();
  }
}

async function forgetSavedAnswers() {
  for (const name of await caches.keys()) {
    if (name.startsWith(`${PREFIX}api-`)) await caches.delete(name);
  }
}

async function tellPages(message) {
  for (const client of await self.clients.matchAll({ type: 'window' }))
    client.postMessage(message);
}
