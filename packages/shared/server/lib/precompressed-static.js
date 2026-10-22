/**
 * precompressed-static.js — the frontend's text files, compressed once at the
 * best setting and then served from memory.
 *
 * The `compression` middleware compresses every response on the way out, at a
 * speed-first level (Brotli quality 4), which is right for an API answer and
 * wrong for a stylesheet that thousands of phones fetch over 3G: the same file
 * is 15-25% smaller at Brotli's top quality. Static files do not change while
 * the server runs, so this does the slow work once per file and keeps the result.
 *
 * The work never waits on a request and never competes with one: files are
 * compressed one at a time in the background (Brotli's top level holds a
 * thread of Node's small pool for up to a second per file, and a burst of them
 * stalled every API call behind it), and until a file is ready it is served by
 * express.static as before.
 *
 * It answers only what it can improve: text files under the frontend folder,
 * for a client that accepts br or gzip. Anything else (fonts and images are
 * already compressed, a file that is missing) falls through to express.static.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve as resolvePath, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const deflate = promisify(gzip);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

/** Under this a response is not worth the header it costs. */
const MIN_BYTES = 512;

/**
 * @param {string} root  the folder served
 * @param {object} [options]
 * @param {string} [options.cacheControl]
 * @param {string[]} [options.skip]  request paths another route owns
 */
export function precompressedStatic(
  folder,
  { cacheControl = 'public, max-age=0', skip = [] } = {}
) {
  const root = resolvePath(folder);
  /** Finished files by path and mtime; null is "not worth compressing". */
  const ready = new Map();
  const queued = new Set();
  let queue = Promise.resolve();

  async function compress(path, mtimeMs) {
    const raw = await readFile(path);
    if (raw.length < MIN_BYTES) return null;
    const br = await brotli(raw, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    const gz = await deflate(raw, { level: 9 });
    const etag = `"${createHash('sha1').update(raw).digest('base64url').slice(0, 22)}"`;
    return { br, gz, etag, mtimeMs, type: TYPES[extname(path)] };
  }

  /** The finished result, or undefined (and the work queued) when there is none yet. */
  function entry(path, mtimeMs) {
    const key = `${path}:${mtimeMs}`;
    if (ready.has(key)) return ready.get(key);
    if (!queued.has(key)) {
      queued.add(key);
      queue = queue
        .then(() => compress(path, mtimeMs))
        .catch(() => null)
        .then((result) => {
          ready.set(key, result);
        });
    }
    return undefined;
  }

  /** The file a request path names, or null when it names none under `root`. */
  async function resolve(urlPath) {
    let relative = decodeURIComponent(urlPath);
    if (relative.endsWith('/')) relative += 'index.html';
    const path = normalize(join(root, relative));
    if (path !== root && !path.startsWith(root + sep)) return null;

    for (const candidate of extname(path) ? [path] : [`${path}.html`]) {
      const info = await stat(candidate).catch(() => null);
      if (info?.isFile() && TYPES[extname(candidate)]) return { path: candidate, info };
    }
    return null;
  }

  /** Queues every text file, so the first visitor finds them done. */
  async function warm() {
    const names = await readdir(root, { recursive: true });
    for (const name of names) {
      if (!TYPES[extname(name)]) continue;
      const path = join(root, name);
      const info = await stat(path).catch(() => null);
      if (info?.isFile()) entry(path, info.mtimeMs);
    }
    await queue;
  }

  async function serve(req, res, next) {
    try {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || skip.includes(req.path))
        return next();
      const accepted = String(req.headers['accept-encoding'] ?? '');
      const encoding = /\bbr\b/.test(accepted) ? 'br' : /\bgzip\b/.test(accepted) ? 'gz' : null;
      if (!encoding) return next();

      const found = await resolve(req.path);
      if (!found) return next();
      const packed = entry(found.path, found.info.mtimeMs);
      // Not ready (or not worth it): this request is served as a plain file.
      if (!packed) return next();

      res.set({
        'Content-Type': packed.type,
        'Content-Encoding': encoding === 'br' ? 'br' : 'gzip',
        Vary: 'Accept-Encoding',
        ETag: packed.etag,
        'Cache-Control': cacheControl,
        'Last-Modified': new Date(found.info.mtimeMs).toUTCString(),
      });
      if (req.headers['if-none-match'] === packed.etag) return res.status(304).end();

      const body = packed[encoding];
      res.set('Content-Length', String(body.length));
      return res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      return next();
    }
  }

  return Object.assign(serve, { warm });
}
