/**
 * service-worker.js — serves /sw.js with its version and precache list filled in.
 *
 * The frontend has no build step, so nothing can stamp a version into the worker
 * ahead of time. This route does it per start: the version is a hash of every
 * frontend file's path, size and modified time, so any change to any file makes
 * the worker's bytes differ, the browser installs it as an update, and the old
 * cache is deleted when the new one activates (frontend/sw.js).
 *
 * The precache list is what the shell needs to draw and say something with no
 * network: the two HTML pages, the offline page, the manifest, every stylesheet,
 * the core scripts and components, both languages and the icons. Page modules
 * and fonts are not listed: they are cached the first time they are fetched.
 *
 * With the worker switched off (SERVICE_WORKER=off, the development default)
 * /sw.js is a worker that does nothing but delete what an earlier one saved and
 * remove itself, so a browser that already has the real worker drops it. A 404
 * would do the same but logs an error in every page's console.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

const SHELL_PAGES = new Map([
  ['index.html', '/'],
  ['login.html', '/login.html'],
  ['offline.html', '/offline.html'],
]);

/** What /sw.js is while the worker is off: it clears the way and goes. */
const RETIRED_WORKER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('portal-')) await caches.delete(name);
      }
      await self.registration.unregister();
    })()
  );
});
`;

/** Paths under assets/ that are fetched when a page asks, not up front. */
const LAZY = [
  /^assets\/js\/pages\//,
  /^assets\/css\/pages\/styleguide\.css$/,
  /^assets\/img\/companies\//,
];

function listFiles(root) {
  return readdirSync(root, { recursive: true })
    .map((path) => path.split(sep).join(posix.sep))
    .filter((path) => statSync(join(root, path)).isFile());
}

/**
 * @param {string} frontendDir
 * @returns {{ version: string, precache: string[] }}
 */
export function describeFrontend(frontendDir) {
  const files = listFiles(frontendDir).sort();
  const hash = createHash('sha1');
  const precache = [];

  for (const file of files) {
    const stat = statSync(join(frontendDir, file));
    hash.update(`${file}:${stat.size}:${Math.round(stat.mtimeMs)}\n`);

    if (SHELL_PAGES.has(file)) precache.push(SHELL_PAGES.get(file));
    else if (file === 'manifest.webmanifest') precache.push(`/${file}`);
    else if (
      /^assets\/(css\/.*\.css|js\/.*\.js|i18n\/.*\.json|fonts\/fonts\.css|img\/icons\/.*\.png)$/.test(
        file
      ) &&
      !LAZY.some((pattern) => pattern.test(file))
    ) {
      precache.push(`/${file}`);
    }
  }

  return { version: hash.digest('hex').slice(0, 12), precache };
}

/**
 * Whether the page asking should install the worker: the server's setting, or,
 * outside production, this browser's own request for it (a cookie
 * `portal_sw=on`), so a developer or a test can try the worker in a
 * development server without every other page being served by one.
 *
 * @param {import('express').Request} req
 * @param {{ serviceWorkerEnabled?: boolean, NODE_ENV?: string }} config
 */
export function workerEnabledFor(req, config) {
  if (config.serviceWorkerEnabled) return true;
  if (config.NODE_ENV === 'production') return false;
  return /(?:^|;\s*)portal_sw=on(?:;|$)/.test(String(req.headers.cookie ?? ''));
}

/**
 * @param {object} options
 * @param {string} options.frontendDir
 * @param {(req: import('express').Request) => boolean} options.enabled
 * @param {boolean} [options.fixed]  describe the files once (production) rather
 *   than on every request (development, where files change under the server)
 */
export function serviceWorkerRoute({ frontendDir, enabled, fixed = false }) {
  let cached = null;

  const build = () => {
    const { version, precache } = describeFrontend(frontendDir);
    return readFileSync(join(frontendDir, 'sw.js'), 'utf8')
      .replace("'__VERSION__'", JSON.stringify(version))
      .replace('/*__PRECACHE__*/ []', JSON.stringify(precache));
  };

  return (req, res) => {
    if (!enabled(req)) {
      res.set({
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.send(RETIRED_WORKER);
      return;
    }
    if (!fixed || !cached) cached = build();
    res.set({
      'Content-Type': 'text/javascript; charset=utf-8',
      // The worker file is always checked: it is how an update is found.
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    });
    res.send(cached);
  };
}
