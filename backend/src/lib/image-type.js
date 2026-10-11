/**
 * image-type.js — what an uploaded file really is, from its first bytes.
 *
 * The file name and the Content-Type header are the client's claim; the
 * signature is the file's own. Only the three formats a logo may be are
 * recognised. SVG is deliberately not among them: it is markup that can carry
 * script, and it has no signature to check.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @param {Buffer} buffer
 * @returns {{ type: 'image/png'|'image/jpeg'|'image/webp', ext: 'png'|'jpg'|'webp' } | null}
 */
export function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer.subarray(0, 8).equals(PNG)) return { type: 'image/png', ext: 'png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { type: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { type: 'image/webp', ext: 'webp' };
  }
  return null;
}
