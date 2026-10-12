/**
 * file-type.js — what an attachment really is, from its own bytes.
 *
 * The name and the Content-Type header are the client's claim. A file is
 * accepted only when its extension is on the allow-list AND its signature is
 * the one that extension should have: images, PDF, Office documents and plain
 * text (.txt, .log). Archives, executables, scripts, HTML and SVG are not on
 * the list, and renaming one does not get it through.
 *
 * Office's newer formats are zip containers, so a zip is accepted only when
 * it holds the parts of the document its extension names. Plain text has no
 * signature: it must decode as text and contain no control bytes.
 */

import { detectImage } from './image-type.js';

const OFFICE_OPEN = {
  docx: ['word/', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['xl/', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pptx: ['ppt/', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
};

const OFFICE_LEGACY = {
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
};

const IMAGE_EXTENSIONS = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
};

/** Every extension an attachment may have. */
export const ATTACHMENT_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  ...Object.keys(OFFICE_OPEN),
  ...Object.keys(OFFICE_LEGACY),
  'txt',
  'log',
];

const starts = (buffer, bytes) =>
  buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
/** The compound file that .doc, .xls and .ppt are. */
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function imageOf(buffer) {
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('latin1');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  return detectImage(buffer)?.type ?? null;
}

/** Text: UTF-8 (or UTF-16 with a byte-order mark) with no control characters. */
function isPlainText(buffer) {
  let text;
  try {
    const utf16 = starts(buffer, [0xff, 0xfe])
      ? 'utf-16le'
      : starts(buffer, [0xfe, 0xff])
        ? 'utf-16be'
        : null;
    text = new TextDecoder(utf16 ?? 'utf-8', { fatal: true }).decode(buffer);
  } catch {
    return false;
  }
  // Tab, line feed, form feed and carriage return are what a log holds; any
  // other control character means this is not text. (ESC is let through:
  // console logs carry colour codes.)
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000b\u000e-\u001a\u001c-\u001f]/.test(text);
}

/** The extension of a file name, lower case, without the dot; '' when none. */
export function extensionOf(fileName) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(fileName ?? '').trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * @param {Buffer} buffer
 * @param {string} fileName  the client's name for it; only its extension is read
 * @returns {{ type: string, ext: string } | null}  null when it is not allowed
 */
export function detectAttachment(buffer, fileName) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const ext = extensionOf(fileName);
  if (!ATTACHMENT_EXTENSIONS.includes(ext)) return null;

  const image = imageOf(buffer);
  if (image) return IMAGE_EXTENSIONS[image].includes(ext) ? { type: image, ext } : null;
  if (Object.values(IMAGE_EXTENSIONS).flat().includes(ext)) return null;

  if (ext === 'pdf') {
    return buffer.subarray(0, 5).toString('latin1') === '%PDF-'
      ? { type: 'application/pdf', ext }
      : null;
  }

  if (ext in OFFICE_OPEN) {
    const [folder, type] = OFFICE_OPEN[ext];
    const ok =
      starts(buffer, ZIP) && buffer.includes('[Content_Types].xml') && buffer.includes(folder);
    return ok ? { type, ext } : null;
  }

  if (ext in OFFICE_LEGACY) {
    return starts(buffer, CFB) ? { type: OFFICE_LEGACY[ext], ext } : null;
  }

  // .txt and .log
  return isPlainText(buffer) ? { type: 'text/plain', ext } : null;
}
