/**
 * make-icons.js — draws the portal's app icons as PNG files, with no image
 * library: an assay card (the portal's signature record) on the pine ground.
 *
 *   node backend/scripts/make-icons.js
 *
 * Writes frontend/assets/img/icons/. The files are committed; run this only
 * when the artwork changes. The art sits inside the central 80% of the canvas,
 * which is the safe zone a maskable icon is cropped to.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../../../../packages/shared/web/assets/img/icons/', import.meta.url);

const PINE = [0x12, 0x29, 0x1d];
const PAPER = [0xf8, 0xf5, 0xf0];
const LIME = [0xc9, 0xf0, 0x3d];
const RULE = [0x51, 0x65, 0x5a];

/** Distance to a rounded rectangle (negative inside), in unit-square coordinates. */
function roundedBox(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - cy) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Colour and coverage of one point of the artwork; null is transparent. */
function sample(x, y, { rounded }) {
  if (rounded && roundedBox(x, y, 0, 0, 1, 1, 0.22) > 0) return null;
  if (roundedBox(x, y, 0.26, 0.22, 0.74, 0.78, 0.06) <= 0) {
    if (y < 0.37) return LIME;
    const rows = [
      [0.46, 0.68],
      [0.56, 0.68],
      [0.66, 0.58],
    ];
    for (const [top, end] of rows) {
      if (y >= top && y < top + 0.035 && x >= 0.32 && x < end) return RULE;
    }
    return PAPER;
  }
  return PINE;
}

function render(size, options) {
  const SS = 3; // samples per axis per pixel
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(
            (px + (sx + 0.5) / SS) / size,
            (py + (sy + 0.5) / SS) / size,
            options
          );
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FILES = [
  ['icon-192.png', 192, { rounded: true }],
  ['icon-512.png', 512, { rounded: true }],
  ['icon-maskable-512.png', 512, { rounded: false }],
  ['apple-touch-icon.png', 180, { rounded: false }],
  ['favicon-32.png', 32, { rounded: true }],
];

mkdirSync(OUT, { recursive: true });
for (const [name, size, options] of FILES) {
  const bytes = png(size, render(size, options));
  writeFileSync(new URL(name, OUT), bytes);
  console.log(`${name}  ${size}x${size}  ${bytes.length} bytes`);
}
