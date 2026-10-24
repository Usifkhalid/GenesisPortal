/**
 * return-path.js — where sign-in sends a person back to.
 *
 * A link opened while signed out (/new, /queue, /#tickets/<id>) is carried
 * through the login page as `?next=` and used when sign-in is done. The value
 * comes from the address bar, so it is never trusted: only a path on this
 * site passes, anything else (another site, a scheme, "//host", a backslash,
 * control characters, the API or the sign-in pages themselves) is dropped and
 * the person lands on the usual page.
 */

const MAX_LENGTH = 500;
const BASE = 'http://return.invalid';

/** Control characters, which URL parsers strip or reinterpret ("/\t/evil.com"). */
const hasControl = (text) =>
  [...text].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/**
 * @param {unknown} value
 * @returns {string | null} the same text when it is a same-site path, else null
 */
export function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || hasControl(value)) return null;

  let url;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  // "/.//evil.com" normalises to "//evil.com", which a browser reads as another site.
  if (url.origin !== BASE || url.pathname.startsWith('//')) return null;

  const path = url.pathname.toLowerCase();
  if (
    path === '/login' ||
    path === '/login.html' ||
    path.startsWith('/auth/') ||
    path.startsWith('/api/')
  ) {
    return null;
  }
  return value;
}
