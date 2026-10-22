/**
 * pwa.js — the browser side of the offline worker (frontend/sw.js).
 *
 * Registers the worker once the page has loaded, so it never competes with the
 * first paint for a weak connection, and reports the two things a person needs
 * to hear about: a saved answer was shown instead of a fresh one, and a new
 * version of the portal is ready.
 *
 * Whether to install the worker is the server's call (`serviceWorker` in
 * GET /api/me and GET /api/auth/config). Where it is off (development) a
 * worker left behind by an earlier run is removed, with what it saved, so it
 * cannot keep serving old files.
 */

const API_CACHE_PREFIX = 'portal-api-';

/**
 * @param {object} options
 * @param {boolean} options.enabled  the server's answer
 * @param {() => void} [options.onSavedAnswer]  an answer came from the device
 * @param {(apply: () => void) => void} [options.onUpdateReady]  `apply` installs it
 */
export function startServiceWorker({ enabled, onSavedAnswer, onUpdateReady }) {
  if (!('serviceWorker' in navigator)) return;
  if (!enabled) {
    retireServiceWorker();
    return;
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'portal:saved-answer') onSavedAnswer?.();
  });

  // Reload once, and only because the person asked for the update.
  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updating) location.reload();
  });

  const offer = (worker) => {
    onUpdateReady?.(() => {
      updating = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
  };

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      saveFonts(registration);
      // A version that was already waiting when this page opened.
      if (registration.waiting && navigator.serviceWorker.controller)
        offer(registration.waiting);

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
        });
      });
    } catch {
      // Worker off, or the browser refused (private mode): the portal still works.
    }
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** Removes a worker and its caches, if this browser has either. */
async function retireServiceWorker() {
  try {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      await registration.unregister();
    }
    for (const name of await caches.keys()) {
      if (name.startsWith('portal-')) await caches.delete(name);
    }
  } catch {
    // Nothing to remove, or storage is blocked.
  }
}

/**
 * Asks the worker to keep the font files this page has downloaded, so the
 * offline page and the next visit are set in the same type. Only the language
 * in use is downloaded, so only its files are kept.
 */
async function saveFonts(registration) {
  const worker = (await navigator.serviceWorker.ready).active ?? registration.active;
  const urls = performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => new URL(name).pathname.endsWith('.woff2'));
  if (worker && urls.length) worker.postMessage({ type: 'SAVE_FONTS', urls });
}

/**
 * Deletes every answer the worker saved. One person's data must not outlive
 * their session on a shared phone: called on sign-out and on the login page.
 */
export async function forgetSavedAnswers() {
  try {
    if (!('caches' in globalThis)) return;
    for (const name of await caches.keys()) {
      if (name.startsWith(API_CACHE_PREFIX)) await caches.delete(name);
    }
  } catch {
    // Storage blocked: nothing was saved either.
  }
}
