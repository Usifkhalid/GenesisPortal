/**
 * markdown.js — the limited Markdown announcements are written in, and the
 * one place it becomes HTML. Pure functions with no DOM, so the backend (which
 * renders and sanitises, and is the authority) and the editor's live preview
 * run exactly the same code.
 *
 * Supported: `#`, `##`, `###` headings (shown as h2 to h4: the page's own
 * title is the h1), paragraphs, **bold**, *italic* and _italic_, `-`/`*`
 * bullet lists, `1.` numbered lists, and [text](url) links.
 *
 * Nothing else is HTML. Every piece of text is escaped before it is placed in
 * markup, so a tag typed by an author is shown as text; the only attributes
 * ever written are an escaped href, target and rel. A link whose address is
 * not http(s), mailto, a site path (/x) or an in-page hash (#x) is rendered as
 * its text alone: no javascript:, data: or vbscript: URL gets through, in any
 * spelling, because the allowlist is anchored at the start of the address as
 * the author typed it and nothing is decoded first.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const SAFE_URL =
  /^(https?:\/\/[^\s<>"'`]+|mailto:[^\s<>"'`]+|\/(?!\/)[^\s<>"'`]*|#[^\s<>"'`]*)$/i;

/** @param {string} url  an address as typed */
export function isSafeUrl(url) {
  return SAFE_URL.test(url.trim());
}

/** Bold and italic over text that has already been escaped. */
function emphasis(escaped) {
  return escaped
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![_\w])/g, '$1<em>$2</em>');
}

// The address may hold one level of parentheses (Wikipedia style), so that
// "javascript:alert(1)" is read as one address and refused as one.
const LINK = /\[([^\]\n]{1,300})\]\(\s*((?:[^()\s]|\([^()\s]*\)){1,2000})\s*\)/g;

/** One line of inline Markdown to HTML. */
function inline(raw) {
  let out = '';
  let last = 0;
  for (const match of raw.matchAll(LINK)) {
    out += emphasis(escapeText(raw.slice(last, match.index)));
    const [whole, text, url] = match;
    const label = emphasis(escapeText(text));
    if (isSafeUrl(url)) {
      const external = /^https?:/i.test(url);
      out += `<a href="${escapeText(url)}"${
        external ? ' target="_blank" rel="noopener noreferrer"' : ''
      }>${label}</a>`;
    } else {
      out += label;
    }
    last = match.index + whole.length;
  }
  return out + emphasis(escapeText(raw.slice(last)));
}

/**
 * Markdown to HTML. Safe to place in innerHTML.
 * @param {string} source
 * @returns {string}
 */
export function renderMarkdown(source) {
  const lines = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const html = [];
  let paragraph = [];
  let list = null; // { tag, items }

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      html.push(
        `<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`
      );
    }
    list = null;
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    const bullet = /^\s{0,3}[-*+]\s+(.+)$/.exec(line);
    const numbered = /^\s{0,3}\d{1,3}[.)]\s+(.+)$/.exec(line);

    if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 1;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((bullet ?? numbered)[1]);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return html.join('\n');
}

/**
 * What is kept when Markdown is saved: control characters and anything shaped
 * like an HTML tag, comment or entity-encoded script are removed, and links
 * with an address outside the allowlist are reduced to their text. Rendering
 * escapes regardless; this keeps the stored text clean too, so an export or a
 * future renderer never meets markup.
 * @param {string} source
 * @returns {string}
 */
export function sanitizeMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  let kept = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const control = code < 0x20 ? code !== 0x0a && code !== 0x09 : code === 0x7f;
    // Line and paragraph separators, and the bidi overrides that can make text
    // read differently from how it is stored.
    const bidi =
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    if (!control && !bidi) kept += ch;
  }
  return kept
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[a-zA-Z!?][^>]*>/g, '')
    .replace(LINK, (whole, label, url) => (isSafeUrl(url) ? whole : label))
    .trim();
}

/** Plain text of a Markdown body, for summaries and previews. */
export function plainText(source) {
  return String(source ?? '')
    .replace(LINK, '$1')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+/gm, '')
    .replace(/[*_]{1,2}([^*_\n]+)[*_]{1,2}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
